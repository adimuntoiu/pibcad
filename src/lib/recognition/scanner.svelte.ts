import { BackendUnreachableError, detectPainting } from '#lib/recognition/api';
import {
	CameraSetupError,
	FrameCapturer,
	startRearCamera,
	stopCameraStream
} from '#lib/camera/camera';
import type { DetectionResponse, Point, ScannerStatus } from '#lib/types';

/** Minimum gap between frames sent to the backend. Only one request is in flight at a time. */
const DETECT_INTERVAL_MS = 35;
/** Keep showing the last corners for this long after a missed frame, to avoid flicker. */
const HOLD_MS = 450;
/** Responsive smoothing factor (0.75 = snappy tracking with minimal lag). */
const SMOOTHING = 0.75;

/**
 * Rotates the cyclic order (0..3) of `next` corners so each corner matches the closest
 * corner from `prev`, preventing corner-index swaps when rotating past 45°/90°/180°.
 */
function alignCyclicCorners(prev: Point[], next: Point[]): Point[] {
	let bestShift = 0;
	let bestDist = Infinity;
	for (let shift = 0; shift < 4; shift++) {
		let dist = 0;
		for (let i = 0; i < 4; i++) {
			const p = prev[i];
			const q = next[(i + shift) % 4];
			dist += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
		}
		if (dist < bestDist) {
			bestDist = dist;
			bestShift = shift;
		}
	}
	return [0, 1, 2, 3].map((i) => next[(i + bestShift) % 4]);
}

export class PaintingScanner {
	status = $state<ScannerStatus>('idle');
	errorMessage = $state<string | null>(null);
	/** Corners in normalized camera-frame coordinates (4 cyclic corners), or null when nothing is detected. */
	corners = $state<Point[] | null>(null);
	title = $state<string | null>(null);
	artist = $state<string | null>(null);

	private videoEl: HTMLVideoElement | null = null;
	private stream: MediaStream | null = null;
	private capturer: FrameCapturer | null = null;
	private running = false;
	private abort: AbortController | null = null;
	private lastSeenAt = 0;

	async start(videoEl: HTMLVideoElement): Promise<void> {
		this.stop();
		this.videoEl = videoEl;
		this.status = 'starting_camera';
		this.errorMessage = null;

		try {
			this.capturer ??= new FrameCapturer(360, 0.65);
			this.stream = await startRearCamera(videoEl);
		} catch (err) {
			if (err instanceof CameraSetupError) {
				this.status = err.type === 'permission_denied' ? 'permission_denied' : 'no_camera';
				this.errorMessage = err.message;
			} else {
				this.status = 'no_camera';
				this.errorMessage = 'Could not start the camera.';
			}
			return;
		}

		this.status = 'scanning';
		this.running = true;
		void this.loop();
	}

	stop(): void {
		this.running = false;
		this.abort?.abort();
		this.abort = null;
		stopCameraStream(this.stream, this.videoEl);
		this.stream = null;
		this.corners = null;
		this.title = null;
		this.artist = null;
		this.status = 'idle';
	}

	/** Resume the video after the tab comes back (iOS Safari pauses it). */
	async resumeVideo(): Promise<void> {
		if (this.videoEl?.paused && this.stream?.active) {
			try {
				await this.videoEl.play();
			} catch {
				// needs a user gesture; the user can tap Start again
			}
		}
	}

	private async loop(): Promise<void> {
		while (this.running && this.videoEl && this.capturer) {
			const startedAt = performance.now();
			this.abort = new AbortController();
			try {
				const blob = await this.capturer.captureJpegBlob(this.videoEl);
				if (blob) {
					const result = await detectPainting(blob, this.abort.signal);
					if (!this.running) return;
					this.apply(result);
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				if (err instanceof BackendUnreachableError) {
					this.corners = null;
					this.status = 'backend_unreachable';
					this.errorMessage = 'Cannot reach the detection backend.';
				}
			}
			const wait = DETECT_INTERVAL_MS - (performance.now() - startedAt);
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		}
	}

	private apply(result: DetectionResponse): void {
		const now = performance.now();

		if (result.match && result.corners) {
			const rawNext = result.corners.map(([x, y]) => ({ x, y }));
			if (this.corners) {
				const aligned = alignCyclicCorners(this.corners, rawNext);
				this.corners = aligned.map((p, i) => ({
					x: this.corners![i].x + (p.x - this.corners![i].x) * SMOOTHING,
					y: this.corners![i].y + (p.y - this.corners![i].y) * SMOOTHING
				}));
			} else {
				this.corners = rawNext;
			}
			this.title = result.title;
			this.artist = result.artist;
			this.lastSeenAt = now;
			this.status = 'detected';
			return;
		}

		if (this.corners && now - this.lastSeenAt > HOLD_MS) {
			this.corners = null;
			this.title = null;
			this.artist = null;
		}
		if (!this.corners) this.status = 'scanning';
	}
}
