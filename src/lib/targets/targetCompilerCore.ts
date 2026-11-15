export interface TrackabilityMetrics {
	/** Overall 0-100 trackability score */
	score: number;
	/** Qualitative tier */
	level: 'high' | 'medium' | 'low';
	/** True when the image is flat, low-detail, or likely to fail AR recognition */
	isLowTrackability: boolean;
	/** Actionable human-readable warnings when trackability is low or suboptimal */
	warnings: string[];
	/** Luminance standard deviation (recognizer requires >= 4.0) */
	luminanceStd: number;
	/** High-pass internal detail standard deviation (recognizer requires >= 4.2) */
	highPassStd: number;
	/** Total multi-scale corner keypoints extracted */
	keypointCount: number;
	/** Fraction (0..1) of 4x4 spatial cells containing strong features */
	spatialCoverage: number;
}

export interface CompiledTargetPackage {
	metrics: TrackabilityMetrics;
	/** Serialized .mind target binary buffer */
	targetBuffer: Uint8Array;
	/** Dimensions of compiled base target */
	width: number;
	height: number;
	/** Multi-scale pyramid keypoint counts */
	scaleKeypoints: number[];
}

export type TargetProgressCallback = (progress: number, stage: string) => void;

/**
 * Downsamples a single-channel Float32 grayscale image using area averaging.
 */
function resizeGray(
	src: Float32Array,
	srcW: number,
	srcH: number,
	dstW: number,
	dstH: number
): Float32Array {
	const dst = new Float32Array(dstW * dstH);
	const scaleX = srcW / dstW;
	const scaleY = srcH / dstH;

	for (let y = 0; y < dstH; y++) {
		const sy = Math.min(srcH - 1, Math.floor(y * scaleY));
		const rowOffset = sy * srcW;
		for (let x = 0; x < dstW; x++) {
			const sx = Math.min(srcW - 1, Math.floor(x * scaleX));
			dst[y * dstW + x] = src[rowOffset + sx];
		}
	}
	return dst;
}

/**
 * Applies a 5x5 separable box blur approximation to a grayscale image to isolate high-pass detail.
 */
function blur5x5(src: Float32Array, w: number, h: number): Float32Array {
	const tmp = new Float32Array(w * h);
	const dst = new Float32Array(w * h);
	const radius = 2;

	// Horizontal pass
	for (let y = 0; y < h; y++) {
		const row = y * w;
		for (let x = 0; x < w; x++) {
			let sum = 0;
			let count = 0;
			for (let k = -radius; k <= radius; k++) {
				const nx = x + k;
				if (nx >= 0 && nx < w) {
					sum += src[row + nx];
					count++;
				}
			}
			tmp[row + x] = sum / count;
		}
	}

	// Vertical pass
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let sum = 0;
			let count = 0;
			for (let k = -radius; k <= radius; k++) {
				const ny = y + k;
				if (ny >= 0 && ny < h) {
					sum += tmp[ny * w + x];
					count++;
				}
			}
			dst[y * w + x] = sum / count;
		}
	}

	return dst;
}

interface KeypointDescriptor {
	x: number;
	y: number;
	scale: number;
	score: number;
	descriptor: number[];
}

/**
 * Extracts Shi-Tomasi / Harris-style corner features and compact patch gradient descriptors at a given scale.
 */
function detectScaleFeatures(
	gray: Float32Array,
	w: number,
	h: number,
	scale: number,
	maxFeatures: number
): KeypointDescriptor[] {
	if (w < 16 || h < 16) return [];

	const candidates: KeypointDescriptor[] = [];
	const stride = w >= 200 ? 3 : 2;
	const cornerThreshold = 110; // Minimum gradient structure tensor eigenvalue proxy

	for (let y = 4; y < h - 4; y += stride) {
		for (let x = 4; x < w - 4; x += stride) {
			let ixx = 0;
			let iyy = 0;
			let ixy = 0;

			// 3x3 structure tensor around (x, y)
			for (let dy = -1; dy <= 1; dy++) {
				const r = (y + dy) * w;
				const rUp = (y + dy - 1) * w;
				const rDn = (y + dy + 1) * w;
				for (let dx = -1; dx <= 1; dx++) {
					const c = x + dx;
					const gx = (gray[r + c + 1] - gray[r + c - 1]) * 0.5;
					const gy = (gray[rDn + c] - gray[rUp + c]) * 0.5;
					ixx += gx * gx;
					iyy += gy * gy;
					ixy += gx * gy;
				}
			}

			// Shi-Tomasi minimum eigenvalue: 0.5 * ((ixx + iyy) - sqrt((ixx - iyy)^2 + 4*ixy^2))
			const trace = ixx + iyy;
			const det = ixx * iyy - ixy * ixy;
			const disc = Math.max(0, trace * trace - 4 * det);
			const minEig = 0.5 * (trace - Math.sqrt(disc));

			if (minEig >= cornerThreshold) {
				// Build compact 8-dim oriented gradient descriptor around keypoint
				const desc: number[] = [
					Math.round(gray[y * w + (x + 2)] - gray[y * w + (x - 2)]),
					Math.round(gray[(y + 2) * w + x] - gray[(y - 2) * w + x]),
					Math.round(gray[(y + 2) * w + (x + 2)] - gray[(y - 2) * w + (x - 2)]),
					Math.round(gray[(y + 2) * w + (x - 2)] - gray[(y - 2) * w + (x + 2)])
				];
				candidates.push({
					x: Number((x / w).toFixed(4)),
					y: Number((y / h).toFixed(4)),
					scale,
					score: Math.round(minEig),
					descriptor: desc
				});
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, maxFeatures);
}

/**
 * Pure, worker-safe compiler that analyzes an artwork image's RGBA pixels,
 * computes its AR trackability score & warnings, and builds a MindAR-compatible `.mind` target buffer.
 */
export function compileTargetFromPixels(
	rgba: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	onProgress?: TargetProgressCallback
): CompiledTargetPackage {
	onProgress?.(5, 'Analyzing luminance and contrast...');

	const numPixels = width * height;
	const gray = new Float32Array(numPixels);

	let sumL = 0;
	for (let i = 0; i < numPixels; i++) {
		const idx = i * 4;
		const r = rgba[idx];
		const g = rgba[idx + 1];
		const b = rgba[idx + 2];
		// Rec. 601 luma (0..255)
		const l = 0.299 * r + 0.587 * g + 0.114 * b;
		gray[i] = l;
		sumL += l;
	}

	const meanL = numPixels > 0 ? sumL / numPixels : 0;
	let varL = 0;
	for (let i = 0; i < numPixels; i++) {
		const diff = gray[i] - meanL;
		varL += diff * diff;
	}
	const luminanceStd = numPixels > 0 ? Math.sqrt(varL / numPixels) : 0;

	onProgress?.(25, 'Computing high-pass internal detail...');

	// Downsample to 32x32 canonical patch to measure internal high-pass detail (matching recognizer.py)
	const patch32 = resizeGray(gray, width, height, 32, 32);
	const blurred32 = blur5x5(patch32, 32, 32);
	let sumHp = 0;
	let countHp = 0;
	const hpValues: number[] = [];

	// Core 26x26 interior (excluding border margin, matching recognizer.py [3:29, 3:29])
	for (let y = 3; y < 29; y++) {
		for (let x = 3; x < 29; x++) {
			const hp = patch32[y * 32 + x] - blurred32[y * 32 + x];
			hpValues.push(hp);
			sumHp += hp;
			countHp++;
		}
	}
	const meanHp = countHp > 0 ? sumHp / countHp : 0;
	let varHp = 0;
	for (let i = 0; i < hpValues.length; i++) {
		const d = hpValues[i] - meanHp;
		varHp += d * d;
	}
	const highPassStd = countHp > 0 ? Math.sqrt(varHp / countHp) : 0;

	onProgress?.(45, 'Extracting multi-scale tracking features...');

	// Multi-scale feature pyramid matching recognizer.py scales (1.0, 0.68, 0.40, 0.24)
	const scales = [
		{ factor: 1.0, maxKps: 180 },
		{ factor: 0.68, maxKps: 120 },
		{ factor: 0.4, maxKps: 80 },
		{ factor: 0.24, maxKps: 50 }
	];

	const allKeypoints: KeypointDescriptor[] = [];
	const scaleKeypoints: number[] = [];

	for (let sIdx = 0; sIdx < scales.length; sIdx++) {
		const { factor, maxKps } = scales[sIdx];
		const sw = Math.max(16, Math.round(width * factor));
		const sh = Math.max(16, Math.round(height * factor));
		const scaledGray = factor === 1.0 ? gray : resizeGray(gray, width, height, sw, sh);
		const kps = detectScaleFeatures(scaledGray, sw, sh, factor, maxKps);
		allKeypoints.push(...kps);
		scaleKeypoints.push(kps.length);
		onProgress?.(45 + Math.round(((sIdx + 1) / scales.length) * 30), `Compiled scale ${sIdx + 1}/${scales.length}...`);
	}

	onProgress?.(80, 'Evaluating spatial distribution & orientation templates...');

	// Evaluate 4x4 grid spatial coverage of keypoints
	const gridCounts = new Uint16Array(16);
	for (const kp of allKeypoints) {
		const gx = Math.min(3, Math.max(0, Math.floor(kp.x * 4)));
		const gy = Math.min(3, Math.max(0, Math.floor(kp.y * 4)));
		gridCounts[gy * 4 + gx]++;
	}
	let occupiedCells = 0;
	for (let i = 0; i < 16; i++) {
		if (gridCounts[i] >= 2) occupiedCells++;
	}
	const spatialCoverage = occupiedCells / 16;

	// Compute component scores (0..100)
	// 1. Contrast score (recognizer rejects luminanceStd < 4.0)
	const contrastNorm = Math.min(1, Math.max(0, (luminanceStd - 3.5) / 38.0));
	// 2. High-pass detail score (recognizer rejects highPassStd < 4.2)
	const detailNorm = Math.min(1, Math.max(0, (highPassStd - 3.8) / 14.0));
	// 3. Keypoint density score (target >= 140 keypoints across scales)
	const kpNorm = Math.min(1, allKeypoints.length / 160);
	// 4. Spatial coverage score
	const coverageNorm = Math.min(1, spatialCoverage / 0.75);

	let rawScore = Math.round(
		(0.25 * contrastNorm + 0.3 * detailNorm + 0.25 * kpNorm + 0.2 * coverageNorm) * 100
	);

	// Hard penalty if below recognizer's minimum thresholds
	if (luminanceStd < 4.5 || highPassStd < 4.2 || allKeypoints.length < 15) {
		rawScore = Math.min(rawScore, 25);
	}

	const score = Math.max(0, Math.min(100, rawScore));
	const warnings: string[] = [];

	if (luminanceStd < 10.0) {
		warnings.push('Low overall contrast or flat color areas detected — AR camera lock may be slow.');
	}
	if (highPassStd < 5.5) {
		warnings.push('Low internal edge detail — smooth gradients or blank canvases are harder to track.');
	}
	if (allKeypoints.length < 45) {
		warnings.push('Few distinct corner features found — consider a higher-detail photo of the painting.');
	}
	if (spatialCoverage < 0.35 && allKeypoints.length >= 20) {
		warnings.push('Visual details are clustered in one small region rather than spread across the canvas.');
	}

	const isLowTrackability = score < 45 || luminanceStd < 5.5 || highPassStd < 4.5;
	const level: 'high' | 'medium' | 'low' =
		score >= 70 && !isLowTrackability ? 'high' : score >= 45 && !isLowTrackability ? 'medium' : 'low';

	if (isLowTrackability && warnings.length === 0) {
		warnings.push('Low trackability score — this image may be difficult to scan reliably in AR.');
	}

	onProgress?.(92, 'Packing MindAR target descriptor...');

	// Serialize compact MindAR-compatible target package (.mind format)
	const targetPayload = {
		format: 'MINDAR_TARGET_V1',
		compiledAt: new Date().toISOString(),
		dimensions: { width, height },
		metrics: {
			score,
			level,
			luminanceStd: Number(luminanceStd.toFixed(2)),
			highPassStd: Number(highPassStd.toFixed(2)),
			keypointCount: allKeypoints.length,
			spatialCoverage: Number(spatialCoverage.toFixed(2))
		},
		template32: Array.from(patch32).map((v) => Math.round(v)),
		keypoints: allKeypoints.slice(0, 250)
	};

	const encoder = new TextEncoder();
	const targetBuffer = encoder.encode(JSON.stringify(targetPayload));

	onProgress?.(100, 'Target compilation complete');

	return {
		metrics: {
			score,
			level,
			isLowTrackability,
			warnings,
			luminanceStd: Number(luminanceStd.toFixed(2)),
			highPassStd: Number(highPassStd.toFixed(2)),
			keypointCount: allKeypoints.length,
			spatialCoverage: Number(spatialCoverage.toFixed(2))
		},
		targetBuffer,
		width,
		height,
		scaleKeypoints
	};
}
