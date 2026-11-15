<script module lang="ts">
	import type { ModelBoundsReport } from './modelNormalization';

	export type CalibrationGestureMode = 'rotate' | 'roll' | 'move';

	export interface PlaneMeasurement {
		id: string;
		avgWidthPx: number;
		avgHeightPx: number;
		spanPx: number;
		depthCanvasUnits: number;
		scale: number;
		vFovDeg: number;
		aspectRatio: number;
	}

	export interface SeamDiagnostics {
		canvasAId: string;
		canvasBId: string;
		ruleId: string | null;
		arrangementKey: string | null;
		sideA: string;
		sideB: string;
		edgeA: string;
		edgeB: string;
		pairCode: string;
		gapRatio: number;
		lateralOffsetRatio: number;
		outOfPlaneRatio: number;
		normalAngleDeg: number;
		isCompatible: boolean;
		failureReasons: string[];
		pairScale: number;
	}

	export interface ARDiagnostics {
		models: Record<string, ModelBoundsReport>;
		planes: Record<string, PlaneMeasurement>;
		activeSeam: SeamDiagnostics | null;
		allSeams: SeamDiagnostics[];
	}
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import type { Point, Pose6DoF } from '#lib/types';
	import type { TrackedPainting } from '#lib/recognition/scanner.svelte';
	import type { ArtManifest, ModelSpec, SeamRule } from '../manifest/types';
	import { resolveCanvasConfig } from '../manifest/repository';
	import type { ARMachineState } from '../state/arStateMachine';
	import { updatePlacementOnRoot } from './modelNormalization';
	import { loadModel3D, resolveModelUrl } from './modelLoader';
	import {
		evaluateAllPairSeams,
		type PaintingPoseFrame,
		type SeamEvaluationResult
	} from '../seam/pairFrame';
	import { computeCanvasPoseFromCorners } from '../seam/poseProjection';

	interface Props {
		/** All currently tracked paintings. */
		paintings?: TrackedPainting[];
		/** Single-painting fallback. */
		corners?: Point[] | null;
		paintingId?: string | null;
		customModelUrl?: string | null;
		userModel?: THREE.Group | null;
		manifest?: ArtManifest | null;
		arState?: ARMachineState;
		generatingProgress?: number;
		crossFadeAlpha?: number;
		visible?: boolean;
		videoWidth: number;
		videoHeight: number;
		width: number;
		height: number;
		calibrationMode?: boolean;
		calibrationTargetId?: string | null;
		calibrationSpec?: ModelSpec | null;
		calibrationWireframe?: boolean;
		calibrationOpacity?: number;
		calibrationGestureMode?: CalibrationGestureMode;
		onFpsUpdate?: (fps: number) => void;
		onFrameTick?: (nowMs: number) => void;
		onDiagnosticsUpdate?: (diag: ARDiagnostics) => void;
		onCalibrationDrag?: (dxLocal: number, dyLocal: number) => void;
		onCalibrationScale?: (scaleFactor: number) => void;
		onCalibrationRotate?: (dPitchDeg: number, dYawDeg: number, dRollDeg: number) => void;
	}

	let {
		paintings = [],
		corners = null,
		paintingId = null,
		customModelUrl = null,
		userModel = null,
		manifest = null,
		arState = 'tracking_single',
		generatingProgress = 1,
		crossFadeAlpha = 1,
		visible = true,
		videoWidth,
		videoHeight,
		width,
		height,
		calibrationMode = false,
		calibrationTargetId = null,
		calibrationSpec = null,
		calibrationWireframe = false,
		calibrationOpacity = 1,
		calibrationGestureMode = 'rotate',
		onFpsUpdate,
		onFrameTick,
		onDiagnosticsUpdate,
		onCalibrationDrag,
		onCalibrationScale,
		onCalibrationRotate
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let animId = 0;

	const V_FOV_DEG = 50;
	const PREVIEW_POSE = new THREE.Vector3(0, 0, -2.4);

	interface TargetEntry {
		id: string;
		canonicalId: string;
		corners: Point[];
		modelUrl?: string | null;
		spec?: ModelSpec;
		pose?: Pose6DoF | null;
	}

	interface HologramRig {
		group: THREE.Group;
		frameMat: THREE.LineBasicMaterial;
		ring: THREE.Mesh;
		ringMat: THREE.MeshBasicMaterial;
		scanPlane: THREE.Mesh;
		scanMat: THREE.MeshBasicMaterial;
	}

	interface ModelBoxGuide {
		group: THREE.Group;
		boxLine: THREE.LineSegments;
		pivotSphere: THREE.Mesh;
	}

	interface PaintingInstance {
		key: string;
		root: THREE.Group;
		hologram: HologramRig;
		canvasGuide: THREE.Group;
		modelBoxGuide: ModelBoxGuide | null;
		currentMesh: THREE.Group | null;
		previousMesh: THREE.Group | null;
		loadedSignature: string | null;
		activeSpec: Partial<ModelSpec> | null;
		targetPos: THREE.Vector3;
		targetQuat: THREE.Quaternion;
		targetScale: number;
		hasTarget: boolean;
		loading: boolean;
	}

	const instances = new Map<string, PaintingInstance>();
	let pairInstance: PaintingInstance | null = null;
	let pairExtraGuides: THREE.Group | null = null;
	let previewSingleInstance: PaintingInstance | null = null;
	let activeCalRoot: THREE.Group | null = null;

	const targetList = $derived.by<TargetEntry[]>(() => {
		const resolveTarget = (
			rawId: string,
			pts: Point[],
			fallbackUrl?: string | null,
			pose?: Pose6DoF | null
		): TargetEntry => {
			const cfg = manifest ? resolveCanvasConfig(manifest, rawId) : null;
			return {
				id: rawId,
				canonicalId: cfg?.id ?? rawId,
				corners: pts,
				modelUrl: cfg?.singleModel.url ?? fallbackUrl,
				spec: cfg?.singleModel,
				pose
			};
		};

		if (paintings && paintings.length > 0) {
			return paintings.map((p) => resolveTarget(p.id, p.corners, p.modelUrl, p.pose));
		}
		if (corners && corners.length === 4 && paintingId) {
			return [resolveTarget(paintingId, corners, customModelUrl, null)];
		}
		return [];
	});

	function createHologramRig(): HologramRig {
		const group = new THREE.Group();

		const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.0, 1.0, 0.02));
		const frameMat = new THREE.LineBasicMaterial({
			color: 0x34d399,
			transparent: true,
			opacity: 0.9
		});
		group.add(new THREE.LineSegments(frameGeo, frameMat));

		const ringGeo = new THREE.TorusGeometry(0.32, 0.015, 10, 36);
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0x38bdf8,
			wireframe: true,
			transparent: true,
			opacity: 0.85
		});
		const ring = new THREE.Mesh(ringGeo, ringMat);
		ring.position.z = 0.22;
		group.add(ring);

		const scanGeo = new THREE.PlaneGeometry(0.92, 0.92);
		const scanMat = new THREE.MeshBasicMaterial({
			color: 0x34d399,
			transparent: true,
			opacity: 0.22,
			side: THREE.DoubleSide
		});
		const scanPlane = new THREE.Mesh(scanGeo, scanMat);
		scanPlane.position.z = 0.02;
		group.add(scanPlane);

		return { group, frameMat, ring, ringMat, scanPlane, scanMat };
	}

	function createSquareOutline(color: number, z = 0.002): THREE.LineSegments {
		const pts = [
			new THREE.Vector3(-0.5, -0.5, z),
			new THREE.Vector3(0.5, -0.5, z),
			new THREE.Vector3(0.5, -0.5, z),
			new THREE.Vector3(0.5, 0.5, z),
			new THREE.Vector3(0.5, 0.5, z),
			new THREE.Vector3(-0.5, 0.5, z),
			new THREE.Vector3(-0.5, 0.5, z),
			new THREE.Vector3(-0.5, -0.5, z)
		];
		const geo = new THREE.BufferGeometry().setFromPoints(pts);
		const mat = new THREE.LineBasicMaterial({
			color,
			transparent: true,
			opacity: 0.95,
			depthTest: false
		});
		const line = new THREE.LineSegments(geo, mat);
		line.renderOrder = 995;
		return line;
	}

	function createAxesAndCross(): THREE.Group {
		const group = new THREE.Group();

		// Center cross
		const crossPts = [
			new THREE.Vector3(-0.14, 0, 0.003),
			new THREE.Vector3(0.14, 0, 0.003),
			new THREE.Vector3(0, -0.14, 0.003),
			new THREE.Vector3(0, 0.14, 0.003)
		];
		const crossGeo = new THREE.BufferGeometry().setFromPoints(crossPts);
		const crossLine = new THREE.LineSegments(
			crossGeo,
			new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
		);
		crossLine.renderOrder = 996;
		group.add(crossLine);

		// X (red), Y (green), Z (cyan/blue) local axes
		const axisSpecs: Array<{ dir: [number, number, number]; color: number }> = [
			{ dir: [0.42, 0, 0], color: 0xf43f5e },
			{ dir: [0, 0.42, 0], color: 0x22c55e },
			{ dir: [0, 0, 0.42], color: 0x38bdf8 }
		];
		for (const a of axisSpecs) {
			const g = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(0, 0, 0.004),
				new THREE.Vector3(a.dir[0], a.dir[1], a.dir[2] + 0.004)
			]);
			const l = new THREE.Line(
				g,
				new THREE.LineBasicMaterial({ color: a.color, depthTest: false })
			);
			l.renderOrder = 997;
			group.add(l);
		}

		return group;
	}

	function createCanvasFrameGuide(): THREE.Group {
		const group = new THREE.Group();
		group.visible = false;
		group.add(createSquareOutline(0x34d399));
		group.add(createAxesAndCross());
		return group;
	}

	function createModelBoxGuide(): ModelBoxGuide {
		const group = new THREE.Group();
		const boxLine = new THREE.LineSegments(
			new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
			new THREE.LineBasicMaterial({
				color: 0x38bdf8,
				transparent: true,
				opacity: 0.9,
				depthTest: false
			})
		);
		boxLine.renderOrder = 998;
		group.add(boxLine);

		const pivotSphere = new THREE.Mesh(
			new THREE.SphereGeometry(0.026, 14, 14),
			new THREE.MeshBasicMaterial({
				color: 0xfacc15,
				depthTest: false
			})
		);
		pivotSphere.userData.isCalibrationGuide = true;
		pivotSphere.renderOrder = 999;
		group.add(pivotSphere);

		return { group, boxLine, pivotSphere };
	}

	function createPairExtraGuides(): THREE.Group {
		const group = new THREE.Group();
		group.visible = false;

		const leftOutline = createSquareOutline(0x34d399);
		leftOutline.name = 'pair_left_canvas';
		group.add(leftOutline);

		const rightOutline = createSquareOutline(0x38bdf8);
		rightOutline.name = 'pair_right_canvas';
		group.add(rightOutline);

		const seamGeo = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, -0.58, 0.005),
			new THREE.Vector3(0, 0.58, 0.005)
		]);
		const seamLine = new THREE.Line(
			seamGeo,
			new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false })
		);
		seamLine.name = 'pair_seam_line';
		seamLine.renderOrder = 998;
		group.add(seamLine);

		group.add(createAxesAndCross());
		return group;
	}

	function syncModelBoxGuide(inst: PaintingInstance, spec: Partial<ModelSpec> | null, showGuide: boolean) {
		if (!inst.currentMesh) return;
		const placementGroup = inst.currentMesh.userData.placementGroup as THREE.Group | undefined;
		const report = inst.currentMesh.userData.boundsReport as ModelBoundsReport | undefined;
		if (!placementGroup || !report) return;

		if (!inst.modelBoxGuide) {
			inst.modelBoxGuide = createModelBoxGuide();
		}
		if (inst.modelBoxGuide.group.parent !== placementGroup) {
			placementGroup.add(inst.modelBoxGuide.group);
		}
		inst.modelBoxGuide.group.visible = showGuide;
		if (!showGuide) return;

		const [minX, minY, minZ] = report.normalizedMin;
		const [maxX, maxY, maxZ] = report.normalizedMax;
		inst.modelBoxGuide.boxLine.position.set(
			(minX + maxX) * 0.5,
			(minY + maxY) * 0.5,
			(minZ + maxZ) * 0.5
		);
		inst.modelBoxGuide.boxLine.scale.set(
			Math.max(0.001, maxX - minX),
			Math.max(0.001, maxY - minY),
			Math.max(0.001, maxZ - minZ)
		);
		const invScale = 1 / Math.max(0.25, spec?.scale ?? 1);
		inst.modelBoxGuide.pivotSphere.scale.setScalar(invScale);
	}

	function createPaintingInstance(key: string): PaintingInstance {
		const root = new THREE.Group();
		root.visible = false;
		const hologram = createHologramRig();
		root.add(hologram.group);
		const canvasGuide = createCanvasFrameGuide();
		root.add(canvasGuide);
		scene?.add(root);

		return {
			key,
			root,
			hologram,
			canvasGuide,
			modelBoxGuide: null,
			currentMesh: null,
			previousMesh: null,
			loadedSignature: null,
			activeSpec: null,
			targetPos: new THREE.Vector3(0, 0, -2.4),
			targetQuat: new THREE.Quaternion(),
			targetScale: 1.0,
			hasTarget: false,
			loading: false
		};
	}

	function applyGroupAppearance(group: THREE.Group, alpha: number, wireframe: boolean) {
		const clamped = Math.max(0, Math.min(1, alpha));
		group.visible = clamped > 0.01;
		group.traverse((child) => {
			if (child instanceof THREE.Mesh && !child.userData.isCalibrationGuide) {
				const mats = Array.isArray(child.material) ? child.material : [child.material];
				for (const m of mats) {
					if (!m) continue;
					const base = typeof m.userData.baseOpacity === 'number' ? m.userData.baseOpacity : 1;
					if (m.userData.originallyTransparent === undefined) {
						m.userData.originallyTransparent = m.transparent;
					}
					const targetOpacity = base * clamped;
					m.transparent = targetOpacity < 0.999 || m.userData.originallyTransparent === true;
					m.opacity = targetOpacity;
					if ('wireframe' in m) {
						(m as THREE.MeshStandardMaterial).wireframe = wireframe;
					}
				}
			}
		});
	}

	function setInstanceMesh(inst: PaintingInstance, mesh: THREE.Group, signature: string) {
		if (inst.previousMesh) {
			inst.root.remove(inst.previousMesh);
			inst.previousMesh = null;
		}
		if (inst.currentMesh) {
			inst.previousMesh = inst.currentMesh;
		}
		inst.currentMesh = mesh;
		inst.loadedSignature = signature;
		inst.root.add(mesh);
		if (inst.activeSpec) {
			updatePlacementOnRoot(mesh, inst.activeSpec);
		}
	}

	function syncInstanceCrossFade(
		inst: PaintingInstance,
		alpha: number,
		wireframe: boolean,
		allowPreviousCrossFade: boolean
	) {
		if (inst.previousMesh) {
			if (allowPreviousCrossFade && alpha < 0.99) {
				applyGroupAppearance(inst.previousMesh, Math.max(0, 1 - alpha), wireframe);
			} else {
				inst.root.remove(inst.previousMesh);
				inst.previousMesh = null;
			}
		}
		if (inst.currentMesh) {
			applyGroupAppearance(inst.currentMesh, alpha, wireframe);
		}
	}

	async function ensureInstanceModel(
		inst: PaintingInstance,
		canonicalId: string,
		modelUrl: string | null | undefined,
		spec: Partial<ModelSpec> | undefined,
		allowUserModel: boolean
	) {
		const sig =
			allowUserModel && userModel
				? 'userModel'
				: `${canonicalId}|${modelUrl ?? spec?.url ?? ''}`;

		inst.activeSpec = spec ?? null;
		if (inst.currentMesh && inst.loadedSignature === sig) {
			if (inst.activeSpec) {
				updatePlacementOnRoot(inst.currentMesh, inst.activeSpec);
			}
			return;
		}
		if (inst.loading) return;

		inst.loading = true;
		try {
			if (allowUserModel && userModel) {
				setInstanceMesh(inst, userModel.clone(), sig);
				return;
			}
			const resolvedUrl = await resolveModelUrl(canonicalId, modelUrl ?? spec?.url);
			const loaded = await loadModel3D(resolvedUrl, { spec: inst.activeSpec ?? spec });
			setInstanceMesh(inst, loaded, sig);
		} catch (err) {
			console.warn(`[ModelARCanvas] Failed to load 3D model for ${canonicalId}:`, err);
		} finally {
			inst.loading = false;
		}
	}

	function findSeamRuleById(targetId: string | null | undefined): SeamRule | null {
		if (!manifest || !targetId) return null;
		return (
			manifest.seamRules.find((r) => r.id === targetId || `seam-${r.id}` === targetId) ?? null
		);
	}

	function resolveCalibrationTargetInfo():
		| { kind: 'single'; id: string; spec: ModelSpec }
		| { kind: 'seam'; id: string; rule: SeamRule; spec: ModelSpec }
		| null {
		if (!calibrationMode || !manifest || !calibrationTargetId) return null;
		const rule = findSeamRuleById(calibrationTargetId);
		if (rule) {
			const spec = calibrationSpec ?? rule.combinedModel;
			return { kind: 'seam', id: rule.id, rule, spec };
		}
		const canvasCfg = resolveCanvasConfig(manifest, calibrationTargetId);
		if (canvasCfg) {
			const spec = calibrationSpec ?? canvasCfg.singleModel;
			return { kind: 'single', id: canvasCfg.id, spec };
		}
		return null;
	}

	function updateInstances() {
		if (!scene) return;
		const currentKeys = new Set(targetList.map((t) => t.id));

		for (const [key, inst] of instances) {
			if (!currentKeys.has(key)) {
				scene.remove(inst.root);
				instances.delete(key);
			}
		}

		const calInfo = resolveCalibrationTargetInfo();

		for (const t of targetList) {
			let inst = instances.get(t.id);
			if (!inst) {
				inst = createPaintingInstance(t.id);
				instances.set(t.id, inst);
			}
			const isCalibrated =
				calInfo?.kind === 'single' && (t.canonicalId === calInfo.id || t.id === calInfo.id);
			const effSpec = isCalibrated ? calInfo.spec : t.spec;
			void ensureInstanceModel(inst, t.canonicalId, effSpec?.url ?? t.modelUrl, effSpec, true);
		}

		if (calInfo?.kind === 'single') {
			if (!previewSingleInstance) {
				previewSingleInstance = createPaintingInstance('cal_preview_single');
			}
			void ensureInstanceModel(
				previewSingleInstance,
				calInfo.id,
				calInfo.spec.url,
				calInfo.spec,
				false
			);
		}

		if (calInfo?.kind === 'seam') {
			if (!pairInstance) {
				pairInstance = createPaintingInstance('pair_seam');
				pairExtraGuides = createPairExtraGuides();
				pairInstance.root.add(pairExtraGuides);
			}
			void ensureInstanceModel(pairInstance, calInfo.id, calInfo.spec.url, calInfo.spec, false);
		}
	}

	$effect(() => {
		const _calMode = calibrationMode;
		const _calId = calibrationTargetId;
		const _calSpec = calibrationSpec;
		const _manifest = manifest;
		const _targets = targetList;
		const _userModel = userModel;
		if (scene) {
			updateInstances();
		}
	});

	function updatePairGuidesFromSeam(seam: SeamEvaluationResult | null) {
		if (!pairExtraGuides || !pairInstance) return;
		const leftOutline = pairExtraGuides.getObjectByName('pair_left_canvas') as
			| THREE.LineSegments
			| undefined;
		const rightOutline = pairExtraGuides.getObjectByName('pair_right_canvas') as
			| THREE.LineSegments
			| undefined;
		const seamLine = pairExtraGuides.getObjectByName('pair_seam_line') as THREE.Line | undefined;
		if (!leftOutline || !rightOutline || !seamLine) return;

		if (seam) {
			const invQuat = seam.pairQuaternion.clone().invert();
			const pairScale = Math.max(0.001, seam.pairScale);

			const resolveInstCanonId = (inst: PaintingInstance): string =>
				(manifest ? resolveCanvasConfig(manifest, inst.key)?.id : null) ?? inst.key;
			const liveEntries = [...instances.values()].filter((i) => i.hasTarget);
			const poseA =
				liveEntries.find((i) => resolveInstCanonId(i) === seam.canvasA.id) ?? liveEntries[0];
			const poseB =
				liveEntries.find((i) => i !== poseA && resolveInstCanonId(i) === seam.canvasB.id) ??
				liveEntries[1];
			if (poseA && poseB) {

				leftOutline.position
					.copy(poseA.targetPos)
					.sub(seam.pairOrigin)
					.applyQuaternion(invQuat)
					.divideScalar(pairScale);
				leftOutline.quaternion.copy(invQuat).multiply(poseA.targetQuat);
				leftOutline.scale.setScalar(poseA.targetScale / pairScale);

				rightOutline.position
					.copy(poseB.targetPos)
					.sub(seam.pairOrigin)
					.applyQuaternion(invQuat)
					.divideScalar(pairScale);
				rightOutline.quaternion.copy(invQuat).multiply(poseB.targetQuat);
				rightOutline.scale.setScalar(poseB.targetScale / pairScale);
			}

			const localStart = seam.seamLineStart
				.clone()
				.sub(seam.pairOrigin)
				.applyQuaternion(invQuat)
				.divideScalar(pairScale);
			const localEnd = seam.seamLineEnd
				.clone()
				.sub(seam.pairOrigin)
				.applyQuaternion(invQuat)
				.divideScalar(pairScale);
			seamLine.geometry.setFromPoints([localStart, localEnd]);
		} else {
			leftOutline.position.set(-0.52, 0, 0.002);
			leftOutline.quaternion.identity();
			leftOutline.scale.setScalar(1);

			rightOutline.position.set(0.52, 0, 0.002);
			rightOutline.quaternion.identity();
			rightOutline.scale.setScalar(1);

			seamLine.geometry.setFromPoints([
				new THREE.Vector3(0, -0.58, 0.005),
				new THREE.Vector3(0, 0.58, 0.005)
			]);
		}
	}

	// Pointer gestures in Calibration Mode (3D tumble / Z roll / XY drag + 2-finger pinch scale & twist roll)
	const activePointers = new Map<number, { x: number; y: number }>();
	let lastPinchDist = 0;
	let lastPinchAngle = 0;

	function getPinchDistance(): number {
		const pts = [...activePointers.values()];
		if (pts.length < 2) return 0;
		return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
	}

	function getPinchAngle(): number {
		const pts = [...activePointers.values()];
		if (pts.length < 2) return 0;
		return Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
	}

	function wrapAngleRad(rad: number): number {
		let a = rad;
		while (a > Math.PI) a -= Math.PI * 2;
		while (a < -Math.PI) a += Math.PI * 2;
		return a;
	}

	function handlePointerDown(e: PointerEvent) {
		if (!calibrationMode) return;
		canvas.setPointerCapture(e.pointerId);
		activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (activePointers.size === 2) {
			lastPinchDist = getPinchDistance();
			lastPinchAngle = getPinchAngle();
		}
	}

	function handlePointerMove(e: PointerEvent) {
		if (!calibrationMode || !activePointers.has(e.pointerId)) return;
		const prev = activePointers.get(e.pointerId)!;
		const dxPx = e.clientX - prev.x;
		const dyPx = e.clientY - prev.y;
		activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (activePointers.size === 1) {
			if (Math.abs(dxPx) < 0.01 && Math.abs(dyPx) < 0.01) return;

			if (e.shiftKey || e.buttons === 2 || calibrationGestureMode === 'roll') {
				const rect = canvas?.getBoundingClientRect();
				const cx = rect ? rect.left + rect.width / 2 : width / 2;
				const cy = rect ? rect.top + rect.height / 2 : height / 2;
				const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
				let dRollDeg = -dxPx * 0.45;
				if (dist > 24) {
					const prevAngle = Math.atan2(prev.y - cy, prev.x - cx);
					const curAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
					const dAngle = wrapAngleRad(curAngle - prevAngle);
					dRollDeg = -(dAngle * 180) / Math.PI;
				}
				onCalibrationRotate?.(0, 0, dRollDeg);
			} else if (calibrationGestureMode === 'rotate') {
				onCalibrationRotate?.(dyPx * 0.45, dxPx * 0.45, 0);
			} else {
				if (!activeCalRoot || !height) return;
				const vFovRad = (V_FOV_DEG * Math.PI) / 180;
				const fy = height / 2 / Math.tan(vFovRad / 2);
				const Z = Math.max(0.35, -activeCalRoot.position.z);
				const dWorldX = (dxPx * Z) / fy;
				const dWorldY = -(dyPx * Z) / fy;

				const invQuat = activeCalRoot.quaternion.clone().invert();
				const localDelta = new THREE.Vector3(dWorldX, dWorldY, 0)
					.applyQuaternion(invQuat)
					.divideScalar(Math.max(0.05, activeCalRoot.scale.x));

				onCalibrationDrag?.(localDelta.x, localDelta.y);
			}
		} else if (activePointers.size >= 2) {
			const dist = getPinchDistance();
			if (lastPinchDist > 4 && dist > 4) {
				const factor = dist / lastPinchDist;
				if (Math.abs(factor - 1) > 0.001) {
					onCalibrationScale?.(factor);
				}
			}
			lastPinchDist = dist;

			const curAngle = getPinchAngle();
			const dAngle = wrapAngleRad(curAngle - lastPinchAngle);
			if (Math.abs(dAngle) > 0.002) {
				onCalibrationRotate?.(0, 0, -(dAngle * 180) / Math.PI);
			}
			lastPinchAngle = curAngle;
		}
	}

	function handlePointerUpOrCancel(e: PointerEvent) {
		activePointers.delete(e.pointerId);
		if (activePointers.size < 2) {
			lastPinchDist = 0;
			lastPinchAngle = 0;
		}
	}

	function handleWheel(e: WheelEvent) {
		if (!calibrationMode) return;
		e.preventDefault();
		onCalibrationScale?.(e.deltaY < 0 ? 1.05 : 0.95);
	}

	onMount(() => {
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(
			V_FOV_DEG,
			Math.max(1, width) / Math.max(1, height),
			0.1,
			100
		);
		camera.position.set(0, 0, 0);

		renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		renderer.setSize(width, height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		const ambient = new THREE.AmbientLight(0xffffff, 1.5);
		scene.add(ambient);

		const dirLight = new THREE.DirectionalLight(0xffffff, 2.3);
		dirLight.position.set(2, 5, 4);
		scene.add(dirLight);

		const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
		fillLight.position.set(-3, -2, 2);
		scene.add(fillLight);

		updateInstances();

		let fpsFrames = 0;
		let fpsLastReport = performance.now();
		let diagLastReport = 0;
		let wasShowingLiveCombined = false;
		let singlesWereVisible = false;
		let lastValidSeam: SeamEvaluationResult | null = null;

		const toSeamDiag = (res: SeamEvaluationResult): SeamDiagnostics => ({
			canvasAId: res.canvasA.id,
			canvasBId: res.canvasB.id,
			ruleId: res.rule?.id ?? null,
			arrangementKey: res.arrangementKey,
			sideA: res.sideA,
			sideB: res.sideB,
			edgeA: res.edgeA,
			edgeB: res.edgeB,
			pairCode: res.pairCode,
			gapRatio: res.gapRatio,
			lateralOffsetRatio: res.lateralOffsetRatio,
			outOfPlaneRatio: res.outOfPlaneRatio,
			normalAngleDeg: res.normalAngleDeg,
			isCompatible: res.isCompatible,
			failureReasons: res.failureReasons,
			pairScale: res.pairScale
		});

		function animate(nowMs: number) {
			animId = requestAnimationFrame(animate);
			onFrameTick?.(nowMs);

			fpsFrames += 1;
			if (nowMs - fpsLastReport >= 500) {
				const fps = Math.round((fpsFrames * 1000) / (nowMs - fpsLastReport));
				onFpsUpdate?.(fps);
				fpsFrames = 0;
				fpsLastReport = nowMs;
			}

			const projectedPoses: PaintingPoseFrame[] = [];
			const planeMap: Record<string, PlaneMeasurement> = {};

			for (const t of targetList) {
				const inst = instances.get(t.id);
				if (!inst) continue;

				const projected = computeCanvasPoseFromCorners(
					t.canonicalId,
					t.corners,
					videoWidth,
					videoHeight,
					width,
					height,
					t.pose,
					V_FOV_DEG
				);
				if (projected) {
					inst.targetPos.copy(projected.screenPosition);
					inst.targetQuat.copy(projected.quaternion);
					inst.targetScale = projected.scale;
					inst.hasTarget = true;

					projectedPoses.push({
						id: t.canonicalId,
						position: projected.screenPosition.clone(),
						quaternion: projected.quaternion.clone(),
						scale: projected.scale,
						corners: t.corners
					});

					planeMap[t.canonicalId] = {
						id: t.canonicalId,
						avgWidthPx: projected.avgWidthPx,
						avgHeightPx: projected.avgHeightPx,
						spanPx: projected.spanPx,
						depthCanvasUnits: projected.depthCanvasUnits,
						scale: projected.scale,
						vFovDeg: projected.vFovDeg,
						aspectRatio: projected.aspectRatio
					};
				} else {
					inst.hasTarget = false;
				}
			}

			// Pair seam evaluation when >= 2 paintings are tracked
			const allSeams: SeamEvaluationResult[] =
				manifest && projectedPoses.length >= 2
					? evaluateAllPairSeams(projectedPoses, manifest)
					: [];
			const activeSeam: SeamEvaluationResult | null = allSeams[0] ?? null;

			const calInfo = resolveCalibrationTargetInfo();
			const isGenerating = !calibrationMode && arState === 'generating';
			const isTrackingModel =
				calibrationMode || arState === 'tracking_single' || arState === 'tracking_combined';
			const meshAlpha = isTrackingModel ? (calibrationMode ? calibrationOpacity : crossFadeAlpha) : 0;
			const holoAlpha = isGenerating ? 1 : isTrackingModel && !calibrationMode ? 1 - crossFadeAlpha : 0;

			if (activeSeam?.rule && activeSeam.isCompatible) {
				lastValidSeam = activeSeam;
			}

			if (calibrationMode || arState === 'scanning') {
				wasShowingLiveCombined = false;
				singlesWereVisible = false;
				lastValidSeam = null;
			}

			const liveSeam = activeSeam?.rule ? activeSeam : lastValidSeam;

			// Determine if a live or calibrated pair seam owns rendering
			const showLiveCombined =
				!calibrationMode &&
				arState === 'tracking_combined' &&
				Boolean(liveSeam && liveSeam.rule);
			const showCalSeam = calInfo?.kind === 'seam';
			const fadingOutSinglesToCombined =
				showLiveCombined && singlesWereVisible && crossFadeAlpha < 0.99;
			const fadingOutCombinedToSingles =
				!calibrationMode &&
				!showLiveCombined &&
				arState === 'tracking_single' &&
				wasShowingLiveCombined &&
				crossFadeAlpha < 0.99;

			if (showLiveCombined) {
				wasShowingLiveCombined = true;
				if (crossFadeAlpha >= 0.99) {
					singlesWereVisible = false;
				}
			} else if (!fadingOutCombinedToSingles) {
				wasShowingLiveCombined = false;
			}

			const seamPairedIds = new Set<string>();
			if (showLiveCombined && liveSeam) {
				seamPairedIds.add(liveSeam.canvasA.id);
				seamPairedIds.add(liveSeam.canvasB.id);
			}

			if (showLiveCombined && liveSeam?.rule) {
				if (!pairInstance && scene) {
					pairInstance = createPaintingInstance('pair_seam');
					pairExtraGuides = createPairExtraGuides();
					pairInstance.root.add(pairExtraGuides);
				}
				if (pairInstance) {
					void ensureInstanceModel(
						pairInstance,
						liveSeam.rule.id,
						liveSeam.rule.combinedModel.url,
						liveSeam.rule.combinedModel,
						false
					);
				}
			}

			activeCalRoot = null;
			let liveCalSingleFound = false;

			for (const inst of instances.values()) {
				const cfg = manifest ? resolveCanvasConfig(manifest, inst.key) : null;
				const canonId = cfg?.id ?? inst.key;
				const isPairedAway = showLiveCombined && seamPairedIds.has(canonId);
				const isCalThisSingle = calInfo?.kind === 'single' && calInfo.id === canonId;

				const shouldShowInst =
					inst.hasTarget &&
					visible &&
					(calibrationMode
						? isCalThisSingle
						: arState !== 'scanning' && (!isPairedAway || fadingOutSinglesToCombined));

				if (shouldShowInst) {
					const wasVisible = inst.root.visible;
					inst.root.visible = true;
					const quatDot = Math.abs(inst.root.quaternion.dot(inst.targetQuat));
					if (!wasVisible || quatDot < 0.85) {
						inst.root.position.copy(inst.targetPos);
						inst.root.quaternion.copy(inst.targetQuat);
						inst.root.scale.setScalar(inst.targetScale);
					} else {
						inst.root.position.lerp(inst.targetPos, 0.4);
						inst.root.quaternion.slerp(inst.targetQuat, 0.4);
						const curScale = inst.root.scale.x;
						inst.root.scale.setScalar(curScale + (inst.targetScale - curScale) * 0.4);
					}

					inst.canvasGuide.visible = Boolean(calibrationMode && isCalThisSingle);
					inst.hologram.group.visible = !calibrationMode && !isPairedAway && holoAlpha > 0.02;

					if (inst.hologram.group.visible) {
						inst.hologram.ring.rotation.z = nowMs * 0.0025;
						inst.hologram.ring.rotation.x = Math.sin(nowMs * 0.0018) * 0.35;
						inst.hologram.scanPlane.position.z = 0.02 + generatingProgress * 0.48;
						inst.hologram.frameMat.opacity = 0.85 * holoAlpha;
						inst.hologram.ringMat.opacity = 0.8 * holoAlpha;
						inst.hologram.scanMat.opacity = 0.25 * holoAlpha;
					}

					const instAlpha = isPairedAway
						? Math.max(0, 1 - crossFadeAlpha)
						: meshAlpha;
					if (!isPairedAway && !calibrationMode && instAlpha > 0.02) {
						singlesWereVisible = true;
					}

					const wf = Boolean(calibrationMode && isCalThisSingle && calibrationWireframe);
					syncInstanceCrossFade(inst, instAlpha, wf, !calibrationMode && !isPairedAway);
					if (inst.currentMesh) {
						syncModelBoxGuide(
							inst,
							isCalThisSingle ? calInfo?.spec ?? null : null,
							Boolean(calibrationMode && isCalThisSingle)
						);
					}

					if (isCalThisSingle) {
						liveCalSingleFound = true;
						activeCalRoot = inst.root;
					}
				} else {
					inst.root.visible = false;
					inst.canvasGuide.visible = false;
					if (inst.modelBoxGuide) inst.modelBoxGuide.group.visible = false;
				}
			}

			// Preview fallback when calibrating a single target not currently visible in frame
			if (previewSingleInstance) {
				if (calibrationMode && calInfo?.kind === 'single' && !liveCalSingleFound && visible) {
					previewSingleInstance.root.visible = true;
					previewSingleInstance.root.position.copy(PREVIEW_POSE);
					previewSingleInstance.root.quaternion.identity();
					previewSingleInstance.root.scale.setScalar(1.0);
					previewSingleInstance.canvasGuide.visible = true;
					previewSingleInstance.hologram.group.visible = false;

					syncInstanceCrossFade(
						previewSingleInstance,
						calibrationOpacity,
						calibrationWireframe,
						false
					);
					if (previewSingleInstance.currentMesh) {
						syncModelBoxGuide(previewSingleInstance, calInfo.spec, true);
					}
					activeCalRoot = previewSingleInstance.root;
				} else {
					previewSingleInstance.root.visible = false;
				}
			}

			// Pair seam rendering (live tracking_combined, fading out to singles, or calibration mode seam target)
			if (pairInstance) {
				if ((showLiveCombined || fadingOutCombinedToSingles || showCalSeam) && visible) {
					const wasPairVisible = pairInstance.root.visible;
					pairInstance.root.visible = true;
					pairInstance.hologram.group.visible = false;
					pairInstance.canvasGuide.visible = false;

					const useLiveSeam =
						liveSeam &&
						(showLiveCombined ||
							fadingOutCombinedToSingles ||
							(showCalSeam && projectedPoses.length >= 2));

					if (useLiveSeam && liveSeam) {
						const quatDot = Math.abs(
							pairInstance.root.quaternion.dot(liveSeam.pairQuaternion)
						);
						if (!wasPairVisible || quatDot < 0.85) {
							pairInstance.root.position.copy(liveSeam.pairOrigin);
							pairInstance.root.quaternion.copy(liveSeam.pairQuaternion);
							pairInstance.root.scale.setScalar(liveSeam.pairScale);
						} else {
							pairInstance.root.position.lerp(liveSeam.pairOrigin, 0.45);
							pairInstance.root.quaternion.slerp(liveSeam.pairQuaternion, 0.45);
							const curS = pairInstance.root.scale.x;
							pairInstance.root.scale.setScalar(curS + (liveSeam.pairScale - curS) * 0.45);
						}
						updatePairGuidesFromSeam(liveSeam);
					} else {
						pairInstance.root.position.copy(PREVIEW_POSE);
						pairInstance.root.quaternion.identity();
						pairInstance.root.scale.setScalar(0.75);
						updatePairGuidesFromSeam(null);
					}

					if (pairExtraGuides) {
						pairExtraGuides.visible = Boolean(calibrationMode && showCalSeam);
					}

					const wf = Boolean(calibrationMode && showCalSeam && calibrationWireframe);
					const pairAlpha = calibrationMode
						? calibrationOpacity
						: fadingOutCombinedToSingles
							? Math.max(0, 1 - crossFadeAlpha)
							: crossFadeAlpha;
					syncInstanceCrossFade(
						pairInstance,
						pairAlpha,
						wf,
						!calibrationMode && !fadingOutCombinedToSingles
					);
					if (pairInstance.currentMesh) {
						syncModelBoxGuide(
							pairInstance,
							calInfo?.kind === 'seam' ? calInfo.spec : null,
							Boolean(calibrationMode && showCalSeam)
						);
					}

					if (calibrationMode && showCalSeam) {
						activeCalRoot = pairInstance.root;
					}
				} else {
					pairInstance.root.visible = false;
					if (pairExtraGuides) pairExtraGuides.visible = false;
				}
			}

			if (renderer && scene && camera) {
				renderer.render(scene, camera);
			}

			// Throttled diagnostics telemetry for HUD (5 Hz)
			if (onDiagnosticsUpdate && nowMs - diagLastReport >= 200) {
				diagLastReport = nowMs;
				const models: Record<string, ModelBoundsReport> = {};

				for (const inst of instances.values()) {
					const rep = inst.currentMesh?.userData.boundsReport as ModelBoundsReport | undefined;
					if (rep && inst.hasTarget) {
						const cfg = manifest ? resolveCanvasConfig(manifest, inst.key) : null;
						models[cfg?.id ?? inst.key] = rep;
					}
				}
				if (
					calibrationMode &&
					calInfo?.kind === 'single' &&
					!liveCalSingleFound &&
					previewSingleInstance?.currentMesh?.userData.boundsReport
				) {
					models[calInfo.id] = previewSingleInstance.currentMesh.userData
						.boundsReport as ModelBoundsReport;
				}
				if ((showLiveCombined || showCalSeam) && pairInstance?.currentMesh?.userData.boundsReport) {
					const pairKey = calInfo?.kind === 'seam' ? calInfo.id : activeSeam?.rule?.id ?? 'seam';
					models[pairKey] = pairInstance.currentMesh.userData.boundsReport as ModelBoundsReport;
				}

				onDiagnosticsUpdate({
					models,
					planes: planeMap,
					activeSeam: activeSeam ? toSeamDiag(activeSeam) : null,
					allSeams: allSeams.map(toSeamDiag)
				});
			}
		}

		animId = requestAnimationFrame(animate);
	});

	$effect(() => {
		if (renderer && camera && width > 0 && height > 0) {
			renderer.setSize(width, height);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		}
	});

	onDestroy(() => {
		cancelAnimationFrame(animId);
		renderer?.dispose();
	});
</script>

<canvas
	bind:this={canvas}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUpOrCancel}
	onpointercancel={handlePointerUpOrCancel}
	onwheel={handleWheel}
	oncontextmenu={(e) => {
		if (calibrationMode) e.preventDefault();
	}}
	class="absolute inset-0 z-20 h-full w-full transition-opacity duration-300 {calibrationMode
		? 'pointer-events-auto touch-none cursor-grab active:cursor-grabbing'
		: 'pointer-events-none'} {visible ? 'opacity-100' : 'opacity-0'}"
></canvas>
