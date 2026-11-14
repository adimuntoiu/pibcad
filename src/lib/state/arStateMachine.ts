import type { AnimationConfig } from '../manifest/types';

export type ARMachineState =
	| 'scanning'
	| 'generating'
	| 'tracking_single'
	| 'tracking_combined';

export interface ObservedTarget {
	id: string;
	rotationDeg?: number;
	snappedRotationDeg?: number;
}

export interface StateObservation {
	targets: ObservedTarget[];
	/** Optional explicit key used in multi-painting seam mode (Phase 2+). */
	stateKey?: string;
	/** Whether the explicit state represents a combined seam model. */
	isCombined?: boolean;
}

export interface ARStateSnapshot {
	state: ARMachineState;
	activeKey: string | null;
	pendingKey: string | null;
	pendingFrames: number;
	requiredDebounceFrames: number;
	isHolding: boolean;
	holdElapsedMs: number;
	dropHoldMs: number;
	generatingProgress: number;
	crossFadeAlpha: number;
	targets: ObservedTarget[];
}

export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
	loadingDurationMs: 1200,
	stateDebounceFrames: 5,
	dropHoldMs: 500,
	crossFadeDurationMs: 400
};

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function deriveStateKey(observation: StateObservation): {
	key: string | null;
	isCombined: boolean;
} {
	if (observation.targets.length === 0) {
		return { key: null, isCombined: false };
	}
	if (observation.stateKey) {
		return {
			key: observation.stateKey,
			isCombined: Boolean(observation.isCombined)
		};
	}
	if (observation.targets.length === 1) {
		return {
			key: `single:${observation.targets[0].id}`,
			isCombined: false
		};
	}
	const sortedIds = observation.targets.map((t) => t.id).sort().join('+');
	return {
		key: `multi:${sortedIds}`,
		isCombined: Boolean(observation.isCombined)
	};
}

/**
 * Pure AR UI & model-transition state machine.
 * Enforces N-frame stability debounce, synthetic "Generating 3D model..." delay,
 * brief drop-hold persistence, and smooth opacity cross-fade progression.
 */
export class ARStateMachine {
	private config: AnimationConfig;
	private state: ARMachineState = 'scanning';
	private activeKey: string | null = null;
	private activeIsCombined = false;

	private pendingKey: string | null = null;
	private pendingFrames = 0;
	private pendingIsCombined = false;

	private heldTargets: ObservedTarget[] = [];
	private lastSeenAt: number | null = null;
	private isHolding = false;

	private generatingStartedAt: number | null = null;
	private revealedAt: number | null = null;
	private lastNowMs = 0;

	constructor(config: Partial<AnimationConfig> = {}) {
		this.config = { ...DEFAULT_ANIMATION_CONFIG, ...config };
	}

	updateConfig(config: Partial<AnimationConfig>): void {
		this.config = { ...this.config, ...config };
	}

	reset(): void {
		this.state = 'scanning';
		this.activeKey = null;
		this.activeIsCombined = false;
		this.pendingKey = null;
		this.pendingFrames = 0;
		this.pendingIsCombined = false;
		this.heldTargets = [];
		this.lastSeenAt = null;
		this.isHolding = false;
		this.generatingStartedAt = null;
		this.revealedAt = null;
		this.lastNowMs = 0;
	}

	/**
	 * Feed one detection observation frame at timestamp `nowMs`.
	 * Only real observation calls count toward `stateDebounceFrames`.
	 */
	observe(observation: StateObservation, nowMs: number): ARStateSnapshot {
		const { key: rawKey, isCombined } = deriveStateKey(observation);
		const requiredFrames = Math.max(1, Math.round(this.config.stateDebounceFrames));

		if (rawKey !== null) {
			this.lastSeenAt = nowMs;
			this.isHolding = false;
			this.heldTargets = observation.targets.map((t) => ({ ...t }));

			if (rawKey === this.activeKey) {
				this.pendingKey = null;
				this.pendingFrames = 0;
				this.pendingIsCombined = false;
			} else {
				if (rawKey === this.pendingKey && isCombined === this.pendingIsCombined) {
					this.pendingFrames += 1;
				} else {
					this.pendingKey = rawKey;
					this.pendingFrames = 1;
					this.pendingIsCombined = isCombined;
				}

				if (this.pendingFrames >= requiredFrames) {
					this.commitTargetState(rawKey, isCombined, nowMs);
				}
			}
		} else {
			this.pendingKey = null;
			this.pendingFrames = 0;
			this.pendingIsCombined = false;
		}

		return this.advanceTime(nowMs);
	}

	/**
	 * Advance time-based transitions (generating -> tracking, cross-fade alpha,
	 * and drop-hold expiry) without adding candidate debounce frames.
	 */
	advanceTime(nowMs: number): ARStateSnapshot {
		this.lastNowMs = Math.max(this.lastNowMs, nowMs);

		if (this.activeKey !== null && this.lastSeenAt !== null) {
			const elapsedSinceSeen = Math.max(0, nowMs - this.lastSeenAt);
			if (elapsedSinceSeen > 0 && elapsedSinceSeen <= this.config.dropHoldMs) {
				this.isHolding = true;
			} else if (elapsedSinceSeen > this.config.dropHoldMs) {
				this.state = 'scanning';
				this.activeKey = null;
				this.activeIsCombined = false;
				this.heldTargets = [];
				this.lastSeenAt = null;
				this.isHolding = false;
				this.generatingStartedAt = null;
				this.revealedAt = null;
			}
		}

		if (this.state === 'generating' && this.generatingStartedAt !== null) {
			const genElapsed = nowMs - this.generatingStartedAt;
			if (genElapsed >= this.config.loadingDurationMs) {
				this.state = this.activeIsCombined ? 'tracking_combined' : 'tracking_single';
				this.revealedAt = this.generatingStartedAt + Math.max(0, this.config.loadingDurationMs);
			}
		}

		return this.getSnapshot(nowMs);
	}

	getSnapshot(nowMs: number = this.lastNowMs): ARStateSnapshot {
		const requiredDebounceFrames = Math.max(1, Math.round(this.config.stateDebounceFrames));

		let generatingProgress = 0;
		if (this.state === 'generating' && this.generatingStartedAt !== null) {
			generatingProgress =
				this.config.loadingDurationMs > 0
					? clamp01((nowMs - this.generatingStartedAt) / this.config.loadingDurationMs)
					: 1;
		} else if (this.state === 'tracking_single' || this.state === 'tracking_combined') {
			generatingProgress = 1;
		}

		let crossFadeAlpha = 0;
		if (
			(this.state === 'tracking_single' || this.state === 'tracking_combined') &&
			this.revealedAt !== null
		) {
			crossFadeAlpha =
				this.config.crossFadeDurationMs > 0
					? clamp01((nowMs - this.revealedAt) / this.config.crossFadeDurationMs)
					: 1;
		}

		const holdElapsedMs =
			this.isHolding && this.lastSeenAt !== null ? Math.max(0, nowMs - this.lastSeenAt) : 0;

		return {
			state: this.state,
			activeKey: this.activeKey,
			pendingKey: this.pendingKey,
			pendingFrames: this.pendingFrames,
			requiredDebounceFrames,
			isHolding: this.isHolding,
			holdElapsedMs,
			dropHoldMs: this.config.dropHoldMs,
			generatingProgress,
			crossFadeAlpha,
			targets: this.heldTargets.map((t) => ({ ...t }))
		};
	}

	private commitTargetState(nextKey: string, isCombined: boolean, nowMs: number): void {
		this.activeKey = nextKey;
		this.activeIsCombined = isCombined;
		this.pendingKey = null;
		this.pendingFrames = 0;
		this.pendingIsCombined = false;

		const shouldGenerate =
			(this.state === 'scanning' || this.state === 'generating') &&
			this.config.loadingDurationMs > 0;

		if (shouldGenerate) {
			this.state = 'generating';
			this.generatingStartedAt = nowMs;
			this.revealedAt = null;
		} else {
			this.state = isCombined ? 'tracking_combined' : 'tracking_single';
			this.generatingStartedAt = nowMs;
			this.revealedAt = nowMs;
		}
	}
}
