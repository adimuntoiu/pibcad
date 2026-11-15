import * as THREE from 'three';
import type { Point } from '../types';
import type { ArtManifest, CanvasConfig, EdgeLetter, SeamRule } from '../manifest/types';
import { resolveCanvasConfig } from '../manifest/repository';

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';

export interface PaintingPoseFrame {
	id: string;
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
	scale: number; // canvas width at anchor depth
	corners?: Point[];
}

export interface SeamEvaluationResult {
	rule: SeamRule | null;
	arrangementKey: string | null;
	ruleMatched: boolean;
	canvasA: CanvasConfig;
	canvasB: CanvasConfig;
	sideA: EdgeSide;
	sideB: EdgeSide;
	edgeA: EdgeLetter;
	edgeB: EdgeLetter;
	pairCode: string;
	gapRatio: number;
	lateralOffsetRatio: number;
	outOfPlaneRatio: number;
	normalAngleDeg: number;
	isCoplanar: boolean;
	withinGap: boolean;
	withinLateral: boolean;
	isCompatible: boolean;
	failureReasons: string[];
	/** Pair seam frame: origin at seam midpoint, scale = average canvas width. */
	pairOrigin: THREE.Vector3;
	pairQuaternion: THREE.Quaternion;
	pairScale: number;
	seamLineStart: THREE.Vector3;
	seamLineEnd: THREE.Vector3;
}

const EDGES: Array<{ side: EdgeSide; i0: number; i1: number }> = [
	{ side: 'top', i0: 0, i1: 1 },
	{ side: 'right', i0: 1, i1: 2 },
	{ side: 'bottom', i0: 2, i1: 3 },
	{ side: 'left', i0: 3, i1: 0 }
];

/**
 * Determines which physical edges of Canvas A and Canvas B are facing each other
 * based on canonical [TL, TR, BR, BL] 2D corners.
 * This is 100% rotation-invariant and robust to 3D pitch/yaw noise from solvePnP.
 */
export function determineFacingSidesFromCorners(
	cornersA: Point[],
	cornersB: Point[]
): { sideA: EdgeSide; sideB: EdgeSide } | null {
	if (!cornersA || cornersA.length !== 4 || !cornersB || cornersB.length !== 4) {
		return null;
	}

	const cAx = (cornersA[0].x + cornersA[1].x + cornersA[2].x + cornersA[3].x) * 0.25;
	const cAy = (cornersA[0].y + cornersA[1].y + cornersA[2].y + cornersA[3].y) * 0.25;
	const cBx = (cornersB[0].x + cornersB[1].x + cornersB[2].x + cornersB[3].x) * 0.25;
	const cBy = (cornersB[0].y + cornersB[1].y + cornersB[2].y + cornersB[3].y) * 0.25;

	const dABx = cBx - cAx;
	const dABy = cBy - cAy;
	const dBAx = -dABx;
	const dBAy = -dABy;

	let bestPair: { sideA: EdgeSide; sideB: EdgeSide; distSq: number } | null = null;

	for (const eA of EDGES) {
		const mAx = (cornersA[eA.i0].x + cornersA[eA.i1].x) * 0.5;
		const mAy = (cornersA[eA.i0].y + cornersA[eA.i1].y) * 0.5;
		const outAx = mAx - cAx;
		const outAy = mAy - cAy;
		const dotA = outAx * dABx + outAy * dABy;
		if (dotA <= 0) continue;

		for (const eB of EDGES) {
			const mBx = (cornersB[eB.i0].x + cornersB[eB.i1].x) * 0.5;
			const mBy = (cornersB[eB.i0].y + cornersB[eB.i1].y) * 0.5;
			const outBx = mBx - cBx;
			const outBy = mBy - cBy;
			const dotB = outBx * dBAx + outBy * dBAy;
			if (dotB <= 0) continue;

			const distSq = (mAx - mBx) ** 2 + (mAy - mBy) ** 2;
			if (!bestPair || distSq < bestPair.distSq) {
				bestPair = { sideA: eA.side, sideB: eB.side, distSq };
			}
		}
	}

	if (bestPair) {
		return { sideA: bestPair.sideA, sideB: bestPair.sideB };
	}

	let maxDotA = -Infinity;
	let sideA: EdgeSide = 'right';
	for (const eA of EDGES) {
		const mAx = (cornersA[eA.i0].x + cornersA[eA.i1].x) * 0.5;
		const mAy = (cornersA[eA.i0].y + cornersA[eA.i1].y) * 0.5;
		const dot = (mAx - cAx) * dABx + (mAy - cAy) * dABy;
		if (dot > maxDotA) {
			maxDotA = dot;
			sideA = eA.side;
		}
	}

	let maxDotB = -Infinity;
	let sideB: EdgeSide = 'left';
	for (const eB of EDGES) {
		const mBx = (cornersB[eB.i0].x + cornersB[eB.i1].x) * 0.5;
		const mBy = (cornersB[eB.i0].y + cornersB[eB.i1].y) * 0.5;
		const dot = (mBx - cBx) * dBAx + (mBy - cBy) * dBAy;
		if (dot > maxDotB) {
			maxDotB = dot;
			sideB = eB.side;
		}
	}

	return { sideA, sideB };
}

export function directionToEdgeSide(localDx: number, localDy: number): EdgeSide {
	if (Math.abs(localDx) >= Math.abs(localDy)) {
		return localDx >= 0 ? 'right' : 'left';
	}
	return localDy >= 0 ? 'top' : 'bottom';
}

/**
 * Evaluates geometry and rule compatibility between two tracked paintings in both local frames,
 * and constructs the Pair Seam Frame centered on the seam midpoint (`1 unit = avg canvas width`).
 */
export function evaluatePairSeam(
	poseA: PaintingPoseFrame,
	poseB: PaintingPoseFrame,
	manifest: ArtManifest
): SeamEvaluationResult | null {
	const cfgA = resolveCanvasConfig(manifest, poseA.id);
	const cfgB = resolveCanvasConfig(manifest, poseB.id);
	if (!cfgA || !cfgB) return null;

	const avgScale = (poseA.scale + poseB.scale) * 0.5;
	if (avgScale <= 1e-6) return null;

	// Express neighbor center in each painting's own local frame (+X right, +Y top, +Z outward)
	const diffAinB = new THREE.Vector3()
		.subVectors(poseA.position, poseB.position)
		.applyQuaternion(poseB.quaternion.clone().invert())
		.divideScalar(avgScale);
	const diffBinA = new THREE.Vector3()
		.subVectors(poseB.position, poseA.position)
		.applyQuaternion(poseA.quaternion.clone().invert())
		.divideScalar(avgScale);

	let sideA: EdgeSide;
	let sideB: EdgeSide;

	if (
		poseA.corners &&
		poseA.corners.length === 4 &&
		poseB.corners &&
		poseB.corners.length === 4
	) {
		const facing = determineFacingSidesFromCorners(poseA.corners, poseB.corners);
		if (facing) {
			sideA = facing.sideA;
			sideB = facing.sideB;
		} else {
			sideA = directionToEdgeSide(diffBinA.x, diffBinA.y);
			sideB = directionToEdgeSide(diffAinB.x, diffAinB.y);
		}
	} else {
		sideA = directionToEdgeSide(diffBinA.x, diffBinA.y);
		sideB = directionToEdgeSide(diffAinB.x, diffAinB.y);
	}

	const edgeA = cfgA.edges[sideA];
	const edgeB = cfgB.edges[sideB];
	const pairCode = `${edgeA}${edgeB}`;

	const isHorizontalA = sideA === 'right' || sideA === 'left';
	const domDistA = isHorizontalA ? Math.abs(diffBinA.x) : Math.abs(diffBinA.y);
	const latDistA = isHorizontalA ? Math.abs(diffBinA.y) : Math.abs(diffBinA.x);

	const isHorizontalB = sideB === 'right' || sideB === 'left';
	const domDistB = isHorizontalB ? Math.abs(diffAinB.x) : Math.abs(diffAinB.y);
	const latDistB = isHorizontalB ? Math.abs(diffAinB.y) : Math.abs(diffAinB.x);

	const gapRatioA = domDistA - 1.0;
	const gapRatioB = domDistB - 1.0;
	const gapRatio = Math.max(0, (gapRatioA + gapRatioB) * 0.5);
	const lateralOffsetRatio = Math.max(latDistA, latDistB);
	const outOfPlaneRatio = Math.max(Math.abs(diffBinA.z), Math.abs(diffAinB.z));

	const normalA = new THREE.Vector3(0, 0, 1).applyQuaternion(poseA.quaternion).normalize();
	const normalB = new THREE.Vector3(0, 0, 1).applyQuaternion(poseB.quaternion).normalize();
	const dotN = Math.max(-1, Math.min(1, normalA.dot(normalB)));
	const normalAngleDeg = (Math.acos(dotN) * 180) / Math.PI;

	const tol = manifest.tolerances;
	const maxOutOfPlaneRatio = tol.maxOutOfPlaneRatio ?? 0.35;
	const withinGap =
		domDistA >= 0.65 &&
		domDistA <= 1.0 + tol.maxGapRatio &&
		domDistB >= 0.65 &&
		domDistB <= 1.0 + tol.maxGapRatio;
	const withinLateral =
		latDistA <= tol.maxLateralOffsetRatio && latDistB <= tol.maxLateralOffsetRatio;
	const isCoplanar = normalAngleDeg <= tol.maxNormalAngleDeg && outOfPlaneRatio <= maxOutOfPlaneRatio;

	const matchedRule =
		manifest.seamRules.find(
			(r) =>
				(r.canvasAId === cfgA.id &&
					r.canvasBId === cfgB.id &&
					r.edgeA === edgeA &&
					r.edgeB === edgeB) ||
				(r.canvasAId === cfgB.id &&
					r.canvasBId === cfgA.id &&
					r.edgeA === edgeB &&
					r.edgeB === edgeA)
		) ?? null;

	const ruleMatched = Boolean(matchedRule);
	const isCompatible = Boolean(matchedRule && withinGap && withinLateral && isCoplanar);
	const arrangementKey = isCompatible && matchedRule ? matchedRule.id : null;

	const failureReasons: string[] = [];
	if (!ruleMatched) {
		failureReasons.push(`edges ${edgeA}↔${edgeB} incompatible`);
	}
	if (!withinGap) {
		const minDom = Math.min(domDistA, domDistB);
		if (minDom < 0.65) {
			failureReasons.push(`overlap (dist ${minDom.toFixed(2)} < 0.65)`);
		} else {
			failureReasons.push(
				`gap ${(gapRatio * 100).toFixed(1)}% > ${(tol.maxGapRatio * 100).toFixed(1)}%`
			);
		}
	}
	if (!withinLateral) {
		failureReasons.push(
			`lateral ${(lateralOffsetRatio * 100).toFixed(1)}% > ${(tol.maxLateralOffsetRatio * 100).toFixed(1)}%`
		);
	}
	if (!isCoplanar) {
		if (normalAngleDeg > tol.maxNormalAngleDeg) {
			failureReasons.push(
				`angle ${normalAngleDeg.toFixed(1)}° > ${tol.maxNormalAngleDeg.toFixed(1)}°`
			);
		}
		if (outOfPlaneRatio > maxOutOfPlaneRatio) {
			failureReasons.push(
				`out-of-plane ${(outOfPlaneRatio * 100).toFixed(1)}% > ${(maxOutOfPlaneRatio * 100).toFixed(1)}%`
			);
		}
	}

	// Build orthonormal Pair Seam Frame
	const zAxis = new THREE.Vector3().addVectors(normalA, normalB).normalize();
	if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 0, 1);

	const isSwappedSeam =
		(edgeA === 'C' && edgeB === 'C') || (edgeA === 'D' && edgeB === 'D');
	const canonicalLeftId = matchedRule
		? isSwappedSeam
			? matchedRule.canvasBId
			: matchedRule.canvasAId
		: cfgA.id <= cfgB.id
			? cfgA.id
			: cfgB.id;
	const fromPose = cfgA.id === canonicalLeftId ? poseA : poseB;
	const toPose = cfgA.id === canonicalLeftId ? poseB : poseA;

	const pairVec = new THREE.Vector3().subVectors(toPose.position, fromPose.position);
	pairVec.addScaledVector(zAxis, -pairVec.dot(zAxis));
	if (pairVec.lengthSq() < 1e-6) {
		pairVec.set(1, 0, 0).applyQuaternion(fromPose.quaternion);
	}
	const xAxis = pairVec.normalize();
	const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

	const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
	const pairQuaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
	const pairOrigin = new THREE.Vector3()
		.addVectors(poseA.position, poseB.position)
		.multiplyScalar(0.5);

	const halfSeam = yAxis.clone().multiplyScalar(avgScale * 0.55);
	const seamLineStart = pairOrigin.clone().sub(halfSeam);
	const seamLineEnd = pairOrigin.clone().add(halfSeam);

	return {
		rule: matchedRule,
		arrangementKey,
		ruleMatched,
		canvasA: cfgA,
		canvasB: cfgB,
		sideA,
		sideB,
		edgeA,
		edgeB,
		pairCode,
		gapRatio,
		lateralOffsetRatio,
		outOfPlaneRatio,
		normalAngleDeg,
		isCoplanar,
		withinGap,
		withinLateral,
		isCompatible,
		failureReasons,
		pairOrigin,
		pairQuaternion,
		pairScale: avgScale,
		seamLineStart,
		seamLineEnd
	};
}

/**
 * Evaluates all unordered pairs among tracked paintings and sorts compatible seams first,
 * then by ascending gap ratio.
 */
export function evaluateAllPairSeams(
	poses: PaintingPoseFrame[],
	manifest: ArtManifest
): SeamEvaluationResult[] {
	const sortedPoses = [...poses].sort((a, b) => a.id.localeCompare(b.id));
	const results: SeamEvaluationResult[] = [];
	for (let i = 0; i < sortedPoses.length; i += 1) {
		for (let j = i + 1; j < sortedPoses.length; j += 1) {
			const res = evaluatePairSeam(sortedPoses[i], sortedPoses[j], manifest);
			if (res) results.push(res);
		}
	}
	results.sort((a, b) => {
		if (a.isCompatible !== b.isCompatible) return a.isCompatible ? -1 : 1;
		return a.gapRatio - b.gapRatio;
	});
	return results;
}
