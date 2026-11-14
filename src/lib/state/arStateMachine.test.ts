import { describe, expect, it } from 'vitest';
import { ARStateMachine } from './arStateMachine';
import {
	getRotatedEdgeLabels,
	normalizeManifest,
	resolveCanvasConfig
} from '../manifest/repository';

describe('ARStateMachine', () => {
	it('enforces N-frame debounce before entering generating state', () => {
		const machine = new ARStateMachine({
			stateDebounceFrames: 5,
			loadingDurationMs: 1200,
			dropHoldMs: 500,
			crossFadeDurationMs: 400
		});

		for (let i = 1; i <= 4; i++) {
			const snap = machine.observe({ targets: [{ id: 'irlo1', snappedRotationDeg: 0 }] }, i * 50);
			expect(snap.state).toBe('scanning');
			expect(snap.pendingFrames).toBe(i);
			expect(snap.pendingKey).toBe('single:irlo1');
		}

		// Interruption clears pending debounce
		const interrupted = machine.observe({ targets: [] }, 250);
		expect(interrupted.state).toBe('scanning');
		expect(interrupted.pendingFrames).toBe(0);

		// 5 consecutive frames commit -> generating
		for (let i = 1; i <= 4; i++) {
			const snap = machine.observe({ targets: [{ id: 'irlo1' }] }, 300 + i * 50);
			expect(snap.state).toBe('scanning');
		}
		const committed = machine.observe({ targets: [{ id: 'irlo1' }] }, 550);
		expect(committed.state).toBe('generating');
		expect(committed.activeKey).toBe('single:irlo1');
		expect(committed.generatingProgress).toBe(0);
	});

	it('transitions generating -> tracking_single and ramps crossFadeAlpha', () => {
		const machine = new ARStateMachine({
			stateDebounceFrames: 2,
			loadingDurationMs: 1000,
			dropHoldMs: 500,
			crossFadeDurationMs: 400
		});

		machine.observe({ targets: [{ id: 'irlo1' }] }, 0);
		const genStart = machine.observe({ targets: [{ id: 'irlo1' }] }, 100);
		expect(genStart.state).toBe('generating');

		// Painting stays visible at 400ms and 800ms while rAF checks mid-progress at 600ms
		machine.observe({ targets: [{ id: 'irlo1' }] }, 400);
		const midGen = machine.advanceTime(600);
		expect(midGen.state).toBe('generating');
		expect(midGen.generatingProgress).toBeCloseTo(0.5, 4);
		expect(midGen.crossFadeAlpha).toBe(0);

		machine.observe({ targets: [{ id: 'irlo1' }] }, 800);
		const revealed = machine.observe({ targets: [{ id: 'irlo1' }] }, 1100);
		expect(revealed.state).toBe('tracking_single');
		expect(revealed.generatingProgress).toBe(1);
		expect(revealed.crossFadeAlpha).toBe(0);

		const midFade = machine.advanceTime(1300);
		expect(midFade.crossFadeAlpha).toBeCloseTo(0.5, 4);

		const fullFade = machine.advanceTime(1500);
		expect(fullFade.crossFadeAlpha).toBe(1);
	});

	it('retains state during 500ms drop-hold and resets after hold expires', () => {
		const machine = new ARStateMachine({
			stateDebounceFrames: 1,
			loadingDurationMs: 0,
			dropHoldMs: 500,
			crossFadeDurationMs: 200
		});

		const tracked = machine.observe({ targets: [{ id: 'irlo1', snappedRotationDeg: 90 }] }, 1000);
		expect(tracked.state).toBe('tracking_single');
		expect(tracked.targets[0].snappedRotationDeg).toBe(90);

		// Drop at 1100 (100ms elapsed): still holding!
		const holding = machine.observe({ targets: [] }, 1100);
		expect(holding.state).toBe('tracking_single');
		expect(holding.isHolding).toBe(true);
		expect(holding.holdElapsedMs).toBe(100);
		expect(holding.targets[0].id).toBe('irlo1');

		// Exactly 500ms boundary: still holding
		const boundary = machine.observe({ targets: [] }, 1500);
		expect(boundary.state).toBe('tracking_single');
		expect(boundary.isHolding).toBe(true);

		// 501ms: expired back to scanning
		const expired = machine.advanceTime(1501);
		expect(expired.state).toBe('scanning');
		expect(expired.isHolding).toBe(false);
		expect(expired.activeKey).toBeNull();
		expect(expired.targets).toHaveLength(0);
	});

	it('keeps active state across 0/90/180/270 rotations without re-triggering generating', () => {
		const machine = new ARStateMachine({
			stateDebounceFrames: 2,
			loadingDurationMs: 500,
			dropHoldMs: 500,
			crossFadeDurationMs: 200
		});

		machine.observe({ targets: [{ id: 'irlo1', snappedRotationDeg: 0 }] }, 0);
		machine.observe({ targets: [{ id: 'irlo1', snappedRotationDeg: 0 }] }, 50);
		machine.observe({ targets: [{ id: 'irlo1', snappedRotationDeg: 0 }] }, 350);
		const ready = machine.observe({ targets: [{ id: 'irlo1', snappedRotationDeg: 0 }] }, 600);
		expect(ready.state).toBe('tracking_single');

		let t = 700;
		for (const deg of [90, 180, 270, 0]) {
			const snap = machine.observe({ targets: [{ id: 'irlo1', snappedRotationDeg: deg }] }, t);
			expect(snap.state).toBe('tracking_single');
			expect(snap.targets[0].snappedRotationDeg).toBe(deg);
			t += 100;
		}
	});

	it('supports switching paintings and combined state keys after debounce', () => {
		const machine = new ARStateMachine({
			stateDebounceFrames: 3,
			loadingDurationMs: 0,
			dropHoldMs: 500,
			crossFadeDurationMs: 0
		});

		for (let i = 0; i < 3; i++) {
			machine.observe({ targets: [{ id: 'irlo1' }] }, i * 20);
		}
		expect(machine.getSnapshot().activeKey).toBe('single:irlo1');

		// 2 frames of irlo2 shouldn't switch yet
		machine.observe({ targets: [{ id: 'irlo2' }] }, 100);
		const preSwitch = machine.observe({ targets: [{ id: 'irlo2' }] }, 120);
		expect(preSwitch.state).toBe('tracking_single');
		expect(preSwitch.activeKey).toBe('single:irlo1');

		// 3rd frame switches cleanly
		const switched = machine.observe({ targets: [{ id: 'irlo2' }] }, 140);
		expect(switched.activeKey).toBe('single:irlo2');

		// Combined state key (ready for Phase 2)
		for (let i = 0; i < 3; i++) {
			machine.observe(
				{
					targets: [{ id: 'irlo1' }, { id: 'irlo2' }],
					stateKey: 'combined:arlo-AA',
					isCombined: true
				},
				200 + i * 20
			);
		}
		expect(machine.getSnapshot().state).toBe('tracking_combined');
		expect(machine.getSnapshot().activeKey).toBe('combined:arlo-AA');
	});

	it('cross-fades directly between single, seam-AA, seam-BB, and multi without re-triggering generating', () => {
		const machine = new ARStateMachine({
			stateDebounceFrames: 2,
			loadingDurationMs: 500,
			dropHoldMs: 500,
			crossFadeDurationMs: 400
		});

		// Initial lock triggers generating
		machine.observe({ targets: [{ id: 'irlo1' }] }, 0);
		expect(machine.observe({ targets: [{ id: 'irlo1' }] }, 50).state).toBe('generating');

		// Complete generating -> tracking_single
		machine.observe({ targets: [{ id: 'irlo1' }] }, 550);
		expect(machine.advanceTime(950).crossFadeAlpha).toBe(1);

		// Transition single:irlo1 -> seam:seam-AA after N=2 frames (no generating!)
		machine.observe(
			{ targets: [{ id: 'irlo1' }, { id: 'irlo2' }], stateKey: 'seam:seam-AA', isCombined: true },
			1000
		);
		const snapAA = machine.observe(
			{ targets: [{ id: 'irlo1' }, { id: 'irlo2' }], stateKey: 'seam:seam-AA', isCombined: true },
			1050
		);
		expect(snapAA.state).toBe('tracking_combined');
		expect(snapAA.activeKey).toBe('seam:seam-AA');
		expect(snapAA.crossFadeAlpha).toBe(0);
		expect(machine.advanceTime(1250).crossFadeAlpha).toBeCloseTo(0.5, 4);
		expect(machine.advanceTime(1450).crossFadeAlpha).toBe(1);

		// Rotate canvases: seam:seam-AA -> seam:seam-BB smoothly
		machine.observe(
			{ targets: [{ id: 'irlo1' }, { id: 'irlo2' }], stateKey: 'seam:seam-BB', isCombined: true },
			1500
		);
		const snapBB = machine.observe(
			{ targets: [{ id: 'irlo1' }, { id: 'irlo2' }], stateKey: 'seam:seam-BB', isCombined: true },
			1550
		);
		expect(snapBB.state).toBe('tracking_combined');
		expect(snapBB.activeKey).toBe('seam:seam-BB');
		expect(snapBB.crossFadeAlpha).toBe(0);
		expect(machine.advanceTime(1750).crossFadeAlpha).toBeCloseTo(0.5, 4);

		// Incompatible twist -> back to multi individual models
		machine.observe(
			{ targets: [{ id: 'irlo1' }, { id: 'irlo2' }], stateKey: 'multi:irlo1+irlo2', isCombined: false },
			1800
		);
		const snapMulti = machine.observe(
			{ targets: [{ id: 'irlo1' }, { id: 'irlo2' }], stateKey: 'multi:irlo1+irlo2', isCombined: false },
			1850
		);
		expect(snapMulti.state).toBe('tracking_single');
		expect(snapMulti.activeKey).toBe('multi:irlo1+irlo2');
		expect(snapMulti.crossFadeAlpha).toBe(0);
		expect(machine.advanceTime(2250).crossFadeAlpha).toBe(1);
	});
});

describe('Manifest repository helpers', () => {
	it('normalizes defaults and resolves aliases', () => {
		const manifest = normalizeManifest({
			canvases: [
				{
					id: 'irlo1',
					name: 'Irlo I',
					aliases: ['painting-c-monolith-i'],
					imageTargetUrl: '/demo/irlo1.jpg',
					edges: { top: 'A', right: 'B', bottom: 'D', left: 'C' },
					singleModel: { url: '/demo/models/irlo1_single.glb' }
				}
			]
		});

		expect(manifest.tolerances.maxGapRatio).toBe(0.2);
		expect(manifest.animation.dropHoldMs).toBe(500);
		expect(resolveCanvasConfig(manifest, 'painting-c-monolith-i')?.id).toBe('irlo1');
		expect(resolveCanvasConfig(manifest, 'unknown')).toBeNull();
	});

	it('rotates edge labels accurately in clockwise 90 deg steps', () => {
		const edges = { top: 'A', right: 'B', bottom: 'D', left: 'C' } as const;
		expect(getRotatedEdgeLabels(edges, 0)).toEqual({
			top: 'A',
			right: 'B',
			bottom: 'D',
			left: 'C'
		});
		expect(getRotatedEdgeLabels(edges, 90)).toEqual({
			top: 'C',
			right: 'A',
			bottom: 'B',
			left: 'D'
		});
		expect(getRotatedEdgeLabels(edges, 180)).toEqual({
			top: 'D',
			right: 'C',
			bottom: 'A',
			left: 'B'
		});
		expect(getRotatedEdgeLabels(edges, 270)).toEqual({
			top: 'B',
			right: 'D',
			bottom: 'C',
			left: 'A'
		});
	});
});
