import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	buildNormalizedModelHierarchy,
	computeNormalizationParams,
	updatePlacementOnRoot
} from './modelNormalization';

describe('computeNormalizationParams', () => {
	it('computes raw bounds metrics and normalizes default overlay mode onto Z=0 extending toward +Z', () => {
		const res = computeNormalizationParams([-1, -2, 1], [3, 2, 3], {
			url: '/demo/models/test.glb'
		});

		expect(res.report.rawSize).toEqual([4, 4, 2]);
		expect(res.report.rawCenter).toEqual([1, 0, 2]);
		expect(res.report.originRelativeToBox).toEqual([0.25, 0.5, -0.5]);
		expect(res.report.units).toBe('canvas-widths');

		// Default overlay: fitDimension='width', fitFraction=1.0, pivot='front'
		expect(res.baseScale).toBeCloseTo(0.25, 4);
		expect(res.report.normalizedSize[0]).toBeCloseTo(1.0, 4);
		expect(res.report.normalizedSize[1]).toBeCloseTo(1.0, 4);
		expect(res.report.normalizedSize[2]).toBeCloseTo(0.5, 4);
		expect(res.report.normalizedMin).toEqual([-0.5, -0.5, 0]);
		expect(res.report.normalizedMax).toEqual([0.5, 0.5, 0.5]);
	});

	it('places standout pivot at bottom center (minY=0, minZ=0) and inside pivot at center', () => {
		const standout = computeNormalizationParams([-1, 2, 0], [1, 6, 2], {
			url: '/demo/models/stand.glb',
			mode: 'standout'
		});
		expect(standout.report.pivot).toBe('base');
		expect(standout.report.normalizedMin[0]).toBeCloseTo(-0.5, 4);
		expect(standout.report.normalizedMin[1]).toBeCloseTo(0, 4);
		expect(standout.report.normalizedMin[2]).toBeCloseTo(0, 4);

		const inside = computeNormalizationParams([-1, 0, 2], [1, 2, 6], {
			url: '/demo/models/inside.glb',
			mode: 'inside'
		});
		expect(inside.report.pivot).toBe('center');
		expect(inside.report.normalizedMin).toEqual([-0.5, -0.5, -1]);
		expect(inside.report.normalizedMax).toEqual([0.5, 0.5, 1]);
	});

	it('handles zUp rotation, axis flip flags, and depthScale without changing XY fit', () => {
		// zUp box: X=[0..2], Y(depth)=[-1..3], Z(height)=[0..4]
		const params = computeNormalizationParams([0, -1, 0], [2, 3, 4], {
			url: '/demo/models/zup.glb',
			axisConvention: 'zUp',
			flip: [true, false, true],
			depthScale: 0.5
		});

		expect(params.orientedSize).toEqual([2, 4, 4]);
		expect(params.fitScaleVec[0]).toBeCloseTo(-0.5, 4);
		expect(params.fitScaleVec[1]).toBeCloseTo(0.5, 4);
		expect(params.fitScaleVec[2]).toBeCloseTo(-0.25, 4);

		expect(params.report.normalizedSize[0]).toBeCloseTo(1.0, 4);
		expect(params.report.normalizedSize[1]).toBeCloseTo(2.0, 4);
		expect(params.report.normalizedSize[2]).toBeCloseTo(1.0, 4);
		expect(params.report.normalizedMin[2]).toBeCloseTo(0, 4);
	});
});

describe('buildNormalizedModelHierarchy & updatePlacementOnRoot', () => {
	it('applies finalTransform = placement * normalization cleanly on a Three.js mesh', () => {
		const source = new THREE.Group();
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(2, 4, 1),
			new THREE.MeshBasicMaterial({ color: 0xffffff })
		);
		mesh.position.set(1, -2, -3);
		source.add(mesh);

		const root = buildNormalizedModelHierarchy(source, {
			url: '/demo/models/synthetic.glb',
			mode: 'overlay'
		});

		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3());

		expect(size.x).toBeCloseTo(1.0, 3);
		expect(size.y).toBeCloseTo(2.0, 3);
		expect(size.z).toBeCloseTo(0.5, 3);
		expect(box.min.z).toBeCloseTo(0, 3);
		expect(box.max.z).toBeCloseTo(0.5, 3);

		// Live placement override without reloading geometry
		const updatedReport = updatePlacementOnRoot(root, {
			url: '/demo/models/synthetic.glb',
			mode: 'overlay',
			scale: 2,
			offset: [0.25, -0.5, 0.1],
			rotation: [0, 0, 90],
			depthScale: 0.5
		});

		expect(updatedReport).not.toBeNull();
		root.updateMatrixWorld(true);
		const box2 = new THREE.Box3().setFromObject(root);
		const size2 = box2.getSize(new THREE.Vector3());

		// Rotated 90 deg around Z swaps X and Y sizes, uniform scale=2 doubles normalized extents
		expect(size2.x).toBeCloseTo(4.0, 3);
		expect(size2.y).toBeCloseTo(2.0, 3);
		expect(size2.z).toBeCloseTo(0.5, 3);
		expect(box2.min.z).toBeCloseTo(0.1, 3);
	});
});
