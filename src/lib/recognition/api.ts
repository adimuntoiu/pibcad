import type { DetectionResponse } from '#lib/types';

export class BackendUnreachableError extends Error {
	constructor(message = 'Cannot reach the detection backend.') {
		super(message);
		this.name = 'BackendUnreachableError';
	}
}

export async function detectPainting(blob: Blob, signal?: AbortSignal): Promise<DetectionResponse> {
	const formData = new FormData();
	formData.append('file', blob, 'frame.jpg');

	let response: Response;
	try {
		response = await fetch('/api/recognize', { method: 'POST', body: formData, signal });
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') throw err;
		throw new BackendUnreachableError();
	}

	if (response.status >= 500) {
		throw new BackendUnreachableError('Server error (' + response.status + ')');
	}
	if (!response.ok) {
		throw new Error('Detection request failed with status ' + response.status);
	}
	return (await response.json()) as DetectionResponse;
}
