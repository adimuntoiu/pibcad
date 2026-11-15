export interface ValidationResult {
	valid: boolean;
	error?: string;
}

export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_MODEL_SIZE_MB = 25;
export const MAX_IMAGE_DIMENSION_PX = 2048;
export const THUMBNAIL_MAX_DIMENSION_PX = 400;

export function validateImageFile(file: File, maxMb = MAX_IMAGE_SIZE_MB): ValidationResult {
	const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
	if (!validTypes.includes(file.type)) {
		return {
			valid: false,
			error: `Invalid image type (${file.type || 'unknown'}). Supported formats: JPG, PNG, WebP.`
		};
	}

	const maxBytes = maxMb * 1024 * 1024;
	if (file.size > maxBytes) {
		const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
		return {
			valid: false,
			error: `Image size (${sizeMb} MB) exceeds maximum allowed limit of ${maxMb} MB.`
		};
	}

	return { valid: true };
}

export function validateModelFile(file: File, maxMb = MAX_MODEL_SIZE_MB): ValidationResult {
	const name = file.name.toLowerCase();
	if (!name.endsWith('.glb')) {
		return {
			valid: false,
			error: 'Invalid 3D model format. Only binary glTF (.glb) is supported.'
		};
	}

	const maxBytes = maxMb * 1024 * 1024;
	if (file.size > maxBytes) {
		const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
		return {
			valid: false,
			error: `3D model size (${sizeMb} MB) exceeds maximum allowed limit of ${maxMb} MB.`
		};
	}

	return { valid: true };
}

export function calculateDownscaleDimensions(
	width: number,
	height: number,
	maxSide = MAX_IMAGE_DIMENSION_PX
): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width: 0, height: 0 };
	if (width <= maxSide && height <= maxSide) {
		return { width, height };
	}

	const scale = maxSide / Math.max(width, height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

export async function downscaleImage(
	source: File | Blob,
	maxSide = MAX_IMAGE_DIMENSION_PX,
	quality = 0.85
): Promise<Blob> {
	if (typeof window === 'undefined') {
		return source;
	}

	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(source);

		img.onload = () => {
			URL.revokeObjectURL(url);
			const { width, height } = calculateDownscaleDimensions(img.naturalWidth, img.naturalHeight, maxSide);

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;

			const ctx = canvas.getContext('2d');
			if (!ctx) {
				resolve(source);
				return;
			}

			ctx.drawImage(img, 0, 0, width, height);
			canvas.toBlob(
				(blob) => {
					resolve(blob || source);
				},
				'image/jpeg',
				quality
			);
		};

		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load image for downscaling'));
		};

		img.src = url;
	});
}

export async function createThumbnail(
	source: File | Blob,
	maxSide = THUMBNAIL_MAX_DIMENSION_PX,
	quality = 0.8
): Promise<Blob> {
	return downscaleImage(source, maxSide, quality);
}
