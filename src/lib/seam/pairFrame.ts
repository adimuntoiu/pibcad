import * as THREE from 'three';
import type { ArtManifest, CanvasConfig, EdgeLetter, SeamRule } from '../manifest/types';
import { resolveCanvasConfig } from '../manifest/repository';

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';

export interface PaintingPoseFrame {
	id: string;
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
	scale: number; // canvas width at anchor depth
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

	const sideA = directionToEdgeSide(diffBinA.x, diffBinA.y);
	const sideB = directionToEdgeSide(diffAinB.x, diffAinB.y);
	const edgeA = cfgA.edges[sideA];
	const edgeB = cfgB.edges[sideB];
	const pairCode = `${edgeA}${edgeB}`;

	const domDistA = Math.max(Math.abs(diffBinA.x), Math.abs(diffBinA.y));
	const latDistA = Math.min(Math.abs(diffBinA.x), Math.abs(diffBinA.y));
	const domDistB = Math.max(Math.abs(diffAinB.x), Math.abs(diffAinB.y));
	const latDistB = Math.min(Math.abs(diffAinB.x), Math.abs(diffAinB.y));

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
	const withinGap =
		domDistA >= 0.75 &&
		domDistA <= 1.0 + tol.maxGapRatio &&
		domDistB >= 0.75 &&
		domDistB <= 1.0 + tol.maxGapRatio;
	const withinLateral =
		latDistA <= tol.maxLateralOffsetRatio && latDistB <= tol.maxLateralOffsetRatio;
	const isCoplanar = normalAngleDeg <= tol.maxNormalAngleDeg && outOfPlaneRatio <= 0.35;

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
		if (minDom < 0.75) {
			failureReasons.push(`overlap (dist ${minDom.toFixed(2)} < 0.75)`);
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
		if (outOfPlaneRatio > 0.35) {
			failureReasons.push(`out-of-plane ${(outOfPlaneRatio * 100).toFixed(1)}% > 35.0%`);
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
