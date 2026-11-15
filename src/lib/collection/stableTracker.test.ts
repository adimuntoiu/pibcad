import { describe, it, expect, vi } from 'vitest';
import { StableTracker } from './stableTracker';

describe('StableTracker', () => {
	it('triggers save only when artwork is continuously tracked for stableDurationMs', () => {
		const onSave = vi.fn();
		const tracker = new StableTracker({ stableDurationMs: 1500, onSave });

		// Frame 1 at t=0
		let res = tracker.update('irlo1', 0);
		expect(res.saved).toBe(false);
		expect(res.progress).toBe(0);
		expect(onSave).not.toHaveBeenCalled();

		// Frame 2 at t=800ms
		res = tracker.update('irlo1', 800);
		expect(res.saved).toBe(false);
		expect(res.progress).toBeCloseTo(800 / 1500);
		expect(onSave).not.toHaveBeenCalled();

		// Frame 3 at t=1500ms -> qualifies for save!
		res = tracker.update('irlo1', 1500);
		expect(res.saved).toBe(true);
		expect(res.artworkId).toBe('irlo1');
		expect(res.progress).toBe(1);
		expect(onSave).toHaveBeenCalledWith('irlo1');

		// Subsequent frames in the same session do not save again
		res = tracker.update('irlo1', 2000);
		expect(res.saved).toBe(false);
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('resets progress if tracking is lost or target changes', () => {
		const tracker = new StableTracker({ stableDurationMs: 1500 });

		tracker.update('irlo1', 0);
		tracker.update('irlo1', 1000);

		// Frame dropped (null tracking)
		let res = tracker.update(null, 1100);
		expect(res.saved).toBe(false);
		expect(res.progress).toBe(0);

		// Tracking re-acquired at t=1200ms -> timer must restart from 0
		res = tracker.update('irlo1', 1200);
		expect(res.progress).toBe(0);

		res = tracker.update('irlo1', 2000); // only 800ms elapsed since restart
		expect(res.saved).toBe(false);

		res = tracker.update('irlo1', 2700); // 1500ms elapsed!
		expect(res.saved).toBe(true);
	});

	it('resets session tracking when resetSession is called', () => {
		const tracker = new StableTracker({ stableDurationMs: 1000 });
		tracker.update('irlo1', 0);
		tracker.update('irlo1', 1000);
		expect(tracker.savedInSession.has('irlo1')).toBe(true);

		tracker.resetSession();
		expect(tracker.savedInSession.has('irlo1')).toBe(false);
	});
});
