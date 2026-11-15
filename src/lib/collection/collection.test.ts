import { describe, it, expect, beforeEach } from 'vitest';
import { saveArtwork, getSavedArtworks, removeArtwork, clearCollection } from './indexedDb';
import type { SavedArtwork } from './types';

describe('IndexedDB Collection Storage (with memory fallback)', () => {
	beforeEach(async () => {
		await clearCollection();
	});

	it('saves artworks and retrieves them newest first', async () => {
		const art1: SavedArtwork = {
			artworkId: 'irlo1',
			title: 'Painting 1',
			artistName: 'IRLO',
			modelUrl: '/models/1.glb',
			scannedAt: 1000
		};

		const art2: SavedArtwork = {
			artworkId: 'irlo2',
			title: 'Painting 2',
			artistName: 'IRLO',
			modelUrl: '/models/2.glb',
			scannedAt: 2000
		};

		await saveArtwork(art1);
		await saveArtwork(art2);

		const items = await getSavedArtworks();
		expect(items).toHaveLength(2);
		expect(items[0].artworkId).toBe('irlo2'); // Newer timestamp comes first
		expect(items[1].artworkId).toBe('irlo1');
	});

	it('updates existing artwork without duplicating', async () => {
		const art: SavedArtwork = {
			artworkId: 'irlo1',
			title: 'Original Title',
			artistName: 'IRLO',
			scannedAt: 1000
		};
		await saveArtwork(art);

		const updated: SavedArtwork = {
			artworkId: 'irlo1',
			title: 'Updated Title',
			artistName: 'IRLO',
			scannedAt: 3000
		};
		await saveArtwork(updated);

		const items = await getSavedArtworks();
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Updated Title');
		expect(items[0].scannedAt).toBe(3000);
	});

	it('removes an artwork by ID', async () => {
		await saveArtwork({
			artworkId: 'ducky',
			title: 'Rubber Ducky',
			artistName: 'IRLO',
			scannedAt: 1000
		});

		expect(await getSavedArtworks()).toHaveLength(1);
		await removeArtwork('ducky');
		expect(await getSavedArtworks()).toHaveLength(0);
	});
});
