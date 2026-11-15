import { describe, it, expect } from 'vitest';
import {
	validateImageFile,
	validateModelFile,
	calculateDownscaleDimensions,
	MAX_IMAGE_SIZE_MB,
	MAX_MODEL_SIZE_MB
} from './imageProcessing';

describe('imageProcessing validation', () => {
	it('accepts valid JPEG, PNG, and WebP files under 10MB', () => {
		const jpg = new File(['fake-jpg-content'], 'test.jpg', { type: 'image/jpeg' });
		const png = new File(['fake-png-content'], 'test.png', { type: 'image/png' });
		const webp = new File(['fake-webp-content'], 'test.webp', { type: 'image/webp' });

		expect(validateImageFile(jpg).valid).toBe(true);
		expect(validateImageFile(png).valid).toBe(true);
		expect(validateImageFile(webp).valid).toBe(true);
	});

	it('rejects unsupported image types', () => {
		const pdf = new File(['fake-pdf'], 'document.pdf', { type: 'application/pdf' });
		const res = validateImageFile(pdf);
		expect(res.valid).toBe(false);
		expect(res.error).toContain('Supported formats: JPG, PNG, WebP');
	});

	it('rejects image files exceeding size limit', () => {
		// Mock a large file by overriding size
		const largeFile = new File(['data'], 'huge.jpg', { type: 'image/jpeg' });
		Object.defineProperty(largeFile, 'size', { value: 12 * 1024 * 1024 });

		const res = validateImageFile(largeFile, MAX_IMAGE_SIZE_MB);
		expect(res.valid).toBe(false);
		expect(res.error).toContain('exceeds maximum allowed limit');
	});

	it('accepts .glb model files under 25MB', () => {
		const glb = new File(['glTF binary data'], 'model.glb', { type: 'model/gltf-binary' });
		const res = validateModelFile(glb);
		expect(res.valid).toBe(true);
	});

	it('rejects non-.glb 3D files', () => {
		const obj = new File(['obj content'], 'model.obj', { type: 'text/plain' });
		const res = validateModelFile(obj);
		expect(res.valid).toBe(false);
		expect(res.error).toContain('Only binary glTF (.glb) is supported');
	});

	it('rejects model files exceeding size limit', () => {
		const largeModel = new File(['model data'], 'heavy.glb');
		Object.defineProperty(largeModel, 'size', { value: 30 * 1024 * 1024 });

		const res = validateModelFile(largeModel, MAX_MODEL_SIZE_MB);
		expect(res.valid).toBe(false);
		expect(res.error).toContain('exceeds maximum allowed limit');
	});
});

describe('calculateDownscaleDimensions', () => {
	it('preserves dimensions if already below maxSide', () => {
		const dims = calculateDownscaleDimensions(1200, 800, 2048);
		expect(dims).toEqual({ width: 1200, height: 800 });
	});

	it('scales down landscape images so width equals maxSide', () => {
		const dims = calculateDownscaleDimensions(4096, 2048, 2048);
		expect(dims.width).toBe(2048);
		expect(dims.height).toBe(1024);
	});

	it('scales down portrait images so height equals maxSide', () => {
		const dims = calculateDownscaleDimensions(2000, 4000, 2000);
		expect(dims.width).toBe(1000);
		expect(dims.height).toBe(2000);
	});

	it('handles thumbnail sizing (400px)', () => {
		const dims = calculateDownscaleDimensions(1600, 1200, 400);
		expect(dims.width).toBe(400);
		expect(dims.height).toBe(300);
	});

	it('handles zero or negative dimensions safely', () => {
		expect(calculateDownscaleDimensions(0, 0, 2048)).toEqual({ width: 0, height: 0 });
	});
});
