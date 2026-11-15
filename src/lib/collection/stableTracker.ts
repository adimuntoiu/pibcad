export interface StableTrackerOptions {
	/** Continuous stable tracking time required to trigger auto-save (default: 1500ms). */
	stableDurationMs?: number;
	/** Callback invoked when an artwork qualifies for saving. */
	onSave?: (artworkId: string) => void | Promise<void>;
}

export class StableTracker {
	readonly stableDurationMs: number;
	readonly savedInSession = new Set<string>();

	private currentCandidateId: string | null = null;
	private candidateFirstSeenAt: number | null = null;
	private onSave?: (artworkId: string) => void | Promise<void>;

	constructor(options: StableTrackerOptions = {}) {
		this.stableDurationMs = options.stableDurationMs ?? 1500;
		this.onSave = options.onSave;
	}

	/**
	 * Feed the currently detected primary artwork ID and current timestamp.
	 * Returns an object indicating whether a save was triggered.
	 */
	update(
		activeArtworkId: string | null | undefined,
		nowMs: number
	): { saved: boolean; artworkId?: string; progress: number } {
		if (!activeArtworkId) {
			this.currentCandidateId = null;
			this.candidateFirstSeenAt = null;
			return { saved: false, progress: 0 };
		}

		if (this.savedInSession.has(activeArtworkId)) {
			this.currentCandidateId = null;
			this.candidateFirstSeenAt = null;
			return { saved: false, progress: 1 };
		}

		if (this.currentCandidateId !== activeArtworkId) {
			this.currentCandidateId = activeArtworkId;
			this.candidateFirstSeenAt = nowMs;
			return { saved: false, progress: 0 };
		}

		const elapsed = nowMs - (this.candidateFirstSeenAt ?? nowMs);
		const progress = Math.min(1, elapsed / this.stableDurationMs);

		if (elapsed >= this.stableDurationMs) {
			const savedId = activeArtworkId;
			this.savedInSession.add(savedId);
			this.currentCandidateId = null;
			this.candidateFirstSeenAt = null;

			if (this.onSave) {
				void this.onSave(savedId);
			}

			return { saved: true, artworkId: savedId, progress: 1 };
		}

		return { saved: false, progress };
	}

	markSaved(artworkId: string): void {
		this.savedInSession.add(artworkId);
	}

	resetSession(): void {
		this.savedInSession.clear();
		this.currentCandidateId = null;
		this.candidateFirstSeenAt = null;
	}
}
