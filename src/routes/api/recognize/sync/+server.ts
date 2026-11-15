/**
 * POST /api/recognize/sync
 *
 * Called by galleryService after publishing a gallery so the Python
 * OpenCV recognizer indexes newly uploaded artist artworks.
 *
 * Saves images to backend/data/paintings/ and updates backend/data/paintings.json,
 * which triggers the Python worker's hot-reload watcher.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

interface SyncArtwork {
	id: string;
	title: string;
	artist_name?: string;
	image_path: string;
	model_path?: string | null;
}

export async function POST({ request, locals, cookies }: RequestEvent) {
	const { user } = await locals.safeGetSession();
	const isDemo = cookies.get('artizart_demo_session');
	if (!user && !isDemo) {
		// Allow unauthenticated local sync in development / demo mode
		console.log('[recognize/sync] Syncing in guest / demo mode');
	}

	let artworks: SyncArtwork[] = [];
	try {
		const body = await request.json();
		if (Array.isArray(body?.artworks)) {
			artworks = body.artworks;
		}
	} catch {
		// body may be empty on simple touch calls
	}

	try {
		const fsModName = 'fs';
		const pathModName = 'path';
		const bufferModName = 'buffer';
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const fs = (await import(/* @vite-ignore */ fsModName)) as any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const path = (await import(/* @vite-ignore */ pathModName)) as any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { Buffer: nodeBuffer } = (await import(/* @vite-ignore */ bufferModName)) as any;

		const paintingsDir = path.resolve('backend/data/paintings');
		if (!fs.existsSync(paintingsDir)) {
			fs.mkdirSync(paintingsDir, { recursive: true });
		}

		const paintingsJsonPath = path.resolve('backend/data/paintings.json');
		let currentCatalog: Array<{
			id: string;
			title: string;
			artist: string;
			image: string;
			model_path?: string;
		}> = [];

		if (fs.existsSync(paintingsJsonPath)) {
			try {
				currentCatalog = JSON.parse(fs.readFileSync(paintingsJsonPath, 'utf-8'));
			} catch {
				currentCatalog = [];
			}
		}

		let catalogUpdated = false;

		for (const art of artworks) {
			if (!art.id || !art.image_path) continue;
			const safeId = art.id.replace(/[^a-zA-Z0-9_-]/g, '_');
			let imageFileName = `${safeId}.png`;
			const imageDestPath = path.join(paintingsDir, imageFileName);

			if (art.image_path.startsWith('data:image/')) {
				try {
					const base64Data = art.image_path.split(',')[1];
					if (base64Data) {
						fs.writeFileSync(imageDestPath, nodeBuffer.from(base64Data, 'base64'));
						catalogUpdated = true;
					}
				} catch (imgErr) {
					console.warn(`[recognize/sync] Failed to save data URL for ${art.id}:`, imgErr);
				}
			} else if (art.image_path.startsWith('http://') || art.image_path.startsWith('https://')) {
				try {
					const res = await fetch(art.image_path);
					if (res.ok) {
						const buf = nodeBuffer.from(await res.arrayBuffer());
						fs.writeFileSync(imageDestPath, buf);
						catalogUpdated = true;
					}
				} catch (fetchErr) {
					console.warn(`[recognize/sync] Failed to fetch image URL for ${art.id}:`, fetchErr);
				}
			} else if (!art.image_path.startsWith('/')) {
				imageFileName = art.image_path;
			}

			const existingIdx = currentCatalog.findIndex((c) => c.id === art.id);
			const entry = {
				id: art.id,
				title: art.title || 'Untitled',
				artist: art.artist_name || 'Artist',
				image: imageFileName,
				model_path: art.model_path || '/demo/models/default.glb'
			};

			if (existingIdx >= 0) {
				currentCatalog[existingIdx] = entry;
			} else {
				currentCatalog.push(entry);
			}
			catalogUpdated = true;
		}

		if (catalogUpdated || !fs.existsSync(paintingsJsonPath)) {
			fs.writeFileSync(paintingsJsonPath, JSON.stringify(currentCatalog, null, 2), 'utf-8');
		} else {
			// Touch mtime to notify file watcher
			const now = new Date();
			fs.utimesSync(paintingsJsonPath, now, now);
		}

		return json({
			ok: true,
			count: currentCatalog.length,
			message: `Detector synced with ${artworks.length} artworks`
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[recognize/sync] Failed to sync artworks:', msg);
		return json({ ok: false, message: msg }, { status: 500 });
	}
}
