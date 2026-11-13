export type CameraErrorType = 'permission_denied' | 'no_camera' | 'unknown';

export class CameraSetupError extends Error {
	constructor(
		public readonly type: CameraErrorType,
		message: string
	) {
		super(message);
		this.name = 'CameraSetupError';
	}
}

export async function startRearCamera(videoEl: HTMLVideoElement): Promise<MediaStream> {
	if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
		throw new CameraSetupError(
			'no_camera',
			'Camera API is unavailable. Ensure you are visiting over HTTPS.'
		);
	}

	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				facingMode: { ideal: 'environment' },
				width: { ideal: 1280 },
				height: { ideal: 720 }
			}
		});

		videoEl.srcObject = stream;
		videoEl.setAttribute('playsinline', 'true');
		videoEl.muted = true;

		await videoEl.play();
		return stream;
	} catch (err) {
		if (err instanceof DOMException) {
			if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
				throw new CameraSetupError(
					'permission_denied',
					'Camera permission was denied. Please allow camera access in your browser settings.'
				);
			}
			if (
				err.name === 'NotFoundError' ||
				err.name === 'DevicesNotFoundError' ||
				err.name === 'OverconstrainedError'
			) {
				throw new CameraSetupError('no_camera', 'No suitable camera was found on this device.');
			}
		}
		throw new CameraSetupError(
			'unknown',
			err instanceof Error ? err.message : 'Unable to access the camera.'
		);
	}
}

export function stopCameraStream(stream: MediaStream | null, videoEl?: HTMLVideoElement | null): void {
	if (stream) {
		for (const track of stream.getTracks()) {
			track.stop();
		}
	}
	if (videoEl) {
		videoEl.pause();
		videoEl.srcObject = null;
	}
}

export class FrameCapturer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private readonly maxLongSide: number;
	private readonly jpegQuality: number;

	constructor(maxLongSide = 384, jpegQuality = 0.7) {
		this.maxLongSide = maxLongSide;
		this.jpegQuality = jpegQuality;
		this.canvas = document.createElement('canvas');
		const context = this.canvas.getContext('2d', { willReadFrequently: false });
		if (!context) {
			throw new Error('Failed to create 2D canvas context');
		}
		this.ctx = context;
	}

	async captureJpegBlob(videoEl: HTMLVideoElement): Promise<Blob | null> {
		const vw = videoEl.videoWidth;
		const vh = videoEl.videoHeight;

		if (!vw || !vh || videoEl.readyState < 2) {
			return null;
		}

		const scale = this.maxLongSide / Math.max(vw, vh);
		const targetW = Math.max(1, Math.round(vw * scale));
		const targetH = Math.max(1, Math.round(vh * scale));

		if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
			this.canvas.width = targetW;
			this.canvas.height = targetH;
		}

		this.ctx.drawImage(videoEl, 0, 0, targetW, targetH);

		return new Promise<Blob | null>((resolve) => {
			this.canvas.toBlob(
				(blob) => {
					resolve(blob);
				},
				'image/jpeg',
				this.jpegQuality
			);
		});
	}
}
