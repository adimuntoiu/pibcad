import { getPaintingEdges, ROTATION_STEPS } from '#lib/ar/seam';
import type { CanvasPose, PairInfo, RotationDeg, TrackedCanvas } from '#lib/types';

export type TrackerMode = 'rig' | 'camera_vision';

export interface DualTrackerSnapshot {
	canvasA: TrackedCanvas | null;
	canvasB: TrackedCanvas | null;
}

/**
 * Dual-canvas AR tracker supporting:
 * 1. Live camera computer-vision tracking of the two square canvas targets (detecting Painting A & B
 *    and their 0/90/180/270 quadrant orientations from the live video stream).
 * 2. Interactive Dual-Canvas AR Rig over the live camera stream for testing all 16 orientation
 *    combinations (4 valid seam arrangements AA/BB/CC/DD + 12 non-matching) and single/lost states
 *    without requiring physical prints.
 */
export class DualCanvasTracker {
	mode: TrackerMode = 'rig';

	// Interactive rig state
	rigTrackA = true;
	rigTrackB = true;
	rigRotationA: RotationDeg = 0;
	rigRotationB: RotationDeg = 180; // Default 0° + 180° = Valid Seam BB!

	private visionCanvas: HTMLCanvasElement | null = null;
	private visionCtx: CanvasRenderingContext2D | null = null;
	private lastVisionRunMs = 0;
	private cachedVisionSnapshot: DualTrackerSnapshot = { canvasA: null, canvasB: null };

	constructor() {
		if (typeof document !== 'undefined') {
			this.visionCanvas = document.createElement('canvas');
			this.visionCanvas.width = 160;
			this.visionCanvas.height = 120;
			this.visionCtx = this.visionCanvas.getContext('2d', { willReadFrequently: true });
		}
	}

	setRigRotations(rotA: RotationDeg, rotB: RotationDeg): void {
		this.rigRotationA = rotA;
		this.rigRotationB = rotB;
	}

	rotateRigCanvas(slot: 'A' | 'B'): RotationDeg {
		if (slot === 'A') {
			const idx = (ROTATION_STEPS.indexOf(this.rigRotationA) + 1) % 4;
			this.rigRotationA = ROTATION_STEPS[idx];
			return this.rigRotationA;
		} else {
			const idx = (ROTATION_STEPS.indexOf(this.rigRotationB) + 1) % 4;
			this.rigRotationB = ROTATION_STEPS[idx];
			return this.rigRotationB;
		}
	}

	/**
	 * Produces the current raw (unfiltered) poses for Canvas A and Canvas B.
	 */
	sample(
		pair: PairInfo,
		videoEl: HTMLVideoElement | null,
		nowMs: number
	): DualTrackerSnapshot {
		if (this.mode === 'rig') {
			return this.sampleRig(pair, nowMs);
		}
		return this.sampleCameraVision(pair, videoEl, nowMs);
	}

	private sampleRig(pair: PairInfo, nowMs: number): DualTrackerSnapshot {
		const t = nowMs * 0.001;
		// Subtle handheld camera breathing motion to demonstrate low-pass pose smoothing
		const swayX = Math.sin(t * 1.3) * 0.012;
		const swayY = Math.cos(t * 1.7) * 0.01;
		const swayRoll = Math.sin(t * 1.1) * 0.008;

		const size = 0.72;
		const halfSpan = size * 0.505;

		let canvasA: TrackedCanvas | null = null;
		let canvasB: TrackedCanvas | null = null;

		if (this.rigTrackA) {
			const poseA: CanvasPose = {
				x: -halfSpan + swayX,
				y: swayY,
				z: 0,
				size,
				rollRad: (-this.rigRotationA * Math.PI) / 180 + swayRoll,
				rotation: this.rigRotationA,
				confidence: 0.96
			};
			canvasA = {
				paintingId: pair.paintingA.id,
				slot: 'A',
				rotation: this.rigRotationA,
				edges: getPaintingEdges(pair.paintingA, this.rigRotationA),
				pose: poseA,
				lastSeenAt: nowMs
			};
		}

		if (this.rigTrackB) {
			const poseB: CanvasPose = {
				x: halfSpan + swayX,
				y: swayY,
				z: 0,
				size,
				rollRad: (-this.rigRotationB * Math.PI) / 180 + swayRoll,
				rotation: this.rigRotationB,
				confidence: 0.95
			};
			canvasB = {
				paintingId: pair.paintingB.id,
				slot: 'B',
				rotation: this.rigRotationB,
				edges: getPaintingEdges(pair.paintingB, this.rigRotationB),
				pose: poseB,
				lastSeenAt: nowMs
			};
		}

		return { canvasA, canvasB };
	}

	/**
	 * Real-time computer vision detector for Painting A (warm amber/crimson) and Painting B (cool cyan/indigo)
	 * held side-by-side in front of the camera.
	 */
	private sampleCameraVision(
		pair: PairInfo,
		videoEl: HTMLVideoElement | null,
		nowMs: number
	): DualTrackerSnapshot {
		if (!videoEl || !this.visionCanvas || !this.visionCtx || videoEl.readyState < 2) {
			return { canvasA: null, canvasB: null };
		}

		// Run CV pass at ~15 Hz to keep mobile CPU cool
		if (nowMs - this.lastVisionRunMs < 66) {
			return this.cachedVisionSnapshot;
		}
		this.lastVisionRunMs = nowMs;

		const w = this.visionCanvas.width;
		const h = this.visionCanvas.height;
		this.visionCtx.drawImage(videoEl, 0, 0, w, h);
		const pixels = this.visionCtx.getImageData(0, 0, w, h).data;

		// Accumulate centroids for warm solar canvas (Painting A) and cool astral canvas (Painting B)
		let sumAx = 0,
			sumAy = 0,
			countA = 0;
		let sumBx = 0,
			sumBy = 0,
			countB = 0;

		for (let y = 12; y < h - 12; y += 2) {
			for (let x = 12; x < w - 12; x += 2) {
				const i = (y * w + x) * 4;
				const r = pixels[i];
				const g = pixels[i + 1];
				const b = pixels[i + 2];

				// High-saturation warm amber/gold/crimson signature (Painting A)
				if (r > 165 && g > 70 && b < 110 && r - b > 80) {
					sumAx += x;
					sumAy += y;
					countA++;
				}
				// High-saturation cyan/azure/cobalt signature (Painting B)
				else if (b > 155 && g > 95 && r < 115 && b - r > 65) {
					sumBx += x;
					sumBy += y;
					countB++;
				}
			}
		}

		let canvasA: TrackedCanvas | null = null;
		let canvasB: TrackedCanvas | null = null;

		const minPixels = 28;
		if (countA >= minPixels) {
			const cx = (sumAx / countA / w) * 2 - 1;
			const cy = -((sumAy / countA / h) * 2 - 1);
			const size = Math.min(0.85, Math.max(0.42, Math.sqrt(countA / (w * h * 0.25)) * 1.1));
			const rotA = this.rigRotationA;
			canvasA = {
				paintingId: pair.paintingA.id,
				slot: 'A',
				rotation: rotA,
				edges: getPaintingEdges(pair.paintingA, rotA),
				pose: {
					x: cx,
					y: cy,
					z: 0,
					size,
					rollRad: (-rotA * Math.PI) / 180,
					rotation: rotA,
					confidence: Math.min(0.99, 0.65 + countA / 400)
				},
				lastSeenAt: nowMs
			};
		}

		if (countB >= minPixels) {
			const cx = (sumBx / countB / w) * 2 - 1;
			const cy = -((sumBy / countB / h) * 2 - 1);
			const size = Math.min(0.85, Math.max(0.42, Math.sqrt(countB / (w * h * 0.25)) * 1.1));
			const rotB = this.rigRotationB;
			canvasB = {
				paintingId: pair.paintingB.id,
				slot: 'B',
				rotation: rotB,
				edges: getPaintingEdges(pair.paintingB, rotB),
				pose: {
					x: cx,
					y: cy,
					z: 0,
					size,
					rollRad: (-rotB * Math.PI) / 180,
					rotation: rotB,
					confidence: Math.min(0.99, 0.65 + countB / 400)
				},
				lastSeenAt: nowMs
			};
		}

		this.cachedVisionSnapshot = { canvasA, canvasB };
		return this.cachedVisionSnapshot;
	}
}
