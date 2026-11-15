import type { SavedArtwork } from './types';
import { getSavedArtworks, saveArtwork, removeArtwork, clearCollection } from './indexedDb';

class CollectionStore {
	artworks = $state<SavedArtwork[]>([]);
	loading = $state(true);
	private initialized = false;

	async init(): Promise<void> {
		if (this.initialized) return;
		this.loading = true;
		try {
			this.artworks = await getSavedArtworks();
		} catch (err) {
			console.error('Failed to load collection:', err);
		} finally {
			this.loading = false;
			this.initialized = true;
		}
	}

	async save(artwork: SavedArtwork): Promise<void> {
		await saveArtwork(artwork);
		// Update reactive array: prepend or move to front (newest first)
		const existingIdx = this.artworks.findIndex((a) => a.artworkId === artwork.artworkId);
		if (existingIdx !== -1) {
			this.artworks.splice(existingIdx, 1);
		}
		this.artworks = [artwork, ...this.artworks];
	}

	async remove(artworkId: string): Promise<void> {
		await removeArtwork(artworkId);
		this.artworks = this.artworks.filter((a) => a.artworkId !== artworkId);
	}

	async clear(): Promise<void> {
		await clearCollection();
		this.artworks = [];
	}

	async seedDemo(): Promise<void> {
		const { seedDemoCollection } = await import('./indexedDb');
		await seedDemoCollection();
		this.artworks = await getSavedArtworks();
	}

	has(artworkId: string): boolean {
		return this.artworks.some((a) => a.artworkId === artworkId);
	}
}

export const collectionStore = new CollectionStore();
