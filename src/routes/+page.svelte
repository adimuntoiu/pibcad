<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type * as THREE from 'three';
	import CornerOverlay from '#lib/CornerOverlay.svelte';
	import ModelARCanvas, { type ARDiagnostics } from '#lib/3d/ModelARCanvas.svelte';
	import Model3DModal from '#lib/3d/Model3DModal.svelte';
	import { preloadManifestModels, preloadPairModels } from '#lib/3d/modelLoader';
	import {
		StaticManifestRepository,
		getRotatedEdgeLabels,
		normalizeModelSpec,
		resolveCanvasConfig
	} from '#lib/manifest/repository';
	import type { ArtManifest, CanvasEdgeMap, NormalizedModelSpec } from '#lib/manifest/types';
	import { PaintingScanner, type TrackedPainting } from '#lib/recognition/scanner.svelte';
	import { evaluateAllPairSeams, type PaintingPoseFrame } from '#lib/seam/pairFrame';
	import { computeCanvasPoseFromCorners } from '#lib/seam/poseProjection';
	import { ARStateMachine, type ARStateSnapshot } from '#lib/state/arStateMachine';

	const DEFAULT_EDGES: CanvasEdgeMap = { top: 'A', right: 'B', bottom: 'D', left: 'C' };

	const scanner = new PaintingScanner();
	const stateMachine = new ARStateMachine();
	const preloadedIds = new Set<string>();

	let manifest = $state<ArtManifest | null>(null);
	let manifestError = $state<string | null>(null);
	let arSnapshot = $state<ARStateSnapshot>(stateMachine.getSnapshot(0));
	let renderFps = $state(0);

	let video = $state<HTMLVideoElement | null>(null);
	let boxWidth = $state(0);
	let boxHeight = $state(0);
	let videoWidth = $state(0);
	let videoHeight = $state(0);

	let show3DOverlay = $state(true);
	let showDebugHud = $state(true);
	let arDiagnostics = $state<ARDiagnostics | null>(null);
	let selectedPainting = $state<TrackedPainting | null>(null);
	let uploadedModel = $state<THREE.Group | null>(null);
	let uploadedFilename = $state<string | null>(null);

	// Dev-only calibration state (tree-shaken away in production builds)
	const isDev = import.meta.env.DEV;
	let calibrationMode = $state(false);
	let calibrationTargetId = $state('irlo1');
	let calibrationDrafts = $state<Record<string, NormalizedModelSpec>>({});
	let calibrationUndoStacks = $state<Record<string, NormalizedModelSpec[]>>({});
	let calibrationWireframe = $state(false);
	let calibrationOpacity = $state(0.85);
	let calibrationSaving = $state(false);
	let calibrationStatus = $state<string | null>(null);
	let lastGestureUndoAt = 0;

	const running = $derived(
		scanner.status === 'scanning' ||
			scanner.status === 'detected' ||
			scanner.status === 'backend_unreachable'
	);

	const calibrationTargets = $derived.by(() => {
		if (!isDev || !manifest) return [];
		return [
			...manifest.canvases.map((c) => ({ id: c.id, label: c.id })),
			...manifest.seamRules.map((r) => ({
				id: r.id,
				label: r.id.startsWith('seam-') ? r.id : `seam-${r.id}`
			}))
		];
	});

	function getManifestSpec(m: ArtManifest | null, targetId: string): NormalizedModelSpec | null {
		if (!m) return null;
		const canvas = m.canvases.find((c) => c.id === targetId);
		if (canvas) return normalizeModelSpec(canvas.singleModel);
		const rule = m.seamRules.find((r) => r.id === targetId || `seam-${r.id}` === targetId);
		if (rule) return normalizeModelSpec(rule.combinedModel);
		return null;
	}

	function cloneSpec(spec: NormalizedModelSpec): NormalizedModelSpec {
		return {
			...spec,
			offset: [...spec.offset] as [number, number, number],
			rotation: [...spec.rotation] as [number, number, number],
			flip: [...spec.flip] as [boolean, boolean, boolean],
			anchors: spec.anchors ? { ...spec.anchors } : undefined
		};
	}

	const activeCalSpec = $derived.by<NormalizedModelSpec | null>(() => {
		if (!isDev) return null;
		return calibrationDrafts[calibrationTargetId] ?? getManifestSpec(manifest, calibrationTargetId);
	});

	function setCalibrationStatus(msg: string) {
		calibrationStatus = msg;
		setTimeout(() => {
			if (calibrationStatus === msg) calibrationStatus = null;
		}, 2400);
	}

	function ensureCalibrationDraft(targetId: string) {
		if (!isDev || calibrationDrafts[targetId]) return;
		const base = getManifestSpec(manifest, targetId);
		if (base) {
			calibrationDrafts = { ...calibrationDrafts, [targetId]: cloneSpec(base) };
		}
	}

	function toggleCalibrationMode() {
		if (!isDev) return;
		calibrationMode = !calibrationMode;
		if (calibrationMode) {
			if (scanner.paintings.length >= 2 && arDiagnostics?.activeSeam?.ruleId) {
				calibrationTargetId = arDiagnostics.activeSeam.ruleId;
			} else if (scanner.paintings.length > 0 && manifest) {
				calibrationTargetId = canonicalizeId(scanner.paintings[0].id);
			} else if (manifest?.canvases[0]) {
				calibrationTargetId = manifest.canvases[0].id;
			}
			ensureCalibrationDraft(calibrationTargetId);
			show3DOverlay = true;
		}
	}

	function pushUndoSnapshot(targetId: string) {
		const current = calibrationDrafts[targetId] ?? getManifestSpec(manifest, targetId);
		if (!current) return;
		const existing = calibrationUndoStacks[targetId] ?? [];
		calibrationUndoStacks = {
			...calibrationUndoStacks,
			[targetId]: [...existing.slice(-29), cloneSpec(current)]
		};
	}

	function handleCalibrationSpecChange(next: NormalizedModelSpec, pushUndo = false) {
		if (!isDev) return;
		if (pushUndo) {
			pushUndoSnapshot(calibrationTargetId);
		}
		calibrationDrafts = {
			...calibrationDrafts,
			[calibrationTargetId]: cloneSpec(next)
		};
	}

	function handleCalibrationDrag(dxLocal: number, dyLocal: number) {
		if (!isDev || !calibrationMode || !activeCalSpec) return;
		const now = performance.now();
		if (now - lastGestureUndoAt > 600) {
			pushUndoSnapshot(calibrationTargetId);
		}
		lastGestureUndoAt = now;
		const clampOffset = (v: number) => Math.round(Math.max(-2.5, Math.min(2.5, v)) * 1000) / 1000;
		const next = cloneSpec(activeCalSpec);
		next.offset = [
			clampOffset(next.offset[0] + dxLocal),
			clampOffset(next.offset[1] + dyLocal),
			next.offset[2]
		];
		calibrationDrafts = { ...calibrationDrafts, [calibrationTargetId]: next };
	}

	function handleCalibrationScale(scaleFactor: number) {
		if (!isDev || !calibrationMode || !activeCalSpec) return;
		const now = performance.now();
		if (now - lastGestureUndoAt > 600) {
			pushUndoSnapshot(calibrationTargetId);
		}
		lastGestureUndoAt = now;
		const next = cloneSpec(activeCalSpec);
		next.scale = Math.round(Math.max(0.05, Math.min(5, next.scale * scaleFactor)) * 1000) / 1000;
		calibrationDrafts = { ...calibrationDrafts, [calibrationTargetId]: next };
	}

	function handleCalibrationUndo() {
		if (!isDev) return;
		const stack = calibrationUndoStacks[calibrationTargetId] ?? [];
		if (stack.length === 0) return;
		const prev = stack[stack.length - 1];
		calibrationUndoStacks = {
			...calibrationUndoStacks,
			[calibrationTargetId]: stack.slice(0, -1)
		};
		calibrationDrafts = {
			...calibrationDrafts,
			[calibrationTargetId]: cloneSpec(prev)
		};
	}

	function handleCalibrationReset() {
		if (!isDev) return;
		const base = getManifestSpec(manifest, calibrationTargetId);
		if (!base) return;
		pushUndoSnapshot(calibrationTargetId);
		calibrationDrafts = {
			...calibrationDrafts,
			[calibrationTargetId]: cloneSpec(base)
		};
		setCalibrationStatus('Reset to manifest');
	}

	async function handleCalibrationCopyJson() {
		if (!isDev || !activeCalSpec) return;
		try {
			await navigator.clipboard.writeText(JSON.stringify(activeCalSpec, null, 2));
			setCalibrationStatus('Copied JSON');
		} catch {
			setCalibrationStatus('Copy failed');
		}
	}

	async function handleCalibrationSave() {
		if (!isDev || !activeCalSpec) return;
		calibrationSaving = true;
		try {
			const { saveCalibrationSpec } = await import('#lib/calibration/saveCalibration');
			const result = await saveCalibrationSpec(calibrationTargetId, activeCalSpec);
			if (!result.ok || !result.manifest) {
				setCalibrationStatus(result.error ?? 'Save error');
				return;
			}
			manifest = result.manifest;
			const updatedSpec = getManifestSpec(result.manifest, calibrationTargetId);
			if (updatedSpec) {
				calibrationDrafts = {
					...calibrationDrafts,
					[calibrationTargetId]: cloneSpec(updatedSpec)
				};
			}
			setCalibrationStatus('Saved manifest.json');
		} catch (err) {
			setCalibrationStatus(err instanceof Error ? err.message : 'Save failed');
		} finally {
			calibrationSaving = false;
		}
	}

	function canonicalizeId(rawId: string): string {
		return manifest ? (resolveCanvasConfig(manifest, rawId)?.id ?? rawId) : rawId;
	}

	scanner.onDetectionSample = (rawList, nowMs) => {
		const targets = rawList.map((p) => {
			const canonicalId = canonicalizeId(p.id);
			if (manifest && !preloadedIds.has(canonicalId)) {
				preloadedIds.add(canonicalId);
				void preloadPairModels(manifest, canonicalId);
			}
			return {
				id: canonicalId,
				rotationDeg: p.rotationDeg,
				snappedRotationDeg: p.snappedRotationDeg
			};
		});

		let stateKey: string | undefined;
		let isCombined = false;

		if (manifest && rawList.length >= 2 && videoWidth && videoHeight && boxWidth && boxHeight) {
			const poseFrames: PaintingPoseFrame[] = [];
			for (const p of rawList) {
				const proj = computeCanvasPoseFromCorners(
					canonicalizeId(p.id),
					p.corners,
					videoWidth,
					videoHeight,
					boxWidth,
					boxHeight,
					p.pose
				);
				if (proj) {
					poseFrames.push({
						id: proj.id,
						position: proj.position,
						quaternion: proj.quaternion,
						scale: proj.scale
					});
				}
			}

			const allSeams = evaluateAllPairSeams(poseFrames, manifest);
			const primarySeam = allSeams[0];
			if (primarySeam?.isCompatible && primarySeam.arrangementKey) {
				stateKey = `seam:${primarySeam.arrangementKey}`;
				isCombined = true;
			}
		}

		arSnapshot = stateMachine.observe({ targets, stateKey, isCombined }, nowMs);
	};

	function handleFrameTick(nowMs: number) {
		const next = stateMachine.advanceTime(nowMs);
		if (
			next.state !== arSnapshot.state ||
			next.isHolding !== arSnapshot.isHolding ||
			Math.abs(next.generatingProgress - arSnapshot.generatingProgress) > 0.005 ||
			Math.abs(next.crossFadeAlpha - arSnapshot.crossFadeAlpha) > 0.005 ||
			(next.isHolding && Math.abs(next.holdElapsedMs - arSnapshot.holdElapsedMs) > 40)
		) {
			arSnapshot = next;
		}
	}

	function stopScanner() {
		scanner.stop();
		stateMachine.reset();
		preloadedIds.clear();
		arSnapshot = stateMachine.getSnapshot(0);
		arDiagnostics = null;
		renderFps = 0;
		calibrationMode = false;
	}

	function syncVideoSize() {
		if (!video) return;
		videoWidth = video.videoWidth;
		videoHeight = video.videoHeight;
	}

	function onVisibilityChange() {
		if (document.hidden) stopScanner();
		else void scanner.resumeVideo();
	}

	function onModelUploaded(group: THREE.Group, filename: string) {
		uploadedModel = group;
		uploadedFilename = filename;
	}

	onMount(async () => {
		try {
			const repo = new StaticManifestRepository('/demo/manifest.json');
			const loaded = await repo.loadManifest();
			manifest = loaded;
			scanner.holdMs = loaded.animation.dropHoldMs;
			stateMachine.updateConfig(loaded.animation);
			void preloadManifestModels(loaded);
		} catch (err) {
			manifestError = err instanceof Error ? err.message : 'Failed to load demo manifest';
		}
	});

	onDestroy(() => stopScanner());
</script>

<svelte:document onvisibilitychange={onVisibilityChange} />

<main
	class="relative h-dvh w-screen overflow-hidden bg-black select-none"
	bind:clientWidth={boxWidth}
	bind:clientHeight={boxHeight}
>
	<video
		bind:this={video}
		playsinline
		muted
		autoplay
		onloadedmetadata={syncVideoSize}
		onresize={syncVideoSize}
		class="h-full w-full object-cover {running ? 'opacity-100' : 'opacity-0'}"
	></video>

	<!-- 2D Corner + Oriented Edge Tracking Overlay (A/B/C/D rotates physically with artwork) -->
	<CornerOverlay
		paintings={scanner.paintings}
		corners={scanner.corners}
		{manifest}
		activeSeam={arDiagnostics?.activeSeam ?? null}
		{videoWidth}
		{videoHeight}
		width={boxWidth}
		height={boxHeight}
	/>

	<!-- 3D AR Model Overlay (manifest GLBs + generating hologram + smooth cross-fade) -->
	{#if running}
		<ModelARCanvas
			paintings={scanner.paintings}
			corners={scanner.corners}
			paintingId={scanner.paintingId}
			customModelUrl={scanner.modelUrl}
			{manifest}
			arState={isDev && calibrationMode
				? calibrationTargetId.startsWith('seam-')
					? 'tracking_combined'
					: 'tracking_single'
				: arSnapshot.state}
			generatingProgress={arSnapshot.generatingProgress}
			crossFadeAlpha={isDev && calibrationMode ? 1 : arSnapshot.crossFadeAlpha}
			{videoWidth}
			{videoHeight}
			width={boxWidth}
			height={boxHeight}
			userModel={uploadedModel}
			visible={show3DOverlay}
			calibrationMode={isDev ? calibrationMode : false}
			calibrationTargetId={isDev ? calibrationTargetId : null}
			calibrationSpec={isDev ? activeCalSpec : null}
			calibrationWireframe={isDev ? calibrationWireframe : false}
			calibrationOpacity={isDev ? calibrationOpacity : 1}
			onFpsUpdate={(fps) => (renderFps = fps)}
			onFrameTick={handleFrameTick}
			onDiagnosticsUpdate={(diag) => (arDiagnostics = diag)}
			onCalibrationDrag={isDev ? handleCalibrationDrag : undefined}
			onCalibrationScale={isDev ? handleCalibrationScale : undefined}
		/>
	{/if}

	{#if running}
		<header
			class="fixed top-0 right-0 left-0 z-30 flex items-center justify-between gap-2 px-4 pt-[max(0.85rem,env(safe-area-inset-top))]"
		>
			<div
				class="flex items-center gap-2.5 rounded-full border border-white/15 bg-zinc-950/85 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-xl sm:text-sm"
			>
				{#if arSnapshot.state === 'generating'}
					<span class="h-2.5 w-2.5 animate-ping rounded-full bg-amber-400"></span>
					<span>Generating 3D model…</span>
				{:else if scanner.status === 'detected' || arSnapshot.isHolding}
					<span class="h-2.5 w-2.5 rounded-full {arSnapshot.isHolding ? 'bg-amber-400' : 'bg-emerald-400'}"></span>
					<span>
						{scanner.paintings.length > 1
							? `${scanner.paintings.length} paintings locked`
							: 'Painting locked'}
					</span>
				{:else if scanner.status === 'backend_unreachable'}
					<span class="h-2.5 w-2.5 rounded-full bg-red-400"></span>
					<span>Backend unreachable…</span>
				{:else}
					<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400"></span>
					<span>Point camera at irlo1 or irlo2</span>
				{/if}
			</div>

			<div class="flex items-center gap-1.5">
				<!-- Debug HUD Toggle -->
				<button
					type="button"
					onclick={() => (showDebugHud = !showDebugHud)}
					class="rounded-full border px-3 py-2 text-xs font-semibold backdrop-blur-xl transition-colors {showDebugHud
						? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
						: 'border-white/15 bg-zinc-950/85 text-zinc-400 hover:text-white'}"
				>
					HUD
				</button>

				<!-- AR 3D Toggle -->
				<button
					type="button"
					onclick={() => (show3DOverlay = !show3DOverlay)}
					class="rounded-full border px-3 py-2 text-xs font-semibold backdrop-blur-xl transition-colors {show3DOverlay
						? 'border-sky-500/40 bg-sky-500/20 text-sky-300'
						: 'border-white/15 bg-zinc-950/85 text-zinc-400 hover:text-white'}"
				>
					3D: {show3DOverlay ? 'ON' : 'OFF'}
				</button>

				<button
					type="button"
					onclick={stopScanner}
					class="rounded-full border border-white/15 bg-zinc-950/85 px-3.5 py-2 text-xs font-semibold text-white/90 backdrop-blur-xl active:scale-95"
				>
					Close
				</button>
			</div>
		</header>

		<!-- "Generating 3D model…" Hologram Progress Banner -->
		{#if arSnapshot.state === 'generating'}
			<div class="pointer-events-none fixed inset-x-0 top-20 z-30 flex justify-center px-4">
				<div class="w-full max-w-xs rounded-2xl border border-emerald-400/35 bg-zinc-950/90 px-4 py-3 text-center shadow-2xl backdrop-blur-xl">
					<div class="flex items-center justify-center gap-2 text-xs font-semibold tracking-wide text-emerald-300">
						<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent"></span>
						<span>Generating 3D model…</span>
						<span class="font-mono text-zinc-300">
							{Math.round(arSnapshot.generatingProgress * 100)}%
						</span>
					</div>
					<div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
						<div
							class="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-[width] duration-75"
							style="width: {Math.round(arSnapshot.generatingProgress * 100)}%"
						></div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Debug HUD (Dark Translucent Telemetry Panel) -->
		{#if showDebugHud}
			<aside
				class="fixed top-16 left-3 z-30 w-[min(21rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950/85 p-3 font-mono text-[11px] leading-snug text-zinc-200 backdrop-blur-xl {isDev && calibrationMode
					? 'max-h-[34dvh]'
					: 'max-h-[56dvh]'}"
			>
				<div class="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
					<span class="font-sans text-[11px] font-bold tracking-wider text-emerald-400 uppercase">
						AR Debug HUD
					</span>
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] text-zinc-400">
							{renderFps} FPS · {scanner.detectFps} Hz ({scanner.detectLatencyMs} ms)
						</span>
						{#if isDev}
							<button
								type="button"
								onclick={toggleCalibrationMode}
								class="rounded-lg border px-2 py-0.5 font-sans text-[10px] font-bold transition-colors {calibrationMode
									? 'border-amber-400/60 bg-amber-500/25 text-amber-200'
									: 'border-white/15 bg-zinc-900 text-zinc-300 hover:text-white'}"
							>
								{calibrationMode ? 'Cal: ON' : 'Calibrate'}
							</button>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
					<div class="text-zinc-400">State:</div>
					<div class="font-semibold text-white">{arSnapshot.state}</div>

					<div class="text-zinc-400">Active Key:</div>
					<div class="truncate text-sky-300">{arSnapshot.activeKey ?? 'none'}</div>

					<div class="text-zinc-400">Debounce:</div>
					<div>
						{arSnapshot.pendingFrames}/{arSnapshot.requiredDebounceFrames}
						{arSnapshot.pendingKey ? `(${arSnapshot.pendingKey})` : ''}
					</div>

					<div class="text-zinc-400">Drop Hold:</div>
					<div class={arSnapshot.isHolding ? 'text-amber-300' : 'text-zinc-300'}>
						{arSnapshot.isHolding
							? `${Math.round(arSnapshot.holdElapsedMs)} / ${arSnapshot.dropHoldMs} ms`
							: `ready (${arSnapshot.dropHoldMs} ms)`}
					</div>

					<div class="text-zinc-400">Fade Alpha:</div>
					<div>{arSnapshot.crossFadeAlpha.toFixed(2)}</div>
				</div>

				{#if scanner.paintings.length > 0}
					<div class="mt-2 space-y-1.5 border-t border-white/10 pt-2">
						{#each scanner.paintings as p (p.id)}
							{@const cfg = manifest ? resolveCanvasConfig(manifest, p.id) : null}
							{@const canonId = cfg?.id ?? p.id}
							{@const rotatedEdges = getRotatedEdgeLabels(cfg?.edges ?? DEFAULT_EDGES, p.snappedRotationDeg)}
							{@const plane = arDiagnostics?.planes[canonId]}
							<div class="rounded-xl border border-white/10 bg-zinc-900/80 p-2">
								<div class="flex items-center justify-between">
									<span class="font-bold text-emerald-300">{canonId}</span>
									<span class="text-zinc-400">{p.inliers} inliers</span>
								</div>
								<div class="mt-0.5 text-[10px] text-zinc-300">
									Rot: {p.rotationDeg.toFixed(1)}° (snap {p.snappedRotationDeg}°)
								</div>
								<div class="mt-0.5 text-[10px] text-amber-300">
									Edges T:{rotatedEdges.top} R:{rotatedEdges.right} B:{rotatedEdges.bottom} L:{rotatedEdges.left}
								</div>
								{#if p.pose}
									<div class="mt-0.5 text-[10px] text-sky-300">
										Pos: [{p.pose.position.map((v) => v.toFixed(2)).join(', ')}]
									</div>
									<div class="text-[10px] text-zinc-400">
										Norm: [{p.pose.normal.map((v) => v.toFixed(2)).join(', ')}]
									</div>
								{/if}
								{#if plane}
									<div class="mt-0.5 text-[10px] text-violet-300">
										Plane: {Math.round(plane.avgWidthPx)}×{Math.round(plane.avgHeightPx)}px · span {Math.round(plane.spanPx)}px · Z={plane.depthCanvasUnits.toFixed(2)} · scale={plane.scale.toFixed(2)} (vFOV {plane.vFovDeg}°)
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="mt-2 border-t border-white/10 pt-2 text-[10px] text-zinc-500">
						No painting locked in frame.
					</p>
				{/if}

				{#if arDiagnostics?.allSeams && arDiagnostics.allSeams.length > 0}
					<div class="mt-2 space-y-1.5 border-t border-white/10 pt-2">
						<div class="text-[10px] font-bold text-amber-300 uppercase">
							Seam Telemetry ({arDiagnostics.allSeams.length})
						</div>
						{#each arDiagnostics.allSeams as seam, sIdx (`${seam.canvasAId}-${seam.canvasBId}-${sIdx}`)}
							<div class="rounded-xl border border-white/10 bg-zinc-900/80 p-2 text-[10px]">
								<div class="flex items-center justify-between gap-1">
									<span class="font-bold text-sky-300">
										{seam.canvasAId} ({seam.sideA}:{seam.edgeA}) ↔ {seam.canvasBId} ({seam.sideB}:{seam.edgeB})
									</span>
									<span
										class="rounded px-1.5 py-0.5 font-bold {seam.isCompatible
											? 'bg-emerald-500/20 text-emerald-300'
											: 'bg-rose-500/20 text-rose-300'}"
									>
										{seam.isCompatible ? 'YES' : 'NO'}
									</span>
								</div>
								<div class="mt-0.5 text-white">
									Key: <span class="text-emerald-300">{seam.arrangementKey ?? 'none (individual)'}</span> · Sides: {seam.edgeA} ↔ {seam.edgeB}
								</div>
								<div class="mt-0.5 text-zinc-300">
									gap={(seam.gapRatio * 100).toFixed(1)}% · lat={(seam.lateralOffsetRatio * 100).toFixed(1)}% · angle={seam.normalAngleDeg.toFixed(1)}°
								</div>
								{#if !seam.isCompatible && seam.failureReasons.length > 0}
									<div class="mt-0.5 text-rose-300">
										{seam.failureReasons.join(' · ')}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				{#if arDiagnostics && Object.keys(arDiagnostics.models).length > 0}
					<div class="mt-2 space-y-1.5 border-t border-white/10 pt-2">
						<div class="text-[10px] font-bold text-sky-300 uppercase">Model Bounds (after load)</div>
						{#each Object.entries(arDiagnostics.models) as [modelId, rep] (modelId)}
							<div class="rounded-xl border border-white/10 bg-zinc-900/80 p-2 text-[10px]">
								<div class="flex items-center justify-between">
									<span class="font-bold text-white">{modelId}</span>
									<span class="text-zinc-400">{rep.units}</span>
								</div>
								<div class="text-zinc-300">
									rawSize: [{rep.rawSize.map((v) => v.toFixed(3)).join(', ')}]
								</div>
								<div class="text-zinc-400">
									rawCenter: [{rep.rawCenter.map((v) => v.toFixed(3)).join(', ')}]
								</div>
								<div class="text-amber-300">
									originRelBox: [{rep.originRelativeToBox.map((v) => v.toFixed(2)).join(', ')}]
								</div>
								<div class="text-emerald-300">
									normSize: [{rep.normalizedSize.map((v) => v.toFixed(3)).join(', ')}] ({rep.mode}/{rep.pivot}/{rep.axisConvention})
								</div>
							</div>
						{/each}
					</div>
				{/if}

				{#if manifestError}
					<p class="mt-2 text-[10px] text-red-400">Manifest: {manifestError}</p>
				{/if}
			</aside>
		{/if}

		<!-- Bottom Card(s) for Detected Painting(s) (hidden while Calibrating) -->
		{#if !(isDev && calibrationMode)}
			{#if scanner.paintings.length === 1}
			{@const p = scanner.paintings[0]}
			{@const cfg = manifest ? resolveCanvasConfig(manifest, p.id) : null}
			{@const rotatedEdges = getRotatedEdgeLabels(cfg?.edges ?? DEFAULT_EDGES, p.snappedRotationDeg)}
			<section
				class="fixed right-0 bottom-0 left-0 z-30 mx-auto max-w-xl px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]"
			>
				<div class="flex items-center justify-between gap-3 rounded-3xl border border-white/15 bg-zinc-950/90 p-4 backdrop-blur-xl">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<p class="text-[11px] font-semibold tracking-wider text-sky-400 uppercase">
								{p.artist || manifest?.artist || 'IRLO'}
							</p>
							<span class="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
								{p.snappedRotationDeg}° · Top {rotatedEdges.top}
							</span>
						</div>
						<h2 class="truncate text-lg font-bold text-white">{cfg?.name ?? p.title}</h2>
						{#if uploadedFilename}
							<p class="text-xs text-emerald-400">Custom 3D: {uploadedFilename}</p>
						{/if}
					</div>

					<button
						type="button"
						onclick={() => (selectedPainting = p)}
						class="flex shrink-0 items-center gap-2 rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-2.5 text-xs font-semibold text-sky-300 backdrop-blur-xl transition hover:bg-sky-500/30 active:scale-95"
					>
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
							<polyline points="3.27 6.96 12 12.01 20.73 6.96" />
							<line x1="12" y1="22.08" x2="12" y2="12" />
						</svg>
						<span>Inspect 3D</span>
					</button>
				</div>
			</section>
		{:else if scanner.paintings.length > 1}
			<section
				class="fixed right-0 bottom-0 left-0 z-30 mx-auto max-w-3xl space-y-2 px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]"
			>
				{#if arDiagnostics?.activeSeam}
					{@const seam = arDiagnostics.activeSeam}
					<div
						class="flex items-center justify-between gap-2 rounded-2xl border px-3.5 py-2 text-xs backdrop-blur-xl {seam.isCompatible
							? 'border-emerald-400/40 bg-emerald-950/85 text-emerald-100'
							: 'border-rose-400/35 bg-zinc-950/90 text-zinc-200'}"
					>
						<div class="flex items-center gap-2 font-mono">
							<span
								class="rounded-md px-1.5 py-0.5 text-[10px] font-bold {seam.isCompatible
									? 'bg-emerald-500/25 text-emerald-300'
									: 'bg-rose-500/20 text-rose-300'}"
							>
								{seam.edgeA} ↔ {seam.edgeB} · {seam.isCompatible ? 'COMPATIBLE' : 'INCOMPATIBLE'}
							</span>
							<span class="text-[11px] font-semibold text-white">
								{seam.arrangementKey ?? 'Individual models'}
							</span>
						</div>
						<span class="truncate font-mono text-[10px] text-zinc-300">
							{seam.isCompatible
								? `gap ${(seam.gapRatio * 100).toFixed(0)}%`
								: seam.failureReasons[0] ?? 'mismatch'}
						</span>
					</div>
				{/if}
				<div class="flex gap-2.5 overflow-x-auto rounded-3xl border border-white/15 bg-zinc-950/90 p-3 backdrop-blur-xl">
					{#each scanner.paintings as p, idx (p.id)}
						{@const cfg = manifest ? resolveCanvasConfig(manifest, p.id) : null}
						{@const colorDot = idx === 0 ? 'bg-emerald-400' : idx === 1 ? 'bg-sky-400' : idx === 2 ? 'bg-violet-400' : 'bg-amber-400'}
						<div class="flex min-w-[210px] flex-1 items-center justify-between gap-2.5 rounded-2xl border border-white/10 bg-zinc-900/80 px-3.5 py-2.5">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-1.5">
									<span class="h-2 w-2 rounded-full {colorDot}"></span>
									<p class="truncate text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
										{p.artist || 'IRLO'} · {p.snappedRotationDeg}°
									</p>
								</div>
								<h3 class="truncate text-sm font-bold text-white">{cfg?.name ?? p.title}</h3>
							</div>

							<button
								type="button"
								onclick={() => (selectedPainting = p)}
								class="rounded-xl border border-sky-500/40 bg-sky-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/30 active:scale-95"
							>
								3D
							</button>
						</div>
					{/each}
				</div>
			</section>
			{/if}
		{/if}

		<!-- Dev-only Calibration Controls Overlay (dynamically imported & omitted in production builds) -->
		{#if isDev && calibrationMode && activeCalSpec}
			{#await import('#lib/calibration/CalibrationPanel.svelte') then mod}
				{@const CalibrationPanel = mod.default}
				<CalibrationPanel
					targets={calibrationTargets}
					selectedTargetId={calibrationTargetId}
					spec={activeCalSpec}
					wireframe={calibrationWireframe}
					opacity={calibrationOpacity}
					canUndo={(calibrationUndoStacks[calibrationTargetId]?.length ?? 0) > 0}
					saving={calibrationSaving}
					statusMessage={calibrationStatus}
					onSelectTarget={(id) => {
						calibrationTargetId = id;
						ensureCalibrationDraft(id);
					}}
					onBeginEdit={() => pushUndoSnapshot(calibrationTargetId)}
					onChangeSpec={handleCalibrationSpecChange}
					onToggleWireframe={(next) => (calibrationWireframe = next)}
					onChangeOpacity={(next) => (calibrationOpacity = next)}
					onUndo={handleCalibrationUndo}
					onReset={handleCalibrationReset}
					onCopyJson={handleCalibrationCopyJson}
					onSave={handleCalibrationSave}
					onClose={() => (calibrationMode = false)}
				/>
			{/await}
		{/if}
	{:else}
		<div class="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950 px-6 text-center">
			<div class="w-full max-w-sm rounded-3xl border border-white/15 bg-zinc-900 p-7">
				<div class="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
					<span>Phase 1 · IRLO WebAR</span>
				</div>
				<h1 class="text-2xl font-bold text-white">Painting scanner</h1>
				<p class="mt-2 text-sm text-zinc-400">
					Point your camera at <code class="text-zinc-200">irlo1</code> or
					<code class="text-zinc-200">irlo2</code> (even rotated 0°/90°/180°/270°). Real-time AR anchors manifest GLB models onto each canvas.
				</p>

				{#if scanner.status === 'permission_denied' || scanner.status === 'no_camera'}
					<div
						class="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-left text-xs text-red-200"
					>
						<p class="font-semibold text-red-100">
							{scanner.status === 'permission_denied'
								? 'Camera permission denied'
								: 'Camera unavailable'}
						</p>
						<p class="mt-1">{scanner.errorMessage}</p>
					</div>
				{/if}

				{#if manifestError}
					<div class="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left text-xs text-amber-200">
						{manifestError}
					</div>
				{/if}

				<button
					type="button"
					disabled={scanner.status === 'starting_camera'}
					onclick={() => video && scanner.start(video)}
					class="mt-6 w-full rounded-2xl bg-white py-3.5 text-base font-semibold text-black active:scale-[0.98] disabled:opacity-50"
				>
					{scanner.status === 'starting_camera' ? 'Starting camera…' : 'Start scanner'}
				</button>

				<div class="mt-4 grid grid-cols-2 gap-2 text-xs">
					<a
						href="/demo-targets/printable-pair.html"
						target="_blank"
						rel="noreferrer"
						class="rounded-xl border border-white/10 bg-zinc-800/70 px-3 py-2.5 font-medium text-zinc-200 hover:bg-zinc-800"
					>
						Rotation Test Sheet
					</a>
					<a
						href="/compile"
						class="rounded-xl border border-white/10 bg-zinc-800/70 px-3 py-2.5 font-medium text-zinc-200 hover:bg-zinc-800"
					>
						Target Compiler
					</a>
				</div>
			</div>
		</div>
	{/if}

	<!-- 3D Full-screen Inspector & File Drop Modal -->
	{#if selectedPainting}
		{@const cfg = manifest ? resolveCanvasConfig(manifest, selectedPainting.id) : null}
		<Model3DModal
			paintingId={cfg?.id ?? selectedPainting.id}
			title={cfg?.name ?? selectedPainting.title}
			artist={selectedPainting.artist || manifest?.artist || 'IRLO'}
			customModelUrl={cfg?.singleModel.url ?? selectedPainting.modelUrl}
			userModel={uploadedModel}
			onClose={() => (selectedPainting = null)}
			{onModelUploaded}
		/>
	{/if}
</main>
