import * as THREE from 'three';
import type {
	AxisConvention,
	ModelSpec,
	NormalizedModelSpec,
	PivotPoint,
	PlacementMode
} from '../manifest/types';
import { normalizeModelSpec } from '../manifest/repository';

export type Vec3Tuple = [number, number, number];

export interface ModelBoundsReport {
	rawMin: Vec3Tuple;
	rawMax: Vec3Tuple;
	rawSize: Vec3Tuple;
	rawCenter: Vec3Tuple;
	/** Relative position of raw origin (0,0,0) inside the raw bounding box [0=min, 0.5=center, 1=max]. */
	originRelativeToBox: Vec3Tuple;
	/** Post-normalization bounding box in canvas-width units (before placement offset/scale). */
	normalizedMin: Vec3Tuple;
	normalizedMax: Vec3Tuple;
	normalizedSize: Vec3Tuple;
	pivot: PivotPoint;
	mode: PlacementMode;
	axisConvention: AxisConvention;
	units: 'canvas-widths';
}

export interface NormalizationParams {
	orientedMin: Vec3Tuple;
	orientedMax: Vec3Tuple;
	orientedSize: Vec3Tuple;
	orientedCenter: Vec3Tuple;
	baseScale: number;
	fitScaleVec: Vec3Tuple;
	pivotShift: Vec3Tuple;
	report: ModelBoundsReport;
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function tuple4(a: number, b: number, c: number): Vec3Tuple {
	return [round4(a), round4(b), round4(c)];
}

/**
 * Pure bounding-box normalization calculator (no Three.js scene dependency; unit tested cleanly).
 *
 * Depth rule:
 * - `'front'` (default for `'overlay'`): attachment face sits at Z=0 on the painting plane and depth extends toward the viewer (+Z).
 * - `'base'` (default for `'standout'`): XY bottom-center rests at (0,0,0) with depth extending toward the viewer (+Z).
 * - `'center'` (default for `'inside'`): volumetric center placed at (0,0,0).
 * - `'back'`: far viewer-side face placed at Z=0 so the mesh recedes into the wall (-Z).
 */
export function computeNormalizationParams(
	rawMin: Vec3Tuple,
	rawMax: Vec3Tuple,
	rawSpec?: Partial<ModelSpec>
): NormalizationParams {
	const spec: NormalizedModelSpec = normalizeModelSpec({
		url: rawSpec?.url ?? '',
		...rawSpec
	});

	const rawSize: Vec3Tuple = [
		Math.max(0, rawMax[0] - rawMin[0]),
		Math.max(0, rawMax[1] - rawMin[1]),
		Math.max(0, rawMax[2] - rawMin[2])
	];
	const rawCenter: Vec3Tuple = [
		(rawMin[0] + rawMax[0]) * 0.5,
		(rawMin[1] + rawMax[1]) * 0.5,
		(rawMin[2] + rawMax[2]) * 0.5
	];
	const originRelativeToBox: Vec3Tuple = [
		rawSize[0] > 1e-6 ? (0 - rawMin[0]) / rawSize[0] : 0.5,
		rawSize[1] > 1e-6 ? (0 - rawMin[1]) / rawSize[1] : 0.5,
		rawSize[2] > 1e-6 ? (0 - rawMin[2]) / rawSize[2] : 0.5
	];

	// Step A: Axis convention ('zUp' rotates -90 deg around X: (x, y, z) -> (x, z, -y))
	let axMin: Vec3Tuple = [rawMin[0], rawMin[1], rawMin[2]];
	let axMax: Vec3Tuple = [rawMax[0], rawMax[1], rawMax[2]];
	if (spec.axisConvention === 'zUp') {
		axMin = [rawMin[0], rawMin[2], -rawMax[1]];
		axMax = [rawMax[0], rawMax[2], -rawMin[1]];
	}

	// Step B: Axis flip in canvas space (scale -1 reverses bounds [a, b] -> [-b, -a])
	const orientedMin: Vec3Tuple = [
		spec.flip[0] ? -axMax[0] : axMin[0],
		spec.flip[1] ? -axMax[1] : axMin[1],
		spec.flip[2] ? -axMax[2] : axMin[2]
	];
	const orientedMax: Vec3Tuple = [
		spec.flip[0] ? -axMin[0] : axMax[0],
		spec.flip[1] ? -axMin[1] : axMax[1],
		spec.flip[2] ? -axMin[2] : axMax[2]
	];
	const orientedSize: Vec3Tuple = [
		Math.max(0, orientedMax[0] - orientedMin[0]),
		Math.max(0, orientedMax[1] - orientedMin[1]),
		Math.max(0, orientedMax[2] - orientedMin[2])
	];
	const orientedCenter: Vec3Tuple = [
		(orientedMin[0] + orientedMax[0]) * 0.5,
		(orientedMin[1] + orientedMax[1]) * 0.5,
		(orientedMin[2] + orientedMax[2]) * 0.5
	];

	// Step C: Uniform scale so configured fitDimension matches fitFraction canvas widths
	let refDim = orientedSize[0];
	if (spec.fitDimension === 'height') {
		refDim = orientedSize[1];
	} else if (spec.fitDimension === 'max') {
		refDim = Math.max(orientedSize[0], orientedSize[1]);
	}
	const baseScale = refDim > 1e-6 ? spec.fitFraction / refDim : 1.0;

	const sx = (spec.flip[0] ? -1 : 1) * baseScale;
	const sy = (spec.flip[1] ? -1 : 1) * baseScale;
	const sz = (spec.flip[2] ? -1 : 1) * baseScale * spec.depthScale;
	const fitScaleVec: Vec3Tuple = [sx, sy, sz];

	const scaledMin: Vec3Tuple = [
		orientedMin[0] * baseScale,
		orientedMin[1] * baseScale,
		orientedMin[2] * baseScale * spec.depthScale
	];
	const scaledMax: Vec3Tuple = [
		orientedMax[0] * baseScale,
		orientedMax[1] * baseScale,
		orientedMax[2] * baseScale * spec.depthScale
	];
	const scaledCenter: Vec3Tuple = [
		orientedCenter[0] * baseScale,
		orientedCenter[1] * baseScale,
		orientedCenter[2] * baseScale * spec.depthScale
	];

	// Step D: Shift selected pivot to local (0, 0, 0)
	let shiftX = -scaledCenter[0];
	let shiftY = -scaledCenter[1];
	let shiftZ = -scaledMin[2];

	if (spec.pivot === 'base') {
		shiftY = -scaledMin[1];
		shiftZ = -scaledMin[2];
	} else if (spec.pivot === 'center') {
		shiftZ = -scaledCenter[2];
	} else if (spec.pivot === 'back') {
		shiftZ = -scaledMax[2];
	} else {
		// 'front' (default overlay): painting plane sits at minZ=0, depth extends toward +Z viewer
		shiftZ = -scaledMin[2];
	}

	const pivotShift: Vec3Tuple = [shiftX, shiftY, shiftZ];
	const normalizedMin = tuple4(scaledMin[0] + shiftX, scaledMin[1] + shiftY, scaledMin[2] + shiftZ);
	const normalizedMax = tuple4(scaledMax[0] + shiftX, scaledMax[1] + shiftY, scaledMax[2] + shiftZ);
	const normalizedSize = tuple4(
		normalizedMax[0] - normalizedMin[0],
		normalizedMax[1] - normalizedMin[1],
		normalizedMax[2] - normalizedMin[2]
	);

	return {
		orientedMin,
		orientedMax,
		orientedSize,
		orientedCenter,
		baseScale,
		fitScaleVec,
		pivotShift,
		report: {
			rawMin: tuple4(rawMin[0], rawMin[1], rawMin[2]),
			rawMax: tuple4(rawMax[0], rawMax[1], rawMax[2]),
			rawSize: tuple4(rawSize[0], rawSize[1], rawSize[2]),
			rawCenter: tuple4(rawCenter[0], rawCenter[1], rawCenter[2]),
			originRelativeToBox: tuple4(
				originRelativeToBox[0],
				originRelativeToBox[1],
				originRelativeToBox[2]
			),
			normalizedMin,
			normalizedMax,
			normalizedSize,
			pivot: spec.pivot,
			mode: spec.mode,
			axisConvention: spec.axisConvention,
			units: 'canvas-widths'
		}
	};
}

/** Measures the overall raw Box3 of a Three.js Group. */
export function measureRawBounds(group: THREE.Group): {
	min: Vec3Tuple;
	max: Vec3Tuple;
} {
	group.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(group);
	if (box.isEmpty()) {
		return { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0.2] };
	}
	return {
		min: [box.min.x, box.min.y, box.min.z],
		max: [box.max.x, box.max.y, box.max.z]
	};
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Wraps a raw loaded 3D model in a two-tier normalized + placement hierarchy:
 * `root -> placementGroup -> pivotGroup -> scaleFlipGroup -> axisGroup -> sourceGroup`
 * so `finalTransform = placement * normalization`.
 */
export function buildNormalizedModelHierarchy(
	sourceGroup: THREE.Group,
	rawSpec?: Partial<ModelSpec>
): THREE.Group {
	sourceGroup.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			if (!child.geometry.attributes.normal) {
				child.geometry.computeVertexNormals();
			}
			const mats = Array.isArray(child.material) ? child.material : [child.material];
			for (const m of mats) {
				if (m) {
					m.side = THREE.DoubleSide;
				}
			}
		}
	});

	const { min: rawMin, max: rawMax } = measureRawBounds(sourceGroup);

	const axisGroup = new THREE.Group();
	axisGroup.name = 'pibcad_axis';
	axisGroup.add(sourceGroup);

	const scaleFlipGroup = new THREE.Group();
	scaleFlipGroup.name = 'pibcad_fit_flip';
	scaleFlipGroup.add(axisGroup);

	const pivotGroup = new THREE.Group();
	pivotGroup.name = 'pibcad_pivot';
	pivotGroup.add(scaleFlipGroup);

	const placementGroup = new THREE.Group();
	placementGroup.name = 'pibcad_placement';
	placementGroup.add(pivotGroup);

	const root = new THREE.Group();
	root.name = 'pibcad_normalized_root';
	root.add(placementGroup);
	root.userData.rawMin = rawMin;
	root.userData.rawMax = rawMax;
	root.userData.axisGroup = axisGroup;
	root.userData.scaleFlipGroup = scaleFlipGroup;
	root.userData.pivotGroup = pivotGroup;
	root.userData.placementGroup = placementGroup;

	updatePlacementOnRoot(root, rawSpec);
	return root;
}

/**
 * Updates both normalization options (`axisConvention`, `flip`, `pivot`, `depthScale`, `fitDimension`, `fitFraction`)
 * and placement transform (`offset`, `rotation` in degrees, `scale`) live on an existing normalized root without reloading geometry.
 */
export function updatePlacementOnRoot(
	root: THREE.Group,
	rawSpec?: Partial<ModelSpec>
): ModelBoundsReport | null {
	const rawMin = root.userData.rawMin as Vec3Tuple | undefined;
	const rawMax = root.userData.rawMax as Vec3Tuple | undefined;
	const axisGroup = root.userData.axisGroup as THREE.Group | undefined;
	const scaleFlipGroup = root.userData.scaleFlipGroup as THREE.Group | undefined;
	const pivotGroup = root.userData.pivotGroup as THREE.Group | undefined;
	const placementGroup = root.userData.placementGroup as THREE.Group | undefined;

	if (!rawMin || !rawMax || !axisGroup || !scaleFlipGroup || !pivotGroup || !placementGroup) {
		return null;
	}

	const spec = normalizeModelSpec({ url: rawSpec?.url ?? '', ...rawSpec });
	const params = computeNormalizationParams(rawMin, rawMax, spec);

	axisGroup.rotation.set(spec.axisConvention === 'zUp' ? -Math.PI / 2 : 0, 0, 0);
	scaleFlipGroup.scale.set(params.fitScaleVec[0], params.fitScaleVec[1], params.fitScaleVec[2]);
	pivotGroup.position.set(params.pivotShift[0], params.pivotShift[1], params.pivotShift[2]);

	placementGroup.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
	placementGroup.rotation.set(
		spec.rotation[0] * DEG_TO_RAD,
		spec.rotation[1] * DEG_TO_RAD,
		spec.rotation[2] * DEG_TO_RAD
	);
	placementGroup.scale.setScalar(spec.scale);

	root.userData.boundsReport = params.report;
	return params.report;
}
