import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	const backendUrl = process.env.BACKEND_URL;
	if (backendUrl) {
		try {
			const res = await fetch(new URL('/api/health', backendUrl));
			if (res.ok) {
				const backendHealth = await res.json();
				return json({
					status: 'ok',
					app: 'ok',
					backend: backendHealth
				});
			}
		} catch (err) {
			console.warn('[api/health] Backend health query failed:', err);
		}
	}

	return json({
		status: 'ok',
		app: 'ok',
		paintings: ['painting-a-solar', 'painting-b-lunar', 'irlo1', 'irlo2']
	});
};
