import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	checkArtistDailyQuota,
	createMeshyTask,
	sanitizeErrorMessage
} from '#lib/server/meshy';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Unauthorized: please log in as an artist.');
	}

	let body: { artworkId?: string; imageUrl?: string; title?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const { artworkId, imageUrl } = body;
	if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
		throw error(400, 'A valid artwork imageUrl is required for 3D model generation.');
	}

	// 1. Quota Check
	const quota = await checkArtistDailyQuota(user.id, locals.supabase);
	if (!quota.allowed) {
		return json(
			{
				error: `Daily 3D generation quota reached (${quota.used}/${quota.limit}). Quota resets at midnight UTC.`,
				quota
			},
			{ status: 429 }
		);
	}

	// 2. Dispatch task to Meshy or simulation
	try {
		const { taskId } = await createMeshyTask(imageUrl, user.id);

		let jobId = taskId;
		// Record in model_jobs table if live Supabase is connected
		if (locals.supabase) {
			try {
				const { data: jobRow } = await locals.supabase
					.from('model_jobs')
					.insert({
						artwork_id: artworkId || null,
						owner_id: user.id,
						provider: 'meshy',
						provider_task_id: taskId,
						status: 'IN_PROGRESS',
						progress: 0
					})
					.select('id')
					.single();

				if (jobRow?.id) {
					jobId = jobRow.id;
				}
			} catch (dbErr) {
				console.warn('Could not record model_job in database:', dbErr);
			}
		}

		return json({
			success: true,
			jobId,
			taskId,
			quota: {
				...quota,
				used: quota.used + 1,
				remaining: Math.max(0, quota.remaining - 1)
			}
		});
	} catch (err: unknown) {
		console.error('Meshy task creation error:', err);
		return json(
			{ error: sanitizeErrorMessage(err) },
			{ status: 500 }
		);
	}
};
