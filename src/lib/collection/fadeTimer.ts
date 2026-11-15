export interface FadeTimerOptions {
	/** Inactivity duration before controls fade out (default: 2500ms). */
	timeoutMs?: number;
	onFadeChange?: (visible: boolean) => void;
}

export class InactivityFadeTimer {
	readonly timeoutMs: number;
	visible = true;

	private timerId: ReturnType<typeof setTimeout> | null = null;
	private onFadeChange?: (visible: boolean) => void;

	constructor(options: FadeTimerOptions = {}) {
		this.timeoutMs = options.timeoutMs ?? 2500;
		this.onFadeChange = options.onFadeChange;
		this.scheduleFade();
	}

	/** Call whenever the user touches, clicks, or interacts with the screen. */
	triggerInteraction(): void {
		const wasVisible = this.visible;
		this.visible = true;
		if (!wasVisible && this.onFadeChange) {
			this.onFadeChange(true);
		}
		this.scheduleFade();
	}

	private scheduleFade(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
		}
		this.timerId = setTimeout(() => {
			this.visible = false;
			if (this.onFadeChange) {
				this.onFadeChange(false);
			}
			this.timerId = null;
		}, this.timeoutMs);
	}

	reset(): void {
		this.triggerInteraction();
	}

	dispose(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}
}
