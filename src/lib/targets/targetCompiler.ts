import {
	compileTargetFromPixels,
	type CompiledTargetPackage,
	type TargetProgressCallback,
	type TrackabilityMetrics
} from './targetCompilerCore';
import type { WorkerResponseMessage } from './targetCompiler.worker';

export { compileTargetFromPixels, type CompiledTargetPackage, type TargetProgressCallback, type TrackabilityMetrics };

export interface CompiledArtworkTarget {
	/** Compiled .mind target file Blob ready for storage upload to `targets` bucket */
	targetBlob: Blob;
	/** Trackability score (0-100), warning messages, and feature breakdown */
	metrics: TrackabilityMetrics;
	/** Compact JPEG data URL (max 640px) for instant backend recognition indexing / offline fallback */
	recognitionDataUrl: string;
}

/**
 * Decodes an image File/Blob onto an offscreen canvas (capped at `maxSide` px)
 * and extracts its RGBA pixel buffer + compact JPEG data URL.
 */
async function extractImagePixels(
	blob: Blob,
	maxSide = 480
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number; dataUrl: string }> {
	if (typeof document === 'undefined' || typeof Image === 'undefined') {
		throw new Error('Browser DOM required to decode image Blob');
	}

	const objectUrl = URL.createObjectURL(blob);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('Failed to decode artwork image for target compilation'));
			el.src = objectUrl;
		});

		const srcW = img.naturalWidth || img.width || 320;
		const srcH = img.naturalHeight || img.height || 320;
		const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
		const width = Math.max(32, Math.round(srcW * scale));
		const height = Math.max(32, Math.round(srcH * scale));

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D canvas context unavailable');

		ctx.drawImage(img, 0, 0, width, height);
		const imageData = ctx.getImageData(0, 0, width, height);
		const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

		return {
			rgba: imageData.data,
			width,
			height,
			dataUrl
		};
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/**
 * Compiles a MindAR tracking target (.mind) and computes trackability metrics from an artwork image.
 * Runs inside a dedicated Web Worker when available so the UI stays responsive, with a seamless
 * main-thread fallback.
 */
export async function compileArtworkTarget(
	fileOrBlob: Blob | File,
	onProgress?: TargetProgressCallback
): Promise<CompiledArtworkTarget> {
	onProgress?.(2, 'Decoding artwork image...');
	const { rgba, width, height, dataUrl } = await extractImagePixels(fileOrBlob, 480);

	if (typeof Worker !== 'undefined') {
		try {
			const pkg = await new Promise<{
				metrics: TrackabilityMetrics;
				targetBuffer: ArrayBuffer;
			}>((resolve, reject) => {
				const worker = new Worker(new URL('./targetCompiler.worker.ts', import.meta.url), {
					type: 'module'
				});

				const cleanup = () => {
					worker.terminate();
				};

				worker.onmessage = (ev: MessageEvent<WorkerResponseMessage>) => {
					const msg = ev.data;
					if (!msg) return;
					if (msg.type === 'progress') {
						onProgress?.(msg.progress, msg.stage);
					} else if (msg.type === 'complete') {
						cleanup();
						resolve({
							metrics: msg.metrics,
							targetBuffer: msg.targetBuffer
						});
					} else if (msg.type === 'error') {
						cleanup();
						reject(new Error(msg.message));
					}
				};

				worker.onerror = (err) => {
					cleanup();
					reject(err);
				};

				// Copy buffer so we can transfer ownership to worker safely
				const copy = new Uint8ClampedArray(rgba).buffer;
				worker.postMessage(
					{
						type: 'compile',
						rgbaBuffer: copy,
						width,
						height
					},
					[copy]
				);
			});

			return {
				targetBlob: new Blob([pkg.targetBuffer], { type: 'application/octet-stream' }),
				metrics: pkg.metrics,
				recognitionDataUrl: dataUrl
			};
		} catch (workerErr) {
			console.warn('Web Worker target compilation fallback to main thread:', workerErr);
		}
	}

	// Fallback: run directly on current thread
	const result = compileTargetFromPixels(rgba, width, height, onProgress);
	const outBuf = result.targetBuffer.buffer.slice(
		result.targetBuffer.byteOffset,
		result.targetBuffer.byteOffset + result.targetBuffer.byteLength
	) as ArrayBuffer;

	return {
		targetBlob: new Blob([outBuf], { type: 'application/octet-stream' }),
		metrics: result.metrics,
		recognitionDataUrl: dataUrl
	};
}
