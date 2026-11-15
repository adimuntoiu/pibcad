import { describe, it, expect, vi } from 'vitest';
import { stopCameraStream, CameraSetupError } from './camera';

describe('stopCameraStream', () => {
	it('stops all tracks in the MediaStream and clears video element', () => {
		const stopTrack1 = vi.fn();
		const stopTrack2 = vi.fn();

		const fakeStream = {
			getTracks: () => [
				{ stop: stopTrack1, kind: 'video' },
				{ stop: stopTrack2, kind: 'audio' }
			]
		} as unknown as MediaStream;

		const fakeVideoEl = {
			pause: vi.fn(),
			srcObject: fakeStream
		} as unknown as HTMLVideoElement;

		stopCameraStream(fakeStream, fakeVideoEl);

		expect(stopTrack1).toHaveBeenCalledTimes(1);
		expect(stopTrack2).toHaveBeenCalledTimes(1);
		expect(fakeVideoEl.pause).toHaveBeenCalledTimes(1);
		expect(fakeVideoEl.srcObject).toBeNull();
	});

	it('handles null stream or null video gracefully without errors', () => {
		expect(() => stopCameraStream(null, null)).not.toThrow();

		const fakeVideoEl = {
			pause: vi.fn(),
			srcObject: null
		} as unknown as HTMLVideoElement;

		expect(() => stopCameraStream(null, fakeVideoEl)).not.toThrow();
		expect(fakeVideoEl.pause).toHaveBeenCalledTimes(1);
	});
});

describe('CameraSetupError', () => {
	it('correctly constructs with type and message', () => {
		const err = new CameraSetupError('permission_denied', 'Camera permission was denied.');
		expect(err.type).toBe('permission_denied');
		expect(err.message).toBe('Camera permission was denied.');
		expect(err.name).toBe('CameraSetupError');
	});
});
