import { getSupabaseBrowserClient } from '#lib/supabase/client';

export interface MeshyTaskResponse {
	id: string;
	status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
	progress: number;
	modelUrls?: {
		glb?: string;
		fbx?: string;
		obj?: string;
		usdz?: string;
	};
	thumbnailUrl?: string;
	error?: string;
}

export interface QuotaCheckResult {
	allowed: boolean;
	used: number;
	limit: number;
	remaining: number;
	resetAt: string;
}

// In-memory simulation store for local demo/testing when live key is absent
interface SimulatedJob {
	id: string;
	ownerId: string;
	createdAt: number;
	progress: number;
	status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
	glbUrl: string;
	posterUrl: string;
}

const simulatedJobs = new Map<string, SimulatedJob>();

export function getMeshyApiKey(): string | undefined {
	return process.env.MESHY_API_KEY;
}

export function isSimulationMode(): boolean {
	const key = getMeshyApiKey();
	return !key || key.includes('placeholder') || key === 'your-meshy-api-key' || key.trim() === '';
}

/**
 * Strips secrets, URLs, and stack traces from error messages before showing them to artists.
 */
export function sanitizeErrorMessage(err: unknown): string {
	if (!err) return '3D model generation failed. Please try again.';
	let msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);

	// Strip authorization tokens, API keys, and sensitive URLs
	msg = msg.replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
	msg = msg.replace(/msy_[a-zA-Z0-9_\-]+/gi, '[REDACTED_KEY]');
	msg = msg.replace(/https?:\/\/[^\s]+/gi, '[URL]');

	if (msg.includes('401') || msg.includes('Unauthorized')) {
		return '3D generation service configuration error. Please contact the administrator.';
	}
	if (msg.includes('402') || msg.includes('Payment Required') || msg.includes('credit')) {
		return '3D generation credit limit reached. Please contact support or try tomorrow.';
	}
	if (msg.includes('429') || msg.includes('Too Many Requests')) {
		return 'Rate limit exceeded. Please wait a moment before trying again.';
	}
	if (msg.includes('timeout') || msg.includes('ECONNRESET')) {
		return 'Network request timed out. Please retry.';
	}

	return msg.length > 150 ? msg.slice(0, 150) + '...' : msg;
}

/**
 * Checks and enforces daily generation quota per artist.
 */
export async function checkArtistDailyQuota(
	ownerId: string,
	supabaseClient?: any
): Promise<QuotaCheckResult> {
	const defaultLimit = parseInt(process.env.MESHY_DAILY_QUOTA || '10', 10);
	const startOfDay = new Date();
	startOfDay.setUTCHours(0, 0, 0, 0);

	const resetAt = new Date(startOfDay.getTime() + 86400000).toISOString();

	if (!supabaseClient || isSimulationMode()) {
		// Count simulated jobs today for this owner
		let countToday = 0;
		const todayTs = startOfDay.getTime();
		for (const job of simulatedJobs.values()) {
			if (job.ownerId === ownerId && job.createdAt >= todayTs) {
				countToday++;
			}
		}
		const remaining = Math.max(0, defaultLimit - countToday);
		return {
			allowed: countToday < defaultLimit,
			used: countToday,
			limit: defaultLimit,
			remaining,
			resetAt
		};
	}

	// Live database quota check
	try {
		// Fetch artist quota limit from profiles
		const { data: profile } = await supabaseClient
			.from('profiles')
			.select('meshy_daily_quota')
			.eq('id', ownerId)
			.single();

		const limit = profile?.meshy_daily_quota ?? defaultLimit;

		// Count jobs created today by this artist
		const { count, error } = await supabaseClient
			.from('model_jobs')
			.select('id', { count: 'exact', head: true })
			.eq('owner_id', ownerId)
			.gte('created_at', startOfDay.toISOString());

		if (error) {
			console.warn('Quota check DB error, falling back to permissive:', error.message);
			return { allowed: true, used: 0, limit, remaining: limit, resetAt };
		}

		const used = count || 0;
		return {
			allowed: used < limit,
			used,
			limit,
			remaining: Math.max(0, limit - used),
			resetAt
		};
	} catch (err) {
		console.warn('Quota check error:', err);
		return { allowed: true, used: 0, limit: defaultLimit, remaining: defaultLimit, resetAt };
	}
}

/**
 * Dispatches an Image-to-3D task to Meshy v2 or runs simulated generation.
 */
export async function createMeshyTask(
	imageUrl: string,
	ownerId: string
): Promise<{ taskId: string; simulated: boolean }> {
	if (isSimulationMode()) {
		const taskId = `sim-meshy-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		simulatedJobs.set(taskId, {
			id: taskId,
			ownerId,
			createdAt: Date.now(),
			progress: 0,
			status: 'IN_PROGRESS',
			glbUrl: '/demo/models/default.glb',
			posterUrl: '/brand/purple-waves.webp'
		});
		return { taskId, simulated: true };
	}

	const apiKey = getMeshyApiKey();
	const response = await fetch('https://api.meshy.ai/v2/image-to-3d', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			image_url: imageUrl,
			enable_pbr: true,
			surface_mode: 'hard',
			topology: 'triangle',
			target_polycount: 25000,
			should_remesh: true
		})
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Meshy API request failed (${response.status}): ${sanitizeErrorMessage(errText)}`);
	}

	const data = (await response.json()) as { result?: string };
	if (!data.result) {
		throw new Error('Meshy response did not contain a valid task ID.');
	}

	return { taskId: data.result, simulated: false };
}

/**
 * Polls status for a Meshy task.
 */
export async function getMeshyTaskStatus(taskId: string): Promise<MeshyTaskResponse> {
	if (isSimulationMode() || taskId.startsWith('sim-meshy-')) {
		const job = simulatedJobs.get(taskId);
		if (!job) {
			return {
				id: taskId,
				status: 'FAILED',
				progress: 0,
				error: 'Task not found in simulation store.'
			};
		}

		// Progress simulation: reaches 100% after ~5 seconds of polling
		const elapsedSeconds = (Date.now() - job.createdAt) / 1000;
		if (elapsedSeconds < 2) {
			job.progress = 25;
			job.status = 'IN_PROGRESS';
		} else if (elapsedSeconds < 4) {
			job.progress = 65;
			job.status = 'IN_PROGRESS';
		} else {
			job.progress = 100;
			job.status = 'SUCCEEDED';
		}

		return {
			id: taskId,
			status: job.status,
			progress: job.progress,
			modelUrls: { glb: job.glbUrl },
			thumbnailUrl: job.posterUrl
		};
	}

	const apiKey = getMeshyApiKey();
	const response = await fetch(`https://api.meshy.ai/v2/image-to-3d/${taskId}`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${apiKey}`
		}
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Failed to query Meshy status: ${sanitizeErrorMessage(errText)}`);
	}

	const data = (await response.json()) as any;
	return {
		id: taskId,
		status: data.status,
		progress: typeof data.progress === 'number' ? data.progress : data.status === 'SUCCEEDED' ? 100 : 0,
		modelUrls: data.model_urls,
		thumbnailUrl: data.thumbnail_url,
		error: data.task_error?.message ? sanitizeErrorMessage(data.task_error.message) : undefined
	};
}

/**
 * Downloads the GLB from Meshy's temporary CDN URL and saves it permanently to Supabase Storage.
 */
export async function persistModelToStorage(
	ownerId: string,
	jobId: string,
	meshyGlbUrl: string,
	supabaseClient?: any
): Promise<{ modelPath: string; posterPath?: string }> {
	if (isSimulationMode() || !supabaseClient) {
		// In demo mode, use the bundled GLB
		return {
			modelPath: '/demo/models/default.glb',
			posterPath: '/brand/purple-waves.webp'
		};
	}

	// 1. Download the GLB binary
	const glbRes = await fetch(meshyGlbUrl);
	if (!glbRes.ok) {
		throw new Error(`Failed to download GLB asset from upstream provider (${glbRes.status}).`);
	}
	const glbBuffer = await glbRes.arrayBuffer();

	// 2. Upload to Supabase Storage: models/{ownerId}/meshy_{jobId}.glb
	const storagePath = `${ownerId}/meshy_${jobId}.glb`;
	const { data: uploadData, error: uploadErr } = await supabaseClient.storage
		.from('models')
		.upload(storagePath, glbBuffer, {
			contentType: 'model/gltf-binary',
			upsert: true
		});

	if (uploadErr) {
		throw new Error(`Failed to store 3D model asset: ${uploadErr.message}`);
	}

	const { data: pubUrl } = supabaseClient.storage.from('models').getPublicUrl(uploadData.path);
	return {
		modelPath: pubUrl.publicUrl
	};
}
