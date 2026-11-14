import { json, type RequestHandler } from '@sveltejs/kit';
import { normalizeModelSpec } from '#lib/manifest/repository';
import type { ArtManifest, ModelSpec } from '#lib/manifest/types';

export const prerender = false;

interface CalibrationSavePayload {
	targetId?: unknown;
	spec?: Partial<ModelSpec>;
}

function isCalibrationEnabled(): boolean {
	return Boolean(import.meta.env.DEV);
}

export const POST: RequestHandler = async ({ request }) => {
	if (!isCalibrationEnabled()) {
		return new Response('Not Found', { status: 404 });
	}

	let body: CalibrationSavePayload;
	try {
		body = (await request.json()) as CalibrationSavePayload;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
	if (!targetId || !body.spec || typeof body.spec !== 'object') {
		return json({ error: 'targetId and spec are required' }, { status: 400 });
	}

	const fsModName = 'node:fs/promises';
	const pathModName = 'node:path';
	const fs = (await import(/* @vite-ignore */ fsModName)) as {
		readFile: (path: string, encoding: string) => Promise<string>;
		writeFile: (path: string, data: string, encoding: string) => Promise<void>;
	};
	const path = (await import(/* @vite-ignore */ pathModName)) as {
		resolve: (...segments: string[]) => string;
	};

	const manifestPath = path.resolve('static/demo/manifest.json');
	let manifest: ArtManifest;
	try {
		const raw = await fs.readFile(manifestPath, 'utf-8');
		manifest = JSON.parse(raw) as ArtManifest;
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : 'Failed to read manifest.json' },
			{ status: 500 }
		);
	}

	let updated = false;
	for (const canvas of manifest.canvases ?? []) {
		if (canvas.id === targetId) {
			canvas.singleModel = normalizeModelSpec({
				...canvas.singleModel,
				...body.spec,
				url:
					typeof body.spec.url === 'string' && body.spec.url
						? body.spec.url
						: canvas.singleModel.url
			});
			updated = true;
			break;
		}
	}

	if (!updated) {
		for (const rule of manifest.seamRules ?? []) {
			if (rule.id === targetId || `seam-${rule.id}` === targetId) {
				rule.combinedModel = normalizeModelSpec({
					...rule.combinedModel,
					...body.spec,
					url:
						typeof body.spec.url === 'string' && body.spec.url
							? body.spec.url
							: rule.combinedModel.url
				});
				updated = true;
				break;
			}
		}
	}

	if (!updated) {
		return json({ error: `Unknown calibration targetId: ${targetId}` }, { status: 404 });
	}

	await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
	return json({ ok: true, targetId, manifest });
};
