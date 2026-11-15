import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	checkArtistDailyQuota,
	createMeshyTask,
	sanitizeErrorMessage
} from '#lib/server/meshy';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Unauthorized: please log in.');
	}

	let body: {
		action: 'accept' | 'discard' | 'regenerate';
		jobId: string;
		artworkId?: string;
		imageUrl?: string;
		modelUrl?: string;
		posterUrl?: string;
		retryCount?: number;
	};

	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const { action, jobId, artworkId, imageUrl, modelUrl, posterUrl, retryCount = 0 } = body;

	if (!action || !jobId) {
		throw error(400, 'Missing required action or jobId.');
	}

	if (action === 'accept') {
		if (artworkId && modelUrl && locals.supabase) {
			try {
				await locals.supabase
					.from('artworks')
					.update({
						model_path: modelUrl,
						model_poster_path: posterUrl || null,
						model_source: 'meshy'
					})
					.eq('id', artworkId)
					.eq('owner_id', user.id);
			} catch (dbErr) {
				console.warn('Could not update artwork in DB:', dbErr);
			}
		}

		return json({
			success: true,
			action: 'accepted',
			modelUrl,
			posterUrl
		});
	}

	if (action === 'discard') {
		return json({
			success: true,
			action: 'discarded'
		});
	}

	if (action === 'regenerate') {
		const MAX_RETRIES = 3;
		if (retryCount >= MAX_RETRIES) {
			return json(
				{
					error: `Regeneration limit reached (${MAX_RETRIES} attempts). You can keep this model or upload a custom .glb.`
				},
				{ status: 400 }
			);
		}

		if (!imageUrl) {
			throw error(400, 'Artwork imageUrl is required to regenerate model.');
		}

		// Quota check
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

		try {
			const { taskId } = await createMeshyTask(imageUrl, user.id);
			let newJobId = taskId;

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
						newJobId = jobRow.id;
					}
				} catch (dbErr) {
					console.warn('DB record error on regenerate:', dbErr);
				}
			}

			return json({
				success: true,
				action: 'regenerating',
				jobId: newJobId,
				taskId,
				retryCount: retryCount + 1,
				quota: {
					...quota,
					used: quota.used + 1,
					remaining: Math.max(0, quota.remaining - 1)
				}
			});
		} catch (err: unknown) {
			return json({ error: sanitizeErrorMessage(err) }, { status: 500 });
		}
	}

	throw error(400, `Unknown action "${action}".`);
};
