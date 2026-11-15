import type { DetectionResponse, Point, Pose6DoF, ScannerStatus } from '#lib/types';
import {
	CameraSetupError,
	FrameCapturer,
	startRearCamera,
	stopCameraStream
} from '#lib/camera/camera';
import { BackendUnreachableError, detectPainting } from './api';

const DETECT_INTERVAL_MS = 140;
const DEFAULT_HOLD_MS = 500;
const SMOOTHING = 0.75;
// If vertex 0 jumped further than ~35% of screen width (e.g. a 90°/180° step), snap instead of linear lerping across the square.
const SNAP_JUMP_THRESHOLD_SQ = 0.35 * 0.35;

export interface TrackedPainting {
	id: string;
	title: string;
	artist: string;
	corners: Point[];
	inliers: number;
	modelUrl?: string | null;
	rotationDeg: number;
	snappedRotationDeg: number;
	pose?: Pose6DoF | null;
	lastSeenAt: number;
}

function computeRotationDegFromCorners(corners: Point[]): number {
	if (corners.length < 2) return 0;
	const dx = corners[1].x - corners[0].x;
	const dy = corners[1].y - corners[0].y;
	return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
}

function snapDegTo90(deg: number): number {
	return (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
}

/**
 * Smooths canonical [TL, TR, BR, BL] corners index-by-index WITHOUT permuting indices,
 * preserving physical Edge A orientation across 0°/90°/180°/270° canvas rotations.
 */
function smoothCanonicalCorners(prev: Point[], next: Point[]): Point[] {
	if (prev.length !== 4 || next.length !== 4) return next;
	const d0Sq = (prev[0].x - next[0].x) ** 2 + (prev[0].y - next[0].y) ** 2;
	const spanSq = Math.max(1e-4, (next[1].x - next[0].x) ** 2 + (next[1].y - next[0].y) ** 2);
	const prevRot = computeRotationDegFromCorners(prev);
	const nextRot = computeRotationDegFromCorners(next);
	const rotDiff = Math.abs((((nextRot - prevRot + 180) % 360) + 360) % 360 - 180);
	if (d0Sq > SNAP_JUMP_THRESHOLD_SQ || d0Sq > spanSq * 0.45 || rotDiff > 35) {
		return next;
	}
	return next.map((p, k) => ({
		x: prev[k].x + (p.x - prev[k].x) * SMOOTHING,
		y: prev[k].y + (p.y - prev[k].y) * SMOOTHING
	}));
}

export class PaintingScanner {
	status = $state<ScannerStatus>('idle');
	errorMessage = $state<string | null>(null);

	/** Held/smoothed list of tracked paintings in the frame (respects drop-hold). */
	paintings = $state<TrackedPainting[]>([]);
	/** Latest instantaneous detections from the most recent frame (un-held, empty on miss). */
	rawPaintings = $state<TrackedPainting[]>([]);

	/** Telemetry for the Debug HUD. */
	detectLatencyMs = $state(0);
	detectFps = $state(0);

	holdMs = DEFAULT_HOLD_MS;
	onDetectionSample?: (rawPaintings: TrackedPainting[], nowMs: number) => void;

	// Reactive derived properties for backward compatibility
	corners = $derived(this.paintings[0]?.corners ?? null);
	title = $derived(this.paintings[0]?.title ?? null);
	artist = $derived(this.paintings[0]?.artist ?? null);
	paintingId = $derived(this.paintings[0]?.id ?? null);
	modelUrl = $derived(this.paintings[0]?.modelUrl ?? null);

	private videoEl: HTMLVideoElement | null = null;
	private stream: MediaStream | null = null;
	private capturer: FrameCapturer | null = null;
	private running = false;
	private abort: AbortController | null = null;
	private lastDetectCompletedAt = 0;

	async start(videoEl: HTMLVideoElement): Promise<void> {
		this.stop();
		this.videoEl = videoEl;
		this.status = 'starting_camera';
		this.errorMessage = null;

		try {
			this.capturer ??= new FrameCapturer(480, 0.78);
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
		this.lastDetectCompletedAt = 0;
		void this.loop();
	}

	stop(): void {
		this.running = false;
		this.abort?.abort();
		this.abort = null;
		stopCameraStream(this.stream, this.videoEl);
		this.stream = null;
		this.paintings = [];
		this.rawPaintings = [];
		this.detectLatencyMs = 0;
		this.detectFps = 0;
		this.status = 'idle';
	}

	/**
	 * Pauses detection looping and video playback temporarily without tearing down
	 * the stream, e.g. when tab is minimized or temporarily blurred.
	 */
	pause(): void {
		this.running = false;
		this.abort?.abort();
		this.abort = null;
		if (this.videoEl && !this.videoEl.paused) {
			this.videoEl.pause();
		}
	}

	/**
	 * Resumes detection looping and video playback when tab is focused again.
	 * If the stream was terminated by the OS, it re-acquires the camera.
	 */
	async resume(): Promise<void> {
		if (this.stream && this.stream.active && this.videoEl) {
			this.running = true;
			try {
				await this.videoEl.play();
				this.status = 'scanning';
				void this.loop();
			} catch {
				// Needs user gesture or autoplay policy
			}
		} else if (this.videoEl) {
			await this.start(this.videoEl);
		}
	}

	/** Resume the video after the tab comes back (iOS Safari pauses it). */
	async resumeVideo(): Promise<void> {
		await this.resume();
	}

	private async loop(): Promise<void> {
		while (this.running && this.videoEl && this.capturer) {
			const startedAt = performance.now();
			this.abort = new AbortController();
			try {
				const blob = await this.capturer.captureJpegBlob(this.videoEl);
				if (blob) {
					const reqStart = performance.now();
					const result = await detectPainting(blob, this.abort.signal);
					if (!this.running) return;
					const now = performance.now();
					this.detectLatencyMs = Math.round(now - reqStart);
					if (this.lastDetectCompletedAt > 0) {
						const dt = now - this.lastDetectCompletedAt;
						if (dt > 0) {
							const instFps = 1000 / dt;
							this.detectFps =
								this.detectFps === 0
									? Math.round(instFps * 10) / 10
									: Math.round((this.detectFps * 0.7 + instFps * 0.3) * 10) / 10;
						}
					}
					this.lastDetectCompletedAt = now;
					this.apply(result);
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				if (err instanceof BackendUnreachableError) {
					this.paintings = [];
					this.rawPaintings = [];
					this.status = 'backend_unreachable';
					this.errorMessage = 'Cannot reach the detection backend.';
					this.onDetectionSample?.([], performance.now());
				}
			}
			const wait = DETECT_INTERVAL_MS - (performance.now() - startedAt);
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		}
	}

	private apply(result: DetectionResponse): void {
		const now = performance.now();

		const incomingList =
			result.paintings && result.paintings.length > 0
				? result.paintings
				: result.match && result.corners && result.painting_id
					? [
							{
								painting_id: result.painting_id,
								title: result.title ?? '',
								artist: result.artist ?? '',
								corners: result.corners,
								inliers: result.inliers,
								model_path: result.model_path ?? result.model_url,
								rotation_deg: result.rotation_deg,
								snapped_rotation_deg: result.snapped_rotation_deg,
								pose: result.pose
							}
						]
					: [];

		if (incomingList.length > 0) {
			const freshDetections: TrackedPainting[] = [];
			const matchedExistingIndices = new Set<number>();

			for (const inc of incomingList) {
				const rawPts: Point[] = inc.corners.map(([x, y]) => ({ x, y }));
				const rotDeg = inc.rotation_deg ?? computeRotationDegFromCorners(rawPts);
				const snappedDeg = inc.snapped_rotation_deg ?? snapDegTo90(rotDeg);

				let matchIdx = -1;
				for (let i = 0; i < this.paintings.length; i++) {
					if (!matchedExistingIndices.has(i) && this.paintings[i].id === inc.painting_id) {
						matchIdx = i;
						break;
					}
				}

				if (matchIdx !== -1) {
					matchedExistingIndices.add(matchIdx);
					const prev = this.paintings[matchIdx];
					const smoothed = smoothCanonicalCorners(prev.corners, rawPts);
					freshDetections.push({
						id: inc.painting_id,
						title: inc.title,
						artist: inc.artist,
						corners: smoothed,
						inliers: inc.inliers ?? 0,
						modelUrl: inc.model_path ?? null,
						rotationDeg: rotDeg,
						snappedRotationDeg: snappedDeg,
						pose: inc.pose ?? null,
						lastSeenAt: now
					});
				} else {
					freshDetections.push({
						id: inc.painting_id,
						title: inc.title,
						artist: inc.artist,
						corners: rawPts,
						inliers: inc.inliers ?? 0,
						modelUrl: inc.model_path ?? null,
						rotationDeg: rotDeg,
						snappedRotationDeg: snappedDeg,
						pose: inc.pose ?? null,
						lastSeenAt: now
					});
				}
			}

			const updated: TrackedPainting[] = [...freshDetections];
			for (let i = 0; i < this.paintings.length; i++) {
				if (!matchedExistingIndices.has(i)) {
					const existing = this.paintings[i];
					if (now - existing.lastSeenAt <= this.holdMs) {
						updated.push(existing);
					}
				}
			}

			this.rawPaintings = freshDetections;
			this.paintings = updated;
			this.status = 'detected';
			this.onDetectionSample?.(this.paintings, now);
			return;
		}

		this.rawPaintings = [];
		this.paintings = this.paintings.filter((p) => now - p.lastSeenAt <= this.holdMs);
		if (this.paintings.length === 0) {
			this.status = 'scanning';
		}
		this.onDetectionSample?.(this.paintings, now);
	}

	/** Manually simulate a detected painting (useful in dev mode or when recognition backend is offline) */
	simulate(paintingId: string, title?: string, artist?: string, modelUrl?: string): void {
		const vw = this.videoEl?.videoWidth || 640;
		const vh = this.videoEl?.videoHeight || 480;
		const cx = vw / 2;
		const cy = vh / 2;
		const hw = Math.min(vw, vh) * 0.35;
		const hh = hw * 1.25;

		const corners: [number, number][] = [
			[cx - hw, cy - hh],
			[cx + hw, cy - hh],
			[cx + hw, cy + hh],
			[cx - hw, cy + hh]
		];

		this.apply({
			match: true,
			painting_id: paintingId,
			title: title || paintingId,
			artist: artist || 'IRLO',
			corners,
			inliers: 220,
			model_path: modelUrl || `/demo/models/${paintingId}.glb`,
			rotation_deg: 0,
			snapped_rotation_deg: 0
		});
	}

	/** Simulate an upright side-by-side seam pair */
	simulatePair(idA = 'irlo1', idB = 'irlo2'): void {
		const vw = this.videoEl?.videoWidth || 640;
		const vh = this.videoEl?.videoHeight || 480;
		const cx = vw / 2;
		const cy = vh / 2;
		const hw = Math.min(vw, vh) * 0.22;
		const hh = hw * 1.35;
		const gap = 16;

		const cornersA: [number, number][] = [
			[cx - gap - 2 * hw, cy - hh],
			[cx - gap, cy - hh],
			[cx - gap, cy + hh],
			[cx - gap - 2 * hw, cy + hh]
		];

		const cornersB: [number, number][] = [
			[cx + gap, cy - hh],
			[cx + gap + 2 * hw, cy - hh],
			[cx + gap + 2 * hw, cy + hh],
			[cx + gap, cy + hh]
		];

		this.apply({
			match: true,
			count: 2,
			painting_id: null,
			title: null,
			artist: null,
			corners: null,
			inliers: 180,
			paintings: [
				{
					painting_id: idA,
					title: 'Irlo I — Stone Guardian',
					artist: 'IRLO',
					corners: cornersA,
					inliers: 180,
					model_path: '/demo/models/irlo1_single.glb',
					rotation_deg: 0,
					snapped_rotation_deg: 0
				},
				{
					painting_id: idB,
					title: 'Irlo II — Inverted Horizon',
					artist: 'IRLO',
					corners: cornersB,
					inliers: 180,
					model_path: '/demo/models/irlo2_single.glb',
					rotation_deg: 0,
					snapped_rotation_deg: 0
				}
			]
		});
	}

	clearSimulation(): void {
		this.paintings = [];
		this.rawPaintings = [];
		this.status = 'scanning';
		this.onDetectionSample?.([], performance.now());
	}
}
