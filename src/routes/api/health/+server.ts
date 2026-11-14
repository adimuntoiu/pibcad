import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	return json({
		status: 'ok',
		paintings: ['painting-a-solar', 'painting-b-lunar']
	});
};
