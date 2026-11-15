import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getMeshyTaskStatus,
	persistModelToStorage,
	sanitizeErrorMessage
} from '#lib/server/meshy';

export const GET: RequestHandler = async ({ params, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Unauthorized: please log in.');
	}

	const { jobId } = params;
	if (!jobId) {
		throw error(400, 'Missing jobId parameter.');
	}

	let taskId = jobId;
	// Look up provider_task_id in database if applicable
	if (locals.supabase) {
		try {
			const { data: jobRow } = await locals.supabase
				.from('model_jobs')
				.select('provider_task_id, owner_id')
				.eq('id', jobId)
				.single();

			if (jobRow) {
				if (jobRow.owner_id !== user.id) {
					throw error(403, 'Forbidden: you do not own this generation task.');
				}
				if (jobRow.provider_task_id) {
					taskId = jobRow.provider_task_id;
				}
			}
		} catch (err) {
			// If not a DB UUID, taskId is already jobId
		}
	}

	try {
		const taskStatus = await getMeshyTaskStatus(taskId);

		if (taskStatus.status === 'SUCCEEDED' && taskStatus.modelUrls?.glb) {
			// Download GLB to Supabase Storage before Meshy CDN URL expires
			let modelUrl = taskStatus.modelUrls.glb;
			let posterUrl = taskStatus.thumbnailUrl;

			try {
				const stored = await persistModelToStorage(
					user.id,
					jobId,
					taskStatus.modelUrls.glb,
					locals.supabase
				);
				modelUrl = stored.modelPath;
				if (stored.posterPath) {
					posterUrl = stored.posterPath;
				}
			} catch (storageErr) {
				console.warn('Storage persistence warning (falling back to direct url):', storageErr);
			}

			// Update DB record
			if (locals.supabase) {
				try {
					await locals.supabase
						.from('model_jobs')
						.update({
							status: 'SUCCEEDED',
							progress: 100,
							finished_at: new Date().toISOString()
						})
						.eq('id', jobId);
				} catch {
					// ignore
				}
			}

			return json({
				status: 'SUCCEEDED',
				progress: 100,
				modelUrl,
				posterUrl: posterUrl || '/brand/purple-waves.webp'
			});
		}

		if (taskStatus.status === 'FAILED' || taskStatus.status === 'EXPIRED') {
			const errMessage = taskStatus.error
				? sanitizeErrorMessage(taskStatus.error)
				: 'Meshy generation failed or timed out.';

			if (locals.supabase) {
				try {
					await locals.supabase
						.from('model_jobs')
						.update({
							status: 'FAILED',
							error: errMessage,
							finished_at: new Date().toISOString()
						})
						.eq('id', jobId);
				} catch {
					// ignore
				}
			}

			return json({
				status: taskStatus.status,
				progress: taskStatus.progress,
				error: errMessage
			});
		}

		// Update ongoing progress in DB
		if (locals.supabase && taskStatus.progress > 0) {
			try {
				await locals.supabase
					.from('model_jobs')
					.update({
						status: 'IN_PROGRESS',
						progress: taskStatus.progress
					})
					.eq('id', jobId);
			} catch {
				// ignore
			}
		}

		return json({
			status: taskStatus.status,
			progress: taskStatus.progress
		});
	} catch (err: unknown) {
		console.error('Meshy status poll error:', err);
		return json(
			{
				status: 'FAILED',
				progress: 0,
				error: sanitizeErrorMessage(err)
			},
			{ status: 500 }
		);
	}
};
