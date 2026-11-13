import { BackendUnreachableError, recognizeFrame } from '$lib/api/recognize';
import { CameraSetupError, FrameCapturer, startRearCamera, stopCameraStream } from '$lib/camera/camera';
import type { RecognitionResponse, ScannerStatus } from '$lib/types';

const CAPTURE_INTERVAL_MS = 500;
const REQUIRED_CONSECUTIVE_MATCHES = 3;
const CLEAR_AFTER_NO_MATCH_MS = 2000;

export interface RecognizedPainting {
	id: string;
	title: string;
	artist: string;
	confidence: number;
}

export class ScannerController {
	status = $state<ScannerStatus>('idle');
	errorMessage = $state<string | null>(null);
	recognized = $state<RecognizedPainting | null>(null);
	isRequestInFlight = $state<boolean>(false);

	private videoEl: HTMLVideoElement | null = null;
	private stream: MediaStream | null = null;
	private capturer: FrameCapturer | null = null;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private abortController: AbortController | null = null;

	private candidateId: string | null = null;
	private consecutiveCount = 0;
	private lastMatchTimestamp = 0;

	async start(videoEl: HTMLVideoElement): Promise<void> {
		this.stop();
		this.videoEl = videoEl;
		this.status = 'starting_camera';
		this.errorMessage = null;

		try {
			if (!this.capturer) {
				this.capturer = new FrameCapturer(384, 0.7);
			}
			this.stream = await startRearCamera(videoEl);
			this.status = 'scanning';
			this.startPollingLoop();
		} catch (err) {
			if (err instanceof CameraSetupError) {
				this.status = err.type === 'permission_denied' ? 'permission_denied' : 'no_camera';
				this.errorMessage = err.message;
			} else {
				this.status = 'no_camera';
				this.errorMessage = 'Could not start camera.';
			}
		}
	}

	stop(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		stopCameraStream(this.stream, this.videoEl);
		this.stream = null;
		this.isRequestInFlight = false;
		this.resetStabilization();
		this.status = 'idle';
	}

	async handleVisibilityChange(): Promise<void> {
		if (document.hidden) {
			this.stop();
		}
	}

	private resetStabilization(): void {
		this.candidateId = null;
		this.consecutiveCount = 0;
		this.lastMatchTimestamp = 0;
		this.recognized = null;
	}

	private startPollingLoop(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
		}
		this.intervalId = setInterval(() => {
			void this.tick();
		}, CAPTURE_INTERVAL_MS);
	}

	private async tick(): Promise<void> {
		if (this.isRequestInFlight || !this.videoEl || !this.capturer) {
			return;
		}

		if (this.videoEl.paused && this.stream?.active) {
			try {
				await this.videoEl.play();
			} catch {
				return;
			}
		}

		this.isRequestInFlight = true;
		this.abortController = new AbortController();

		try {
			const blob = await this.capturer.captureJpegBlob(this.videoEl);
			if (!blob) {
				return;
			}

			const res = await recognizeFrame(blob, this.abortController.signal);
			this.applyRecognitionResult(res);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				return;
			}
			if (err instanceof BackendUnreachableError) {
				this.status = 'backend_unreachable';
				this.errorMessage = 'Backend server is unreachable. Check your connection.';
			}
		} finally {
			this.isRequestInFlight = false;
		}
	}

	private applyRecognitionResult(res: RecognitionResponse): void {
		const now = performance.now();

		if (res.match && res.id && res.title && res.artist) {
			this.lastMatchTimestamp = now;

			if (this.candidateId === res.id) {
				this.consecutiveCount += 1;
			} else {
				this.candidateId = res.id;
				this.consecutiveCount = 1;
			}

			if (this.consecutiveCount >= REQUIRED_CONSECUTIVE_MATCHES) {
				this.recognized = {
					id: res.id,
					title: res.title,
					artist: res.artist,
					confidence: res.confidence
				};
				this.status = 'recognized';
			} else if (!this.recognized) {
				this.status = 'scanning';
			}
		} else {
			this.candidateId = null;
			this.consecutiveCount = 0;

			if (this.recognized) {
				if (now - this.lastMatchTimestamp >= CLEAR_AFTER_NO_MATCH_MS) {
					this.recognized = null;
					this.status = 'scanning';
				}
			} else {
				this.status = 'scanning';
			}
		}
	}
}
