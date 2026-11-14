import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ArtManifest } from '../manifest/types';
import {
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
			edges: { top: 'A', right: 'B', bottom: 'D', left: 'C' },
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
			edges: { top: 'A', right: 'B', bottom: 'D', left: 'C' },
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
			['90,270', { edge: 'A', key: 'seam-AA' }],
			['0,90', { edge: 'B', key: 'seam-BB' }],
			['180,180', { edge: 'C', key: 'seam-CC' }],
			['270,0', { edge: 'D', key: 'seam-DD' }]
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
		// Base AA pair: irlo1 (-0.55, 0) at 90° CW, irlo2 (+0.55, 0) at 270° CW
		const basePosA = new THREE.Vector3(-0.55, 0, 0);
		const basePosB = new THREE.Vector3(0.55, 0, 0);
		const baseQuatA = cwRotQuat(90);
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
					quaternion: cwRotQuat(90),
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
				quaternion: cwRotQuat(90),
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
				quaternion: cwRotQuat(90),
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
				quaternion: cwRotQuat(90),
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
				quaternion: cwRotQuat(90),
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
				quaternion: cwRotQuat(90),
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
				quaternion: cwRotQuat(90),
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
			'irloAA.jpeg_normal': {
				w: 3990,
				h: 1969,
				paintings: [
					{
						id: 'irlo2',
						rot: 270,
						corners: [
							[0.4997, 1.0069],
							[0.4998, -0.0091],
							[1.0012, -0.0094],
							[1.0011, 1.0066]
						],
						pose: {
							position: [0.4999, 0.0011, -1.0544],
							quaternion: [-0.00049, -0.0008, 0.70715, 0.70706],
							normal: [-0.0018, -0.0004, 1.0]
						}
					},
					{
						id: 'irlo1',
						rot: 90,
						corners: [
							[0.4976, -0.0039],
							[0.4984, 1.011],
							[-0.0035, 1.0109],
							[-0.0032, -0.0045]
						],
						pose: {
							position: [-0.5046, -0.0031, -1.0551],
							quaternion: [-0.00133, 0.00059, -0.707, 0.70721],
							normal: [0.0027, 0.0011, 1.0]
						}
					}
				]
			},
			'irloAA.jpeg_mirrored': {
				w: 3990,
				h: 1969,
				paintings: [
					{
						id: 'irlo2',
						rot: 270,
						corners: [
							[0.4977, 1.0069],
							[0.4976, -0.0092],
							[-0.0039, -0.0096],
							[-0.0037, 1.0066]
						],
						pose: {
							position: [0.4999, 0.0012, -1.0543],
							quaternion: [-0.0005, -0.0008, 0.70714, 0.70707],
							normal: [-0.0018, -0.0004, 1.0]
						}
					},
					{
						id: 'irlo1',
						rot: 90,
						corners: [
							[0.4999, -0.0039],
							[0.499, 1.0111],
							[1.0009, 1.011],
							[1.0006, -0.0045]
						],
						pose: {
							position: [-0.5046, -0.0031, -1.0551],
							quaternion: [-0.00135, 0.00053, -0.70699, 0.70722],
							normal: [0.0027, 0.0012, 1.0]
						}
					}
				]
			},
			'irloBB.jpeg_normal': {
				w: 4000,
				h: 1989,
				paintings: [
					{
						id: 'irlo2',
						rot: 90,
						corners: [
							[0.9992, -0.0009],
							[0.9988, 1.0049],
							[0.499, 1.005],
							[0.4992, -0.0009]
						],
						pose: {
							position: [0.498, -0.0022, -1.0663],
							quaternion: [2e-5, 0.00045, -0.70712, 0.70709],
							normal: [0.0006, -0.0007, 1.0]
						}
					},
					{
						id: 'irlo1',
						rot: 0,
						corners: [
							[0.0005, -0.0006],
							[0.5004, -0.0012],
							[0.5003, 1.0047],
							[0.0004, 1.005]
						],
						pose: {
							position: [-0.4992, -0.0018, -1.0663],
							quaternion: [-0.00027, -0.00032, 0.00012, 1.0],
							normal: [-0.0006, 0.0005, 1.0]
						}
					}
				]
			},
			'irloBB.jpeg_mirrored': {
				w: 4000,
				h: 1989,
				paintings: [
					{
						id: 'irlo2',
						rot: 90,
						corners: [
							[-0.0018, -0.0009],
							[-0.0015, 1.005],
							[0.4984, 1.0049],
							[0.4981, -0.0007]
						],
						pose: {
							position: [0.4981, -0.0022, -1.0664],
							quaternion: [7e-5, 0.00026, -0.70716, 0.70706],
							normal: [0.0003, -0.0005, 1.0]
						}
					},
					{
						id: 'irlo1',
						rot: 0,
						corners: [
							[0.9969, -0.0005],
							[0.4969, -0.0013],
							[0.4971, 1.0047],
							[0.997, 1.0049]
						],
						pose: {
							position: [-0.4992, -0.0019, -1.0663],
							quaternion: [-0.00016, -0.0004, 0.00012, 1.0],
							normal: [-0.0008, 0.0003, 1.0]
						}
					}
				]
			},
			'irloCC.jpeg_normal': {
				w: 3989,
				h: 1996,
				paintings: [
					{
						id: 'irlo1',
						rot: 0,
						corners: [
							[0.4992, -0.0013],
							[1.0006, -0.0025],
							[1.0004, 1.0003],
							[0.4993, 0.9999]
						],
						pose: {
							position: [0.4984, 0.0007, -1.0702],
							quaternion: [0.00036, -0.00071, 0.00016, 1.0],
							normal: [-0.0014, -0.0007, 1.0]
						}
					},
					{
						id: 'irlo2',
						rot: 0,
						corners: [
							[-0.0012, -0.0006],
							[0.4998, -0.0004],
							[0.5, 1.0017],
							[-0.0012, 1.0013]
						],
						pose: {
							position: [-0.5002, -0.0005, -1.07],
							quaternion: [2e-5, 3e-5, -4e-5, 1.0],
							normal: [0.0001, -0.0, 1.0]
						}
					}
				]
			},
			'irloCC.jpeg_mirrored': {
				w: 3989,
				h: 1996,
				paintings: [
					{
						id: 'irlo2',
						rot: 0,
						corners: [
							[0.9986, -0.0006],
							[0.4976, -0.0004],
							[0.4973, 1.0018],
							[0.9987, 1.0014]
						],
						pose: {
							position: [-0.5002, -0.0005, -1.0699],
							quaternion: [-9e-5, 1e-5, 1e-5, 1.0],
							normal: [0.0, 0.0002, 1.0]
						}
					},
					{
						id: 'irlo1',
						rot: 0,
						corners: [
							[0.4984, -0.0012],
							[-0.0032, -0.0025],
							[-0.0032, 0.9999],
							[0.4982, 1.0002]
						],
						pose: {
							position: [0.4983, 0.0007, -1.07],
							quaternion: [0.00038, -0.00072, 0.00034, 1.0],
							normal: [-0.0014, -0.0008, 1.0]
						}
					}
				]
			},
			'irloDD.jpeg_normal': {
				w: 3992,
				h: 1978,
				paintings: [
					{
						id: 'irlo2',
						rot: 180,
						corners: [
							[0.4988, 1.0072],
							[-0.002, 1.0068],
							[-0.0021, -0.0035],
							[0.4995, -0.0032]
						],
						pose: {
							position: [-0.5021, -0.002, -1.0603],
							quaternion: [0.00083, -0.00047, 1.0, 0.00033],
							normal: [0.0017, -0.0009, 1.0]
						}
					},
					{
						id: 'irlo1',
						rot: 90,
						corners: [
							[0.9997, -0.0004],
							[1.001, 1.0105],
							[0.4991, 1.01],
							[0.4996, -0.0011]
						],
						pose: {
							position: [0.4989, -0.0039, -1.06],
							quaternion: [-0.00086, -0.00166, -0.70736, 0.70685],
							normal: [-0.0011, 0.0036, 1.0]
						}
					}
				]
			},
			'irloDD.jpeg_mirrored': {
				w: 3992,
				h: 1978,
				paintings: [
					{
						id: 'irlo2',
						rot: 180,
						corners: [
							[0.4985, 1.0073],
							[0.9994, 1.0068],
							[0.9995, -0.0035],
							[0.4979, -0.0032]
						],
						pose: {
							position: [-0.5021, -0.002, -1.0603],
							quaternion: [0.00081, -0.00041, 1.0, 0.00032],
							normal: [0.0016, -0.0008, 1.0]
						}
					},
					{
						id: 'irlo1',
						rot: 90,
						corners: [
							[-0.0024, -0.0005],
							[-0.0037, 1.0107],
							[0.4983, 1.01],
							[0.4979, -0.0011]
						],
						pose: {
							position: [0.4989, -0.0039, -1.0599],
							quaternion: [-0.00082, -0.00169, -0.70736, 0.70685],
							normal: [-0.0012, 0.0036, 1.0]
						}
					}
				]
			}
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
});
