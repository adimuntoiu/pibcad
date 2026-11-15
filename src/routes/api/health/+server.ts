import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	const candidateUrls = process.env.BACKEND_URL
		? [process.env.BACKEND_URL]
		: ['http://127.0.0.1:8000', 'http://localhost:8000'];

	for (const url of candidateUrls) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 1500);
			const res = await fetch(new URL('/api/health', url), { signal: controller.signal });
			clearTimeout(timeout);
			if (res.ok) {
				const backendHealth = await res.json();
				return json({
					status: 'ok',
					app: 'ok',
					backend: backendHealth
				});
			}
		} catch {
			// ignore and try next
		}
	}

	return json({
		status: 'ok',
		app: 'ok',
		paintings: ['painting-a-solar', 'painting-b-lunar', 'irlo1', 'irlo2']
	});
};
