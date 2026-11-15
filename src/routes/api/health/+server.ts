import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	const candidateUrls = process.env.BACKEND_URL
		? [process.env.BACKEND_URL]
		: ['http://127.0.0.1:8000', 'http://localhost:8000'];

	let lastError: string | null = null;
	for (const url of candidateUrls) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 4000);
			const res = await fetch(new URL('/api/health', url), { signal: controller.signal });
			clearTimeout(timeout);
			if (res.ok) {
				const backendHealth = await res.json();
				return json({
					status: 'ok',
					app: 'ok',
					backend_url: url,
					backend: backendHealth
				});
			} else {
				lastError = `HTTP ${res.status}: ${await res.text()}`;
			}
		} catch (e: unknown) {
			lastError = e instanceof Error ? e.message : String(e);
		}
	}

	return json({
		status: 'degraded',
		app: 'ok',
		backend_url: process.env.BACKEND_URL || null,
		backend_error: lastError,
		paintings: ['painting-a-solar', 'painting-b-lunar', 'irlo1', 'irlo2']
	});
};
