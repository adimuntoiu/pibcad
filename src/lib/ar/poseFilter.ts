import type { CanvasPose } from '#lib/types';

/**
 * Shortest-path angular interpolation in radians (-PI..PI)
 */
export function lerpAngleRad(current: number, target: number, t: number): number {
	const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
	return current + diff * t;
}

/**
 * Frame-rate independent exponential low-pass filter for a single canvas 3D pose.
 * Prevents jitter and hard jumps in position, scale, and roll angle.
 */
export class LowPassPoseFilter {
	private current: CanvasPose | null = null;
	private readonly baseAlpha: number;

	constructor(baseAlpha = 0.2) {
		this.baseAlpha = baseAlpha;
	}

	update(target: CanvasPose, dtSeconds: number): CanvasPose {
		if (!this.current) {
			this.current = { ...target };
			return { ...this.current };
		}

		// Frame-rate independent smoothing factor normalized to 60fps
		const clampedDt = Math.min(Math.max(dtSeconds, 0.001), 0.1);
		const alpha = 1 - Math.pow(1 - this.baseAlpha, clampedDt * 60);

		this.current.x += (target.x - this.current.x) * alpha;
		this.current.y += (target.y - this.current.y) * alpha;
		this.current.z += (target.z - this.current.z) * alpha;
		this.current.size += (target.size - this.current.size) * alpha;
		this.current.rollRad = lerpAngleRad(this.current.rollRad, target.rollRad, alpha);
		this.current.rotation = target.rotation;
		this.current.confidence += (target.confidence - this.current.confidence) * alpha;

		return { ...this.current };
	}

	get value(): CanvasPose | null {
		return this.current ? { ...this.current } : null;
	}

	reset(): void {
		this.current = null;
	}
}

/**
 * Smooth opacity envelope (fade-in / fade-out) so AR overlays never hard-cut.
 */
export class SmoothFadeEnvelope {
	opacity = 0;
	private readonly fadeInDurationSec: number;
	private readonly fadeOutDurationSec: number;

	constructor(fadeInDurationSec = 0.45, fadeOutDurationSec = 0.35) {
		this.fadeInDurationSec = fadeInDurationSec;
		this.fadeOutDurationSec = fadeOutDurationSec;
	}

	step(targetVisible: boolean, dtSeconds: number): number {
		const dt = Math.min(Math.max(dtSeconds, 0.001), 0.1);
		if (targetVisible) {
			this.opacity = Math.min(1, this.opacity + dt / this.fadeInDurationSec);
		} else {
			this.opacity = Math.max(0, this.opacity - dt / this.fadeOutDurationSec);
		}
		return this.opacity;
	}

	reset(): void {
		this.opacity = 0;
	}
}
