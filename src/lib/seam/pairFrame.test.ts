import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ArtManifest } from '../manifest/types';
import {
	determineFacingSidesFromCorners,
	evaluateAllPairSeams,
	evaluatePairSeam,
	type PaintingPoseFrame
} from './pairFrame';

const TEST_MANIFEST: ArtManifest = {
	version: '1.0',
	artist: 'IRLO',
	canvases: [
		{
			id: 'irlo1',
			name: 'IRLO I',
			imageTargetUrl: '/demo/irlo1.jpg',
			edges: { top: 'C', right: 'A', bottom: 'B', left: 'D' },
			singleModel: { url: '/demo/models/irlo1_single.glb' }
		},
		{
			id: 'irlo2',
			name: 'IRLO II',
			imageTargetUrl: '/demo/irlo2.jpg',
			edges: { top: 'A', right: 'C', bottom: 'B', left: 'D' },
			singleModel: { url: '/demo/models/irlo2_single.glb' }
		},
		{
			id: 'irlo3',
			name: 'IRLO III (Tile)',
			imageTargetUrl: '/demo/irlo1.jpg',
			edges: { top: 'C', right: 'A', bottom: 'B', left: 'D' },
			singleModel: { url: '/demo/models/irlo1_single.glb' }
		}
	],
	seamRules: [
		{
			id: 'seam-AA',
			canvasAId: 'irlo1',
			canvasBId: 'irlo2',
			edgeA: 'A',
			edgeB: 'A',
			combinedModel: { url: '/demo/models/combined_AA.glb' }
		},
		{
			id: 'seam-BB',
			canvasAId: 'irlo1',
			canvasBId: 'irlo2',
			edgeA: 'B',
			edgeB: 'B',
			combinedModel: { url: '/demo/models/combined_BB.glb' }
		},
		{
			id: 'seam-CC',
			canvasAId: 'irlo1',
			canvasBId: 'irlo2',
			edgeA: 'C',
			edgeB: 'C',
			combinedModel: { url: '/demo/models/combined_CC.glb' }
		},
		{
			id: 'seam-DD',
			canvasAId: 'irlo1',
			canvasBId: 'irlo2',
			edgeA: 'D',
			edgeB: 'D',
			combinedModel: { url: '/demo/models/combined_DD.glb' }
		}
	],
	tolerances: {
		maxGapRatio: 0.2,
		maxLateralOffsetRatio: 0.35,
		maxNormalAngleDeg: 20
	},
	animation: {
		loadingDurationMs: 1200,
		stateDebounceFrames: 5,
		dropHoldMs: 500,
		crossFadeDurationMs: 400
	}
};

function cwRotQuat(deg: number): THREE.Quaternion {
	return new THREE.Quaternion().setFromEuler(
		new THREE.Euler(0, 0, (-deg * Math.PI) / 180, 'XYZ')
	);
}

describe('evaluatePairSeam', () => {
	it('evaluates all 16 orientation combinations (4 valid, 12 invalid) accurately', () => {
		const validExpected = new Map<string, { edge: string; key: string }>([
			['0,270', { edge: 'A', key: 'seam-AA' }],
			['270,90', { edge: 'B', key: 'seam-BB' }],
			['90,180', { edge: 'C', key: 'seam-CC' }],
			['180,0', { edge: 'D', key: 'seam-DD' }]
		]);

		let validCount = 0;
		let invalidCount = 0;

		for (const rotA of [0, 90, 180, 270]) {
			for (const rotB of [0, 90, 180, 270]) {
				const poseA: PaintingPoseFrame = {
					id: 'irlo1',
					position: new THREE.Vector3(-0.55, 0, -2),
					quaternion: cwRotQuat(rotA),
					scale: 1.0
				};
				const poseB: PaintingPoseFrame = {
					id: 'irlo2',
					position: new THREE.Vector3(0.55, 0, -2),
					quaternion: cwRotQuat(rotB),
					scale: 1.0
				};

				const result = evaluatePairSeam(poseA, poseB, TEST_MANIFEST);
				expect(result).not.toBeNull();
				expect(result!.withinGap).toBe(true);
				expect(result!.withinLateral).toBe(true);
				expect(result!.isCoplanar).toBe(true);
				expect(result!.gapRatio).toBeCloseTo(0.1, 4);

				const expected = validExpected.get(`${rotA},${rotB}`);
				if (expected) {
					validCount += 1;
					expect(result!.edgeA).toBe(expected.edge);
					expect(result!.edgeB).toBe(expected.edge);
					expect(result!.ruleMatched).toBe(true);
					expect(result!.isCompatible).toBe(true);
					expect(result!.arrangementKey).toBe(expected.key);
					expect(result!.failureReasons).toHaveLength(0);
					expect(result!.pairOrigin.toArray()).toEqual([0, 0, -2]);
					expect(result!.pairScale).toBeCloseTo(1.0, 4);
				} else {
					invalidCount += 1;
					expect(result!.edgeA).not.toBe(result!.edgeB);
					expect(result!.ruleMatched).toBe(false);
					expect(result!.isCompatible).toBe(false);
					expect(result!.arrangementKey).toBeNull();
					expect(result!.failureReasons[0]).toContain('incompatible');
				}
			}
		}

		expect(validCount).toBe(4);
		expect(invalidCount).toBe(12);
	});

	it('is invariant to global orientation (vertical stack & 37° diagonal wall angle)', () => {
		// Base AA pair: irlo1 (-0.55, 0) at 0° CW, irlo2 (+0.55, 0) at 270° CW
		const basePosA = new THREE.Vector3(-0.55, 0, 0);
		const basePosB = new THREE.Vector3(0.55, 0, 0);
		const baseQuatA = cwRotQuat(0);
		const baseQuatB = cwRotQuat(270);

		for (const worldAngleDeg of [90, 37, -142]) {
			const worldQ = cwRotQuat(worldAngleDeg);
			const center = new THREE.Vector3(0.4, -0.2, -2.5);

			const poseA: PaintingPoseFrame = {
				id: 'irlo1',
				position: basePosA.clone().applyQuaternion(worldQ).add(center),
				quaternion: worldQ.clone().multiply(baseQuatA),
				scale: 1.0
			};
			const poseB: PaintingPoseFrame = {
				id: 'irlo2',
				position: basePosB.clone().applyQuaternion(worldQ).add(center),
				quaternion: worldQ.clone().multiply(baseQuatB),
				scale: 1.0
			};

			const res = evaluatePairSeam(poseA, poseB, TEST_MANIFEST);
			expect(res).not.toBeNull();
			expect(res!.edgeA).toBe('A');
			expect(res!.edgeB).toBe('A');
			expect(res!.isCompatible).toBe(true);
			expect(res!.arrangementKey).toBe('seam-AA');
			expect(res!.gapRatio).toBeCloseTo(0.1, 4);
			expect(res!.lateralOffsetRatio).toBeCloseTo(0, 4);
			expect(res!.pairOrigin.distanceTo(center)).toBeLessThan(1e-4);
		}
	});

	it('handles tight, boundary, excessive, and overlapping gaps', () => {
		const makePair = (halfCenterDist: number) =>
			evaluatePairSeam(
				{
					id: 'irlo1',
					position: new THREE.Vector3(-halfCenterDist, 0, -2),
					quaternion: cwRotQuat(0),
					scale: 1.0
				},
				{
					id: 'irlo2',
					position: new THREE.Vector3(halfCenterDist, 0, -2),
					quaternion: cwRotQuat(270),
					scale: 1.0
				},
				TEST_MANIFEST
			)!;

		const tight = makePair(0.52); // gapRatio = 0.04
		expect(tight.gapRatio).toBeCloseTo(0.04, 4);
		expect(tight.withinGap).toBe(true);
		expect(tight.isCompatible).toBe(true);

		const boundary = makePair(0.595); // gapRatio = 0.19 <= 0.20
		expect(boundary.gapRatio).toBeCloseTo(0.19, 4);
		expect(boundary.withinGap).toBe(true);
		expect(boundary.isCompatible).toBe(true);

		const wide = makePair(0.64); // gapRatio = 0.28 > 0.20
		expect(wide.gapRatio).toBeCloseTo(0.28, 4);
		expect(wide.withinGap).toBe(false);
		expect(wide.isCompatible).toBe(false);
		expect(wide.failureReasons.some((r) => r.includes('gap'))).toBe(true);

		const overlap = makePair(0.25); // domDist = 0.50 < 0.75
		expect(overlap.withinGap).toBe(false);
		expect(overlap.isCompatible).toBe(false);
		expect(overlap.failureReasons.some((r) => r.includes('overlap'))).toBe(true);
	});

	it('enforces lateral offset tolerance and asymmetric skew in both local frames', () => {
		const withinLat = evaluatePairSeam(
			{
				id: 'irlo1',
				position: new THREE.Vector3(-0.54, -0.09, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo2',
				position: new THREE.Vector3(0.54, 0.09, -2),
				quaternion: cwRotQuat(270),
				scale: 1.0
			},
			TEST_MANIFEST
		)!;
		expect(withinLat.lateralOffsetRatio).toBeCloseTo(0.18, 4);
		expect(withinLat.withinLateral).toBe(true);
		expect(withinLat.isCompatible).toBe(true);

		const excessLat = evaluatePairSeam(
			{
				id: 'irlo1',
				position: new THREE.Vector3(-0.54, -0.21, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo2',
				position: new THREE.Vector3(0.54, 0.21, -2),
				quaternion: cwRotQuat(270),
				scale: 1.0
			},
			TEST_MANIFEST
		)!;
		expect(excessLat.lateralOffsetRatio).toBeCloseTo(0.42, 4);
		expect(excessLat.withinLateral).toBe(false);
		expect(excessLat.isCompatible).toBe(false);

		// Asymmetric skew: A is aligned (0°), B is rotated 210° (30° past 180° BB) -> latDistB = 0.55 > 0.35
		const skewed = evaluatePairSeam(
			{
				id: 'irlo1',
				position: new THREE.Vector3(0, 0, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo2',
				position: new THREE.Vector3(1.1, 0, -2),
				quaternion: cwRotQuat(210),
				scale: 1.0
			},
			TEST_MANIFEST
		)!;
		expect(skewed.lateralOffsetRatio).toBeCloseTo(0.55, 4);
		expect(skewed.withinLateral).toBe(false);
		expect(skewed.isCompatible).toBe(false);
	});

	it('rejects non-coplanar tilts (> 20°) and excessive out-of-plane Z depth steps', () => {
		const tilt14 = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0, (-14 * Math.PI) / 180, (-270 * Math.PI) / 180, 'YXZ')
		);
		const validTilt = evaluatePairSeam(
			{
				id: 'irlo1',
				position: new THREE.Vector3(-0.54, 0, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo2',
				position: new THREE.Vector3(0.54, 0, -2),
				quaternion: tilt14,
				scale: 1.0
			},
			TEST_MANIFEST
		)!;
		expect(validTilt.normalAngleDeg).toBeCloseTo(14, 1);
		expect(validTilt.isCoplanar).toBe(true);
		expect(validTilt.isCompatible).toBe(true);

		const tilt27 = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0, (-27 * Math.PI) / 180, (-270 * Math.PI) / 180, 'YXZ')
		);
		const badTilt = evaluatePairSeam(
			{
				id: 'irlo1',
				position: new THREE.Vector3(-0.54, 0, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo2',
				position: new THREE.Vector3(0.54, 0, -2),
				quaternion: tilt27,
				scale: 1.0
			},
			TEST_MANIFEST
		)!;
		expect(badTilt.normalAngleDeg).toBeCloseTo(27, 1);
		expect(badTilt.isCoplanar).toBe(false);
		expect(badTilt.isCompatible).toBe(false);

		const badStepZ = evaluatePairSeam(
			{
				id: 'irlo1',
				position: new THREE.Vector3(-0.54, 0, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo2',
				position: new THREE.Vector3(0.54, 0, -1.5),
				quaternion: cwRotQuat(270),
				scale: 1.0
			},
			TEST_MANIFEST
		)!;
		expect(badStepZ.outOfPlaneRatio).toBeCloseTo(0.5, 4);
		expect(badStepZ.isCoplanar).toBe(false);
		expect(badStepZ.isCompatible).toBe(false);
	});
});

describe('evaluateAllPairSeams', () => {
	it('evaluates multiple paintings pairwise and ranks compatible seams first', () => {
		const poses: PaintingPoseFrame[] = [
			{
				id: 'irlo3',
				position: new THREE.Vector3(-1.7, 0, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo1',
				position: new THREE.Vector3(-0.54, 0, -2),
				quaternion: cwRotQuat(0),
				scale: 1.0
			},
			{
				id: 'irlo2',
				position: new THREE.Vector3(0.54, 0, -2),
				quaternion: cwRotQuat(270),
				scale: 1.0
			}
		];

		const all = evaluateAllPairSeams(poses, TEST_MANIFEST);
		expect(all).toHaveLength(3);
		expect(all[0].isCompatible).toBe(true);
		expect(all[0].arrangementKey).toBe('seam-AA');
		expect(all[1].isCompatible).toBe(false);
		expect(all[2].isCompatible).toBe(false);
	});

	it('verifies all 4 composite paintings (AA, BB, CC, DD) in both normal and mirrored modes', async () => {
		const { computeCanvasPoseFromCorners } = await import('./poseProjection');

		interface CompositeDetectionCase {
			w: number;
			h: number;
			paintings: Array<{
				id: string;
				rot: number;
				corners: Array<[number, number]>;
				pose: {
					position: [number, number, number];
					quaternion: [number, number, number, number];
					normal: [number, number, number];
				};
			}>;
		}

const COMPOSITE_DETECTIONS: Record<string, CompositeDetectionCase> = {
			"irloAA.jpeg_normal": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 0,
						corners: [[0.0004, 0.0011], [0.5002, -0.0007], [0.5004, 1.0009], [0.0002, 0.9999]],
						pose: {"position": [-0.4997, -0.0001, -1.0716], "quaternion": [-0.00038, -0.00109, 0.00019, 1.0], "normal": [-0.0022, 0.0008, 1.0]}
					},
					{
						id: "irlo2",
						rot: 270,
						corners: [[0.5002, 0.9969], [0.4999, -0.0028], [1.0004, -0.003], [1.0002, 0.9969]],
						pose: {"position": [0.5002, 0.0028, -1.0723], "quaternion": [1e-05, -0.00048, 0.70719, 0.70702], "normal": [-0.0007, -0.0007, 1.0]}
					},
				]
			},
			"irloAA.jpeg_mirrored": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 0,
						corners: [[0.997, 0.0012], [0.4971, -0.0006], [0.497, 1.0009], [0.9973, 0.9998]],
						pose: {"position": [-0.4996, -0.0001, -1.0716], "quaternion": [-0.00044, -0.00105, 0.00014, 1.0], "normal": [-0.0021, 0.0009, 1.0]}
					},
					{
						id: "irlo2",
						rot: 270,
						corners: [[0.4971, 0.997], [0.4975, -0.0025], [-0.003, -0.0031], [-0.0028, 0.9968]],
						pose: {"position": [0.5002, 0.0027, -1.0724], "quaternion": [8e-05, -0.00069, 0.7073, 0.70691], "normal": [-0.0009, -0.0011, 1.0]}
					},
				]
			},
			"irloBB.jpeg_normal": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 270,
						corners: [[0.0007, 0.9963], [-0.0003, -0.0033], [0.5005, -0.0031], [0.4998, 0.9972]],
						pose: {"position": [-0.4998, 0.0025, -1.0723], "quaternion": [0.00082, -0.00128, 0.70682, 0.7074], "normal": [-0.0006, -0.003, 1.0]}
					},
					{
						id: "irlo2",
						rot: 90,
						corners: [[0.9986, 0.0004], [0.9985, 1.0005], [0.4985, 1.0002], [0.4988, 0.0004]],
						pose: {"position": [0.4972, -0.0004, -1.0724], "quaternion": [-0.0, -9e-05, -0.7072, 0.70701], "normal": [-0.0001, 0.0001, 1.0]}
					},
				]
			},
			"irloBB.jpeg_mirrored": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 270,
						corners: [[0.9967, 0.9963], [0.9977, -0.0033], [0.4969, -0.0029], [0.4976, 0.9971]],
						pose: {"position": [-0.4998, 0.0025, -1.0724], "quaternion": [0.001, -0.00116, 0.7068, 0.70741], "normal": [-0.0002, -0.0031, 1.0]}
					},
					{
						id: "irlo2",
						rot: 90,
						corners: [[-0.0011, 0.0007], [-0.0011, 1.0003], [0.4989, 1.0001], [0.4987, 0.0003]],
						pose: {"position": [0.4972, -0.0003, -1.0725], "quaternion": [-0.00012, -9e-05, -0.70722, 0.707], "normal": [0.0, 0.0003, 1.0]}
					},
				]
			},
			"irloCC.jpeg_normal": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 90,
						corners: [[0.4982, 0.0008], [0.4989, 0.9999], [-0.0018, 1.0007], [-0.0014, 0.0002]],
						pose: {"position": [-0.5029, -0.0001, -1.0726], "quaternion": [-0.00096, -0.0, -0.70693, 0.70729], "normal": [0.0014, 0.0014, 1.0]}
					},
					{
						id: "irlo2",
						rot: 180,
						corners: [[0.9986, 0.9974], [0.4985, 0.9968], [0.4986, -0.0032], [0.9986, -0.0025]],
						pose: {"position": [0.4971, 0.003, -1.0722], "quaternion": [-0.0, 0.00027, 1.0, 0.00025], "normal": [-0.0, 0.0005, 1.0]}
					},
				]
			},
			"irloCC.jpeg_mirrored": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 90,
						corners: [[0.4992, 0.0009], [0.4985, 0.9998], [0.9992, 1.0007], [0.9988, 0.0003]],
						pose: {"position": [-0.5029, -0.0, -1.0727], "quaternion": [-0.00113, 1e-05, -0.7069, 0.70731], "normal": [0.0016, 0.0016, 1.0]}
					},
					{
						id: "irlo2",
						rot: 180,
						corners: [[-0.0011, 0.9974], [0.4989, 0.9968], [0.4989, -0.0032], [-0.0012, -0.0026]],
						pose: {"position": [0.497, 0.003, -1.0722], "quaternion": [-6e-05, 0.00018, 1.0, 0.00023], "normal": [-0.0001, 0.0004, 1.0]}
					},
				]
			},
			"irloDD.jpeg_normal": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 180,
						corners: [[0.4982, 0.9964], [-0.0016, 0.9981], [-0.0015, -0.0032], [0.4984, -0.0025]],
						pose: {"position": [-0.5032, 0.0029, -1.0727], "quaternion": [0.0007, 0.00017, 1.0, -0.00012], "normal": [0.0014, 0.0003, 1.0]}
					},
					{
						id: "irlo2",
						rot: 0,
						corners: [[0.5003, 0.0009], [1.0002, 0.0002], [1.0003, 1.0004], [0.5001, 0.9998]],
						pose: {"position": [0.5003, -0.0003, -1.0727], "quaternion": [-0.00014, -0.00067, -4e-05, 1.0], "normal": [-0.0013, 0.0003, 1.0]}
					},
				]
			},
			"irloDD.jpeg_mirrored": {
				w: 3960,
				h: 1980,
				paintings: [
					{
						id: "irlo1",
						rot: 180,
						corners: [[0.4992, 0.9964], [0.9989, 0.9981], [0.999, -0.0033], [0.499, -0.0025]],
						pose: {"position": [-0.5032, 0.0028, -1.0728], "quaternion": [0.00071, 4e-05, 1.0, -0.0001], "normal": [0.0014, 0.0001, 1.0]}
					},
					{
						id: "irlo2",
						rot: 0,
						corners: [[0.4973, 0.0005], [-0.0028, 0.0], [-0.0028, 1.0004], [0.4972, 0.9999]],
						pose: {"position": [0.5003, -0.0002, -1.0725], "quaternion": [-0.0, -0.00044, 1e-05, 1.0], "normal": [-0.0009, 0.0, 1.0]}
					},
				]
			},
		};

		const expectedPairCodes: Record<string, string> = {
			irloAA: 'AA',
			irloBB: 'BB',
			irloCC: 'CC',
			irloDD: 'DD'
		};

		for (const [key, data] of Object.entries(COMPOSITE_DETECTIONS)) {
			const prefix = key.split('_')[0].replace('.jpeg', '');
			const expectedCode = expectedPairCodes[prefix];
			expect(data.paintings.length).toBe(2);

			const poses = data.paintings.map((p) => {
				const pts = p.corners.map(([x, y]) => ({ x, y }));
				const proj = computeCanvasPoseFromCorners(p.id, pts, data.w, data.h, data.w, data.h, p.pose, 50)!;
				return {
					id: p.id,
					position: proj.position,
					quaternion: proj.quaternion,
					scale: proj.scale,
					rot: p.rot
				};
			});

			const res = evaluatePairSeam(poses[0], poses[1], TEST_MANIFEST);
			expect(res).not.toBeNull();
			expect(res!.isCompatible).toBe(true);
			const normalizedCode = res!.pairCode === 'BA' ? 'AB' : res!.pairCode;
			expect(normalizedCode).toBe(expectedCode);
			expect(res!.rule?.id).toBe(`seam-${expectedCode}`);
		}
	});

	it('produces identical pairQuaternion regardless of input order and rotates 180 deg with upside-down paintings', () => {
		// Seam AA: canonical left = irlo1 (0 deg CW), canonical right = irlo2 (270 deg CW)
		const pose1: PaintingPoseFrame = {
			id: 'irlo1',
			position: new THREE.Vector3(-0.54, 0, -2),
			quaternion: cwRotQuat(0),
			scale: 1.0
		};
		const pose2: PaintingPoseFrame = {
			id: 'irlo2',
			position: new THREE.Vector3(0.54, 0, -2),
			quaternion: cwRotQuat(270),
			scale: 1.0
		};

		const ab = evaluatePairSeam(pose1, pose2, TEST_MANIFEST)!;
		const ba = evaluatePairSeam(pose2, pose1, TEST_MANIFEST)!;
		expect(ab.isCompatible).toBe(true);
		expect(ba.isCompatible).toBe(true);
		expect(ab.pairOrigin.distanceTo(ba.pairOrigin)).toBeLessThan(1e-5);
		expect(Math.abs(ab.pairQuaternion.dot(ba.pairQuaternion))).toBeCloseTo(1, 5);

		// Also verify swapped-seam order invariance (CC upright: canonical left = irlo2 @ 0 deg, right = irlo1 @ 270 deg)
		const cc2: PaintingPoseFrame = {
			id: 'irlo2',
			position: new THREE.Vector3(-0.54, 0, -2),
			quaternion: cwRotQuat(0),
			scale: 1.0
		};
		const cc1: PaintingPoseFrame = {
			id: 'irlo1',
			position: new THREE.Vector3(0.54, 0, -2),
			quaternion: cwRotQuat(270),
			scale: 1.0
		};
		const ccForward = evaluatePairSeam(cc1, cc2, TEST_MANIFEST)!;
		const ccReverse = evaluatePairSeam(cc2, cc1, TEST_MANIFEST)!;
		expect(ccForward.isCompatible).toBe(true);
		expect(Math.abs(ccForward.pairQuaternion.dot(ccReverse.pairQuaternion))).toBeCloseTo(1, 5);

		// Rotate the whole AA pair upside down (180 deg around Z camera view axis)
		const rot180 = cwRotQuat(180);
		const pose1UpsideDown: PaintingPoseFrame = {
			id: 'irlo1',
			position: pose1.position.clone().sub(new THREE.Vector3(0, 0, -2)).applyQuaternion(rot180).add(new THREE.Vector3(0, 0, -2)),
			quaternion: rot180.clone().multiply(pose1.quaternion),
			scale: 1.0
		};
		const pose2UpsideDown: PaintingPoseFrame = {
			id: 'irlo2',
			position: pose2.position.clone().sub(new THREE.Vector3(0, 0, -2)).applyQuaternion(rot180).add(new THREE.Vector3(0, 0, -2)),
			quaternion: rot180.clone().multiply(pose2.quaternion),
			scale: 1.0
		};
		const upsideDown = evaluatePairSeam(pose1UpsideDown, pose2UpsideDown, TEST_MANIFEST)!;
		expect(upsideDown.isCompatible).toBe(true);
		const expectedQuat180 = rot180.clone().multiply(ab.pairQuaternion);
		expect(Math.abs(upsideDown.pairQuaternion.dot(expectedQuat180))).toBeCloseTo(1, 5);
		// Ensure it actually rotated 180 deg relative to upright (dot ~ 0), not flipped back to 0 deg
		expect(Math.abs(upsideDown.pairQuaternion.dot(ab.pairQuaternion))).toBeCloseTo(0, 4);
	});

	it('correctly evaluates all 4 real composite test images (AA, BB, CC, DD)', async () => {
		const cases = [
			{
				name: 'seam-AA',
				p1: { id: 'irlo1', position: new THREE.Vector3(-0.4997, -0.0001, -1.0716), quaternion: new THREE.Quaternion(-0.00038, -0.00109, 0.00019, 1.0), scale: 1.0 },
				p2: { id: 'irlo2', position: new THREE.Vector3(0.5002, 0.0028, -1.0723), quaternion: new THREE.Quaternion(1e-05, -0.00048, 0.70719, 0.70702), scale: 1.0 },
			},
			{
				name: 'seam-BB',
				p1: { id: 'irlo1', position: new THREE.Vector3(-0.4998, 0.0025, -1.0723), quaternion: new THREE.Quaternion(0.00082, -0.00128, 0.70682, 0.7074), scale: 1.0 },
				p2: { id: 'irlo2', position: new THREE.Vector3(0.4972, -0.0004, -1.0724), quaternion: new THREE.Quaternion(-0.0, -9e-05, -0.7072, 0.70701), scale: 1.0 },
			},
			{
				name: 'seam-CC',
				p1: { id: 'irlo1', position: new THREE.Vector3(-0.5029, -0.0001, -1.0726), quaternion: new THREE.Quaternion(-0.00096, -0.0, -0.70693, 0.70729), scale: 1.0 },
				p2: { id: 'irlo2', position: new THREE.Vector3(0.4971, 0.003, -1.0722), quaternion: new THREE.Quaternion(-0.0, 0.00027, 1.0, 0.00025), scale: 1.0 },
			},
			{
				name: 'seam-DD',
				p1: { id: 'irlo1', position: new THREE.Vector3(-0.5032, 0.0029, -1.0727), quaternion: new THREE.Quaternion(0.0007, 0.00017, 1.0, -0.00012), scale: 1.0 },
				p2: { id: 'irlo2', position: new THREE.Vector3(0.5003, -0.0003, -1.0727), quaternion: new THREE.Quaternion(-0.00014, -0.00067, -4e-05, 1.0), scale: 1.0 },
			}
		];

		for (const tc of cases) {
			const res = evaluatePairSeam(tc.p1, tc.p2, TEST_MANIFEST);
			expect(res, `Result for ${tc.name} should not be null`).not.toBeNull();
			expect(res!.isCompatible, `Seam ${tc.name} failure: ${res!.failureReasons.join(', ')}`).toBe(true);
			expect(res!.arrangementKey).toBe(tc.name);
		}

		// Test with computeCanvasPoseFromCorners directly
		const { computeCanvasPoseFromCorners } = await import('./poseProjection');
		const p1Corners = [{ x: 0.0004, y: 0.0011 }, { x: 0.5002, y: -0.0007 }, { x: 0.5004, y: 1.0009 }, { x: 0.0002, y: 0.9999 }];
		const p2Corners = [{ x: 0.5002, y: 0.9969 }, { x: 0.4999, y: -0.0028 }, { x: 1.0004, y: -0.003 }, { x: 1.0002, y: 0.9969 }];
		const p1Pose: import('../types').Pose6DoF = {
			position: [-0.4997, -0.0001, -1.0716],
			quaternion: [-0.00038, -0.00109, 0.00019, 1.0],
			normal: [-0.0022, 0.0008, 1.0]
		};
		const p2Pose: import('../types').Pose6DoF = {
			position: [0.5002, 0.0028, -1.0723],
			quaternion: [1e-05, -0.00048, 0.70719, 0.70702],
			normal: [-0.0014, 0.0, 1.0]
		};

		const proj1 = computeCanvasPoseFromCorners('irlo1', p1Corners, 640, 360, 640, 360, p1Pose)!;
		const proj2 = computeCanvasPoseFromCorners('irlo2', p2Corners, 640, 360, 640, 360, p2Pose)!;
		expect(proj1).not.toBeNull();
		expect(proj2).not.toBeNull();

		console.log('proj1 screenPosition:', proj1.screenPosition, 'position:', proj1.position);
		console.log('proj2 screenPosition:', proj2.screenPosition, 'position:', proj2.position);

		// With proj1.position / proj2.position (backend solvePnP pose)
		const resPos = evaluatePairSeam({ id: 'irlo1', position: proj1.position, quaternion: proj1.quaternion, scale: proj1.scale }, { id: 'irlo2', position: proj2.position, quaternion: proj2.quaternion, scale: proj2.scale }, TEST_MANIFEST);
		expect(resPos?.isCompatible).toBe(true);

		// With proj1.screenPosition / proj2.screenPosition
		const resScreen = evaluatePairSeam({ id: 'irlo1', position: proj1.screenPosition, quaternion: proj1.quaternion, scale: proj1.scale }, { id: 'irlo2', position: proj2.screenPosition, quaternion: proj2.quaternion, scale: proj2.scale }, TEST_MANIFEST);
		console.log('resScreen compatible:', resScreen?.isCompatible, 'reasons:', resScreen?.failureReasons);
		expect(resScreen?.isCompatible).toBe(true);
	});

	it('determines facing edges directly from 2D corners for all 4 seam combinations', () => {
		// Canonical unrotated unit quad centered at (0, 0): [TL(-0.5, -0.5), TR(0.5, -0.5), BR(0.5, 0.5), BL(-0.5, 0.5)]
		const makeQuad = (cx: number, cy: number, rotDegCw: number) => {
			const rad = (rotDegCw * Math.PI) / 180;
			const cos = Math.cos(rad);
			const sin = Math.sin(rad);
			const base = [
				{ x: -0.5, y: -0.5 },
				{ x: 0.5, y: -0.5 },
				{ x: 0.5, y: 0.5 },
				{ x: -0.5, y: 0.5 }
			];
			return base.map((p) => ({
				x: cx + p.x * cos - p.y * sin,
				y: cy + p.x * sin + p.y * cos
			}));
		};

		// 1. Seam AA: A at 90° CW on left, B at 270° CW on right
		const quadA_AA = makeQuad(100, 200, 90);
		const quadB_AA = makeQuad(210, 200, 270);
		const facingAA = determineFacingSidesFromCorners(quadA_AA, quadB_AA);
		expect(facingAA).toEqual({ sideA: 'top', sideB: 'top' });

		// 2. Seam BB: A at 0° CW on left, B at 90° CW on right
		const quadA_BB = makeQuad(100, 200, 0);
		const quadB_BB = makeQuad(210, 200, 90);
		const facingBB = determineFacingSidesFromCorners(quadA_BB, quadB_BB);
		expect(facingBB).toEqual({ sideA: 'right', sideB: 'bottom' });

		// 3. Seam CC: A at 180° CW on left, B at 180° CW on right
		const quadA_CC = makeQuad(100, 200, 180);
		const quadB_CC = makeQuad(210, 200, 180);
		const facingCC = determineFacingSidesFromCorners(quadA_CC, quadB_CC);
		expect(facingCC).toEqual({ sideA: 'left', sideB: 'right' });

		// 4. Seam DD: A at 90° CW on right, B at 180° CW on left
		const quadA_DD = makeQuad(210, 200, 90);
		const quadB_DD = makeQuad(100, 200, 180);
		const facingDD = determineFacingSidesFromCorners(quadA_DD, quadB_DD);
		expect(facingDD).toEqual({ sideA: 'bottom', sideB: 'left' });
	});
});
