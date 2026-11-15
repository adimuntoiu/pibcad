import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InactivityFadeTimer } from './fadeTimer';

describe('InactivityFadeTimer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('fades out after timeoutMs of inactivity', () => {
		const onFadeChange = vi.fn();
		const timer = new InactivityFadeTimer({ timeoutMs: 2500, onFadeChange });

		expect(timer.visible).toBe(true);

		// Fast-forward 2400ms
		vi.advanceTimersByTime(2400);
		expect(timer.visible).toBe(true);
		expect(onFadeChange).not.toHaveBeenCalled();

		// Cross 2500ms threshold
		vi.advanceTimersByTime(100);
		expect(timer.visible).toBe(false);
		expect(onFadeChange).toHaveBeenCalledWith(false);

		timer.dispose();
	});

	it('reappears and restarts timer on user interaction', () => {
		const onFadeChange = vi.fn();
		const timer = new InactivityFadeTimer({ timeoutMs: 2500, onFadeChange });

		// Let it fade out
		vi.advanceTimersByTime(2500);
		expect(timer.visible).toBe(false);

		// User touches screen
		timer.triggerInteraction();
		expect(timer.visible).toBe(true);
		expect(onFadeChange).toHaveBeenLastCalledWith(true);

		// Advance 2000ms and touch again
		vi.advanceTimersByTime(2000);
		expect(timer.visible).toBe(true);
		timer.triggerInteraction();

		// Advance another 2000ms (total 4000ms, but reset 2000ms ago, so still visible)
		vi.advanceTimersByTime(2000);
		expect(timer.visible).toBe(true);

		// Advance 500ms more -> 2500ms since last touch -> fades out
		vi.advanceTimersByTime(500);
		expect(timer.visible).toBe(false);

		timer.dispose();
	});
});
