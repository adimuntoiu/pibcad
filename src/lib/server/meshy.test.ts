import { describe, it, expect, beforeEach } from 'vitest';
import {
	sanitizeErrorMessage,
	checkArtistDailyQuota,
	createMeshyTask,
	getMeshyTaskStatus,
	isSimulationMode
} from './meshy';

describe('Meshy Server-Side Service', () => {
	it('sanitizes raw errors and strips API tokens and sensitive endpoints', () => {
		const rawTokenError = 'Error: Bearer msy_secret_abc123456 failed at https://api.meshy.ai/v2/image-to-3d';
		const sanitized = sanitizeErrorMessage(rawTokenError);

		expect(sanitized).not.toContain('msy_secret_abc123456');
		expect(sanitized).not.toContain('https://api.meshy.ai');
		expect(sanitized).toContain('[REDACTED]');
		expect(sanitized).toContain('[URL]');
	});

	it('maps HTTP 401/402/429 and timeout errors to friendly artist messages', () => {
		expect(sanitizeErrorMessage('401 Unauthorized')).toContain('configuration error');
		expect(sanitizeErrorMessage('402 Payment Required credit exhausted')).toContain('credit limit reached');
		expect(sanitizeErrorMessage('429 Too Many Requests')).toContain('Rate limit exceeded');
		expect(sanitizeErrorMessage('Connection timeout ECONNRESET')).toContain('timed out');
	});

	it('detects simulation mode when key is placeholder or unset', () => {
		expect(isSimulationMode()).toBe(true);
	});

	it('enforces daily artist generation quota', async () => {
		const ownerId = `test-artist-${Date.now()}`;

		// Initial check
		const initial = await checkArtistDailyQuota(ownerId);
		expect(initial.allowed).toBe(true);
		expect(initial.remaining).toBe(initial.limit);
		expect(initial.used).toBe(0);

		// Consume quota in simulation mode
		for (let i = 0; i < initial.limit; i++) {
			await createMeshyTask('/demo/irlo1.jpg', ownerId);
		}

		// Quota should now be exhausted
		const exhausted = await checkArtistDailyQuota(ownerId);
		expect(exhausted.allowed).toBe(false);
		expect(exhausted.remaining).toBe(0);
		expect(exhausted.used).toBe(initial.limit);
	});

	it('creates a simulated task and progresses cleanly to SUCCEEDED', async () => {
		const ownerId = `artist-pipeline-${Date.now()}`;
		const { taskId, simulated } = await createMeshyTask('/demo/irlo1.jpg', ownerId);

		expect(simulated).toBe(true);
		expect(taskId).toMatch(/^sim-meshy-/);

		// Initial status
		const initialStatus = await getMeshyTaskStatus(taskId);
		expect(initialStatus.status).toBe('IN_PROGRESS');
		expect(initialStatus.progress).toBeGreaterThanOrEqual(0);

		// Wait 4.1s for simulation completion
		await new Promise((r) => setTimeout(r, 4100));

		const finalStatus = await getMeshyTaskStatus(taskId);
		expect(finalStatus.status).toBe('SUCCEEDED');
		expect(finalStatus.progress).toBe(100);
		expect(finalStatus.modelUrls?.glb).toBeDefined();
	});
});
