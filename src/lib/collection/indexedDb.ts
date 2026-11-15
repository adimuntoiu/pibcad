import type { SavedArtwork } from './types';

const DB_NAME = 'artizart_db';
const DB_VERSION = 1;
const STORE_NAME = 'saved_artworks';
const MODEL_CACHE_NAME = 'artizart-models-v1';

// In-memory fallback for SSR or environments where indexedDB is unavailable
let memoryStore: Map<string, SavedArtwork> | null = null;

function isIndexedDbAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function getMemoryStore(): Map<string, SavedArtwork> {
	if (!memoryStore) {
		memoryStore = new Map<string, SavedArtwork>();
	}
	return memoryStore;
}

export function openCollectionDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (!isIndexedDbAvailable()) {
			reject(new Error('IndexedDB is not available in this environment'));
			return;
		}

		const request = window.indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'artworkId' });
				store.createIndex('by_scannedAt', 'scannedAt', { unique: false });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Caches a 3D model file (and optionally textures) in the CacheStorage API for offline viewing.
 */
export async function cacheModelForOffline(modelUrl: string | null | undefined): Promise<void> {
	if (!modelUrl || typeof window === 'undefined' || !('caches' in window)) return;
	try {
		const cache = await window.caches.open(MODEL_CACHE_NAME);
		const existing = await cache.match(modelUrl);
		if (!existing) {
			const response = await fetch(modelUrl);
			if (response.ok) {
				await cache.put(modelUrl, response);
			}
		}
	} catch (err) {
		console.warn('Failed to cache model for offline:', err);
	}
}

/**
 * Retrieves all saved artworks from IndexedDB sorted newest first.
 */
export async function getSavedArtworks(): Promise<SavedArtwork[]> {
	if (!isIndexedDbAvailable()) {
		return Array.from(getMemoryStore().values()).sort((a, b) => b.scannedAt - a.scannedAt);
	}

	try {
		const db = await openCollectionDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const index = store.index('by_scannedAt');
			const request = index.openCursor(null, 'prev'); // 'prev' sorts descending (newest first)
			const results: SavedArtwork[] = [];

			request.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (cursor) {
					results.push(cursor.value);
					cursor.continue();
				} else {
					resolve(results);
				}
			};

			request.onerror = () => reject(request.error);
		});
	} catch {
		return Array.from(getMemoryStore().values()).sort((a, b) => b.scannedAt - a.scannedAt);
	}
}

/**
 * Saves or updates an artwork in the collection and caches its 3D model.
 */
export async function saveArtwork(artwork: SavedArtwork): Promise<void> {
	// Cache the 3D model asset in background
	if (artwork.modelUrl) {
		void cacheModelForOffline(artwork.modelUrl);
	}

	if (!isIndexedDbAvailable()) {
		getMemoryStore().set(artwork.artworkId, artwork);
		return;
	}

	try {
		const db = await openCollectionDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const request = store.put(artwork);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch {
		getMemoryStore().set(artwork.artworkId, artwork);
	}
}

/**
 * Checks whether an artwork exists in the saved collection.
 */
export async function isArtworkSaved(artworkId: string): Promise<boolean> {
	if (!isIndexedDbAvailable()) {
		return getMemoryStore().has(artworkId);
	}

	try {
		const db = await openCollectionDb();
		return new Promise<boolean>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const request = store.get(artworkId);

			request.onsuccess = () => resolve(request.result !== undefined);
			request.onerror = () => reject(request.error);
		});
	} catch {
		return getMemoryStore().has(artworkId);
	}
}

/**
 * Removes an artwork from the collection by ID.
 */
export async function removeArtwork(artworkId: string): Promise<void> {
	if (!isIndexedDbAvailable()) {
		getMemoryStore().delete(artworkId);
		return;
	}

	try {
		const db = await openCollectionDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const request = store.delete(artworkId);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch {
		getMemoryStore().delete(artworkId);
	}
}

/**
 * Seeds the demo artworks (Rubber Ducky, irlo1, irlo2) into the collection.
 */
export async function seedDemoCollection(): Promise<void> {
	const now = Date.now();
	await saveArtwork({
		artworkId: 'ducky',
		title: 'Rubber Ducky',
		artistName: 'IRLO',
		modelUrl: '/demo/models/default.glb',
		thumbUrl: '/demo/irlo1.jpg',
		scannedAt: now
	});
	await saveArtwork({
		artworkId: 'irlo1',
		title: 'Stone Guardian',
		artistName: 'IRLO',
		modelUrl: '/demo/models/irlo1_single.glb',
		thumbUrl: '/demo/irlo1.jpg',
		scannedAt: now - 30000
	});
	await saveArtwork({
		artworkId: 'irlo2',
		title: 'Inverted Horizon',
		artistName: 'IRLO',
		modelUrl: '/demo/models/irlo2_single.glb',
		thumbUrl: '/demo/irlo2.jpg',
		scannedAt: now - 60000
	});
}

/**
 * Clears the collection.
 */
export async function clearCollection(): Promise<void> {
	getMemoryStore().clear();
	if (!isIndexedDbAvailable()) return;

	try {
		const db = await openCollectionDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const request = store.clear();

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch {
		// Ignore
	}
}
