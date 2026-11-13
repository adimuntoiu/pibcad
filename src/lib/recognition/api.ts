import type { RecognitionResponse } from '#lib/types';

export class BackendUnreachableError extends Error {
	constructor(message = 'Cannot reach recognition backend.') {
		super(message);
		this.name = 'BackendUnreachableError';
	}
}

export async function recognizeFrame(
	blob: Blob,
	signal?: AbortSignal
): Promise<RecognitionResponse> {
	const formData = new FormData();
	formData.append('file', blob, 'frame.jpg');

	let response: Response;
	try {
		response = await fetch('/api/recognize', {
			method: 'POST',
			body: formData,
			signal
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			throw err;
		}
		throw new BackendUnreachableError();
	}

	if (
		response.status >= 500 ||
		response.status === 502 ||
		response.status === 503 ||
		response.status === 504
	) {
		throw new BackendUnreachableError('Server error (' + response.status + ')');
	}

	if (!response.ok) {
		throw new Error('Recognition request failed with status ' + response.status);
	}

	return (await response.json()) as RecognitionResponse;
}
