import {
	type ArrangementCombination,
	evaluateSeam,
	getAll16Arrangements,
	PHASE1_DEMO_PAIR
} from '#lib/ar/seam';
import { DualCanvasTracker, type TrackerMode } from '#lib/ar/tracker';
import {
	CameraSetupError,
	FrameCapturer,
	startRearCamera,
	stopCameraStream
} from '#lib/camera/camera';
import { BackendUnreachableError, recognizeFrame } from '#lib/recognition/api';
import type {
	PairInfo,
	RecognitionResponse,
	RotationDeg,
	ScannerStatus,
	SeamEvaluation,
	TrackedCanvas
} from '#lib/types';

const RECOGNITION_INTERVAL_MS = 500;
const REQUIRED_CONSECUTIVE_MATCHES = 3;
const TRACKER_SAMPLE_INTERVAL_MS = 50;
const LOST_TO_RECOGNITION_MS = 1500;

export type HybridPhase = 'idle' | 'recognizing' | 'tracking';

export class HybridScannerController {
	status = $state<ScannerStatus>('idle');
	phase = $state<HybridPhase>('idle');
	errorMessage = $state<string | null>(null);

	pair = $state<PairInfo>(PHASE1_DEMO_PAIR);
	canvasA = $state<TrackedCanvas | null>(null);
	canvasB = $state<TrackedCanvas | null>(null);
	seam = $state<SeamEvaluation>(evaluateSeam(PHASE1_DEMO_PAIR, null, null));

	// Recognition telemetry
	isRequestInFlight = $state<boolean>(false);
	consecutiveMatches = $state<number>(0);
	candidateKey = $state<string | null>(null);
	lastRecognizedPaintingId = $state<string | null>(null);
	lastRecognizedOrientation = $state<RotationDeg | null>(null);
	lastConfidence = $state<number>(0);
	backendOnline = $state<boolean>(true);

	// Tracker & Interactive Rig controls
	trackerMode = $state<TrackerMode>('rig');
	rigRotationA = $state<RotationDeg>(0);
	rigRotationB = $state<RotationDeg>(180);
	rigTrackA = $state<boolean>(true);
	rigTrackB = $state<boolean>(true);

	readonly tracker = new DualCanvasTracker();
	readonly arrangements: ArrangementCombination[] = getAll16Arrangements(PHASE1_DEMO_PAIR);

	private videoEl: HTMLVideoElement | null = null;
	private stream: MediaStream | null = null;
	private capturer: FrameCapturer | null = null;
	private rigFrameCanvas: HTMLCanvasElement | null = null;
	private rigImgA: HTMLImageElement | null = null;

	private recognitionTimer: ReturnType<typeof setInterval> | null = null;
	private trackingTimer: ReturnType<typeof setInterval> | null = null;
	private abortController: AbortController | null = null;

	private prevRotA: RotationDeg | null = null;
	private prevRotB: RotationDeg | null = null;
	private lostSinceMs = 0;

	async start(videoEl: HTMLVideoElement): Promise<void> {
		this.stop();
		this.videoEl = videoEl;
		this.status = 'starting_camera';
		this.errorMessage = null;

		try {
			if (!this.capturer) {
				this.capturer = new FrameCapturer(384, 0.75);
			}
			this.preloadRigReferenceImage();
			this.stream = await startRearCamera(videoEl);
			this.enterRecognitionPhase();
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
		this.stopRecognitionLoop();
		this.stopTrackingLoop();
		stopCameraStream(this.stream, this.videoEl);
		this.stream = null;
		this.canvasA = null;
		this.canvasB = null;
		this.seam = evaluateSeam(this.pair, null, null);
		this.prevRotA = null;
		this.prevRotB = null;
		this.consecutiveMatches = 0;
		this.candidateKey = null;
		this.phase = 'idle';
		this.status = 'idle';
	}

	async handleVisibilityChange(): Promise<void> {
		if (document.hidden) {
			this.stop();
		} else if (this.videoEl && this.stream?.active && this.videoEl.paused) {
			try {
				await this.videoEl.play();
			} catch {
				// Ignore iOS Safari gesture restriction
			}
		}
	}

	/**
	 * Step 2-4 of Hybrid Architecture:
	 * Poll POST /api/recognize every ~500ms (one request in flight at a time)
	 * ONLY when nothing is currently tracked. Require 3 consecutive identical
	 * (painting_id, orientation) matches before handing over to on-device tracking.
	 */
	enterRecognitionPhase(reason: 'initial' | 'rotated' | 'lost' = 'initial'): void {
		this.stopTrackingLoop();
		this.phase = 'recognizing';
		this.consecutiveMatches = 0;
		this.candidateKey = null;

		// Smoothly fade out AR overlay while recognizing
		this.canvasA = null;
		this.canvasB = null;
		this.seam = evaluateSeam(this.pair, null, null);
		this.status = reason === 'initial' ? 'scanning' : 'tracking_lost';

		this.stopRecognitionLoop();
		void this.recognitionTick();
		this.recognitionTimer = setInterval(() => {
			void this.recognitionTick();
		}, RECOGNITION_INTERVAL_MS);
	}

	/**
	 * Step 5-7 of Hybrid Architecture:
	 * Stop server recognition polling and hand over 100% to on-device frame tracking.
	 */
	private handOverToTracking(paintingId: string, orientation: RotationDeg): void {
		this.stopRecognitionLoop();
		this.phase = 'tracking';
		this.lastRecognizedPaintingId = paintingId;
		this.lastRecognizedOrientation = orientation;

		// Synchronize recognized orientation with tracker
		if (paintingId === this.pair.paintingA.id) {
			this.rigRotationA = orientation;
			this.tracker.rigRotationA = orientation;
		} else if (paintingId === this.pair.paintingB.id) {
			this.rigRotationB = orientation;
			this.tracker.rigRotationB = orientation;
		}

		this.prevRotA = this.rigRotationA;
		this.prevRotB = this.rigRotationB;
		this.lostSinceMs = 0;

		this.trackingTick();
		this.trackingTimer = setInterval(() => {
			this.trackingTick();
		}, TRACKER_SAMPLE_INTERVAL_MS);
	}

	private stopRecognitionLoop(): void {
		if (this.recognitionTimer !== null) {
			clearInterval(this.recognitionTimer);
			this.recognitionTimer = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		this.isRequestInFlight = false;
	}

	private stopTrackingLoop(): void {
		if (this.trackingTimer !== null) {
			clearInterval(this.trackingTimer);
			this.trackingTimer = null;
		}
	}

	private preloadRigReferenceImage(): void {
		if (typeof Image === 'undefined' || this.rigImgA) return;
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.src = this.pair.paintingA.imageUrl;
		this.rigImgA = img;
	}

	/**
	 * Captures a downscaled 384px JPEG frame:
	 * - In 'camera_vision' mode: directly from the live rear <video> element.
	 * - In 'rig' mode: renders the active rotated target painting at `rigRotationA` so
	 *   POST /api/recognize tests the real FastAPI embedding & orientation classifier!
	 */
	private async captureRecognitionBlob(): Promise<Blob | null> {
		if (this.trackerMode === 'rig' && this.rigImgA && this.rigImgA.complete) {
			if (!this.rigFrameCanvas) {
				this.rigFrameCanvas = document.createElement('canvas');
				this.rigFrameCanvas.width = 384;
				this.rigFrameCanvas.height = 384;
			}
			const ctx = this.rigFrameCanvas.getContext('2d');
			if (ctx) {
				ctx.save();
				ctx.clearRect(0, 0, 384, 384);
				ctx.translate(192, 192);
				ctx.rotate((this.rigRotationA * Math.PI) / 180);
				ctx.drawImage(this.rigImgA, -192, -192, 384, 384);
				ctx.restore();
				return new Promise<Blob | null>((resolve) =>
					this.rigFrameCanvas!.toBlob((b) => resolve(b), 'image/jpeg', 0.8)
				);
			}
		}

		if (!this.videoEl || !this.capturer) return null;
		return this.capturer.captureJpegBlob(this.videoEl);
	}

	private async recognitionTick(): Promise<void> {
		if (this.phase !== 'recognizing' || this.isRequestInFlight) {
			return;
		}

		if (this.videoEl && this.videoEl.paused && this.stream?.active) {
			try {
				await this.videoEl.play();
			} catch {
				return;
			}
		}

		this.isRequestInFlight = true;
		this.abortController = new AbortController();

		try {
			const blob = await this.captureRecognitionBlob();
			if (!blob) return;

			const res = await recognizeFrame(blob, this.abortController.signal);
			this.backendOnline = true;
			this.applyRecognitionResult(res);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				return;
			}
			if (err instanceof BackendUnreachableError) {
				this.backendOnline = false;
				// If in Interactive Rig mode and backend is offline, allow seamless local handover after 3 ticks
				if (this.trackerMode === 'rig') {
					this.applyRecognitionResult({
						match: true,
						painting_id: this.pair.paintingA.id,
						orientation: this.rigRotationA,
						confidence: 0.95
					});
				} else {
					this.status = 'backend_unreachable';
					this.errorMessage = 'Recognition server unreachable on /api/recognize.';
				}
			}
		} finally {
			this.isRequestInFlight = false;
		}
	}

	private applyRecognitionResult(res: RecognitionResponse): void {
		const pid = res.painting_id ?? res.id ?? null;
		const orientation: RotationDeg =
			res.orientation === 0 ||
			res.orientation === 90 ||
			res.orientation === 180 ||
			res.orientation === 270
				? res.orientation
				: 0;

		if (res.match && pid) {
			const key = `${pid}@${orientation}`;
			this.lastConfidence = res.confidence;

			if (this.candidateKey === key) {
				this.consecutiveMatches += 1;
			} else {
				this.candidateKey = key;
				this.consecutiveMatches = 1;
			}

			if (this.consecutiveMatches >= REQUIRED_CONSECUTIVE_MATCHES) {
				this.handOverToTracking(pid, orientation);
			} else {
				this.status = 'scanning';
			}
		} else {
			this.candidateKey = null;
			this.consecutiveMatches = 0;
			this.status = 'scanning';
		}
	}

	private trackingTick(): void {
		if (this.phase !== 'tracking') return;
		const now = performance.now();

		if (this.videoEl && this.videoEl.paused && this.stream?.active) {
			void this.videoEl.play().catch(() => {});
		}

		const snap = this.tracker.sample(this.pair, this.videoEl, now);

		// Domain rule 8: "If the user rotates a canvas, treat it as lost tracking and re-recognize."
		const rotChangedA =
			snap.canvasA !== null && this.prevRotA !== null && snap.canvasA.rotation !== this.prevRotA;
		const rotChangedB =
			snap.canvasB !== null && this.prevRotB !== null && snap.canvasB.rotation !== this.prevRotB;

		if (rotChangedA || rotChangedB) {
			this.prevRotA = snap.canvasA ? snap.canvasA.rotation : null;
			this.prevRotB = snap.canvasB ? snap.canvasB.rotation : null;
			this.enterRecognitionPhase('rotated');
			return;
		}

		this.prevRotA = snap.canvasA ? snap.canvasA.rotation : null;
		this.prevRotB = snap.canvasB ? snap.canvasB.rotation : null;

		this.canvasA = snap.canvasA;
		this.canvasB = snap.canvasB;
		this.seam = evaluateSeam(this.pair, snap.canvasA, snap.canvasB);

		if (snap.canvasA && snap.canvasB) {
			this.lostSinceMs = 0;
			this.status = this.seam.isValidMatch ? 'valid_arrangement' : 'non_matching';
		} else if (snap.canvasA || snap.canvasB) {
			this.lostSinceMs = 0;
			this.status = 'one_recognized';
		} else {
			// Tracking lost on both canvases: fade out and return to server recognition
			if (this.lostSinceMs === 0) {
				this.lostSinceMs = now;
				this.status = 'tracking_lost';
			} else if (now - this.lostSinceMs >= LOST_TO_RECOGNITION_MS) {
				this.enterRecognitionPhase('lost');
			}
		}
	}

	setTrackerMode(mode: TrackerMode): void {
		this.trackerMode = mode;
		this.tracker.mode = mode;
		if (this.phase !== 'idle') {
			this.enterRecognitionPhase('initial');
		}
	}

	rotateCanvas(slot: 'A' | 'B'): void {
		const next = this.tracker.rotateRigCanvas(slot);
		if (slot === 'A') {
			this.rigRotationA = next;
		} else {
			this.rigRotationB = next;
		}
	}

	setArrangement(rotA: RotationDeg, rotB: RotationDeg): void {
		this.rigTrackA = true;
		this.rigTrackB = true;
		this.tracker.rigTrackA = true;
		this.tracker.rigTrackB = true;
		this.rigRotationA = rotA;
		this.rigRotationB = rotB;
		this.tracker.setRigRotations(rotA, rotB);
	}

	toggleCanvasPresence(slot: 'A' | 'B'): void {
		if (slot === 'A') {
			this.rigTrackA = !this.rigTrackA;
			this.tracker.rigTrackA = this.rigTrackA;
		} else {
			this.rigTrackB = !this.rigTrackB;
			this.tracker.rigTrackB = this.rigTrackB;
		}
	}
}
