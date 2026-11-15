import { getSupabaseBrowserClient } from '#lib/supabase/client';

export interface GalleryArtwork {
	id?: string;
	title: string;
	artist_name: string;
	image_path: string;
	thumb_path?: string | null;
	model_path?: string | null;
	model_poster_path?: string | null;
	model_source?: 'uploaded' | 'meshy' | null;
	target_path?: string | null;
	trackability_score?: number | null;
	sort_order?: number;
}

export interface GalleryWithArtworks {
	id: string;
	owner_id: string;
	title: string;
	description?: string | null;
	status: 'draft' | 'published';
	created_at: string;
	artworks: GalleryArtwork[];
}

// In-memory / local storage store for local demo mode or offline development
const LOCAL_STORAGE_KEY = 'artizart_local_galleries_v1';
let memoryGalleries: GalleryWithArtworks[] | null = null;

export function _resetGalleriesForTesting(): void {
	memoryGalleries = null;
	if (typeof window !== 'undefined') {
		try {
			localStorage.removeItem(LOCAL_STORAGE_KEY);
		} catch {
			// ignore
		}
	}
}

function getInitialDefaultGalleries(): GalleryWithArtworks[] {
	return [
		{
			id: 'gallery-autumn',
			owner_id: 'demo-artist-uuid',
			title: 'Autumn Horizons',
			description: 'Paintings and 3D models exploring autumnal depth.',
			status: 'published',
			created_at: new Date(Date.now() - 86400000).toISOString(),
			artworks: [
				{
					id: 'art-1',
					title: 'Trumpet of Turmoil',
					artist_name: 'SONIA',
					image_path: '/demo/irlo1.jpg',
					thumb_path: '/demo/irlo1.jpg',
					model_path: '/demo/models/irlo1_single.glb',
					model_poster_path: '/brand/purple-waves.webp',
					target_path: '/demo/targets/irlo1.mind',
					trackability_score: 92,
					sort_order: 0
				},
				{
					id: 'art-2',
					title: 'Inverted Horizon',
					artist_name: 'SONIA',
					image_path: '/demo/irlo2.jpg',
					thumb_path: '/demo/irlo2.jpg',
					model_path: '/demo/models/irlo2_single.glb',
					model_poster_path: '/demo/irlo2.jpg',
					target_path: '/demo/targets/irlo2.mind',
					trackability_score: 89,
					sort_order: 1
				}
			]
		},
		{
			id: 'gallery-monolith',
			owner_id: 'demo-artist-uuid',
			title: 'Monolith Reflections',
			description: 'Previous exploratory works in urban realism.',
			status: 'draft',
			created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
			artworks: [
				{
					id: 'art-3',
					title: 'Rubber Ducky Urban',
					artist_name: 'SONIA',
					image_path: '/brand/purple-waves.webp',
					thumb_path: '/brand/purple-waves.webp',
					model_path: '/demo/models/default.glb',
					trackability_score: 64,
					sort_order: 0
				}
			]
		}
	];
}

function getLocalGalleries(): GalleryWithArtworks[] {
	if (typeof window === 'undefined') {
		if (memoryGalleries) return memoryGalleries;
	} else {
		try {
			const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
			if (raw) return JSON.parse(raw);
		} catch {
			// ignore
		}
	}

	const initial = getInitialDefaultGalleries();

	if (typeof window === 'undefined') {
		memoryGalleries = initial;
	} else {
		try {
			localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initial));
		} catch {
			// ignore
		}
	}
	return initial;
}

function saveLocalGalleries(galleries: GalleryWithArtworks[]): void {
	if (typeof window === 'undefined') {
		memoryGalleries = galleries;
		return;
	}
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(galleries));
	} catch {
		// ignore
	}
}

function isPlaceholderClient(): boolean {
	const url = import.meta.env.PUBLIC_SUPABASE_URL || '';
	return !url || url.includes('placeholder');
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			if (typeof reader.result === 'string') {
				resolve(reader.result);
			} else {
				reject(new Error('FileReader did not produce string data URL'));
			}
		};
		reader.onerror = () => reject(reader.error || new Error('FileReader error'));
		reader.readAsDataURL(blob);
	});
}

export const galleryService = {
	async getArtistGalleries(ownerId: string): Promise<GalleryWithArtworks[]> {
		if (isPlaceholderClient()) {
			const all = getLocalGalleries();
			return all
				.filter((g) => g.owner_id === ownerId || g.owner_id === 'demo-artist-uuid')
				.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
		}

		const supabase = getSupabaseBrowserClient();
		const { data: galleries, error } = await supabase
			.from('galleries')
			.select(`
				id,
				owner_id,
				title,
				description,
				status,
				created_at,
				artworks (
					id,
					title,
					artist_name,
					image_path,
					thumb_path,
					model_path,
					model_poster_path,
					model_source,
					target_path,
					trackability_score,
					sort_order
				)
			`)
			.eq('owner_id', ownerId)
			.order('created_at', { ascending: false });

		if (error) {
			console.warn('Supabase getArtistGalleries error, falling back to local:', error.message);
			return getLocalGalleries().filter((g) => g.owner_id === ownerId || g.owner_id === 'demo-artist-uuid');
		}

		return (galleries || []).map((g) => ({
			...g,
			artworks: (g.artworks || []).sort((a: GalleryArtwork, b: GalleryArtwork) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
		}));
	},

	/**
	 * Fetches all artworks belonging to published galleries so the visitor AR scanner (`/`)
	 * and saved collection (`/saved`) can resolve custom artist paintings and 3D models.
	 */
	async getPublishedArtworks(): Promise<GalleryArtwork[]> {
		const extractLocalPublished = (): GalleryArtwork[] => {
			const publishedGalleries = getLocalGalleries()
				.filter((g) => g.status === 'published')
				.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

			const list: GalleryArtwork[] = [];
			for (const g of publishedGalleries) {
				const sorted = [...(g.artworks || [])].sort(
					(a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
				);
				list.push(...sorted);
			}
			return list;
		};

		if (isPlaceholderClient()) {
			return extractLocalPublished();
		}

		const supabase = getSupabaseBrowserClient();
		const { data: galleries, error } = await supabase
			.from('galleries')
			.select(`
				id,
				status,
				created_at,
				artworks (
					id,
					title,
					artist_name,
					image_path,
					thumb_path,
					model_path,
					model_poster_path,
					model_source,
					target_path,
					trackability_score,
					sort_order
				)
			`)
			.eq('status', 'published')
			.order('created_at', { ascending: false });

		if (error) {
			console.warn('Supabase getPublishedArtworks error, falling back to local:', error.message);
			return extractLocalPublished();
		}

		const remoteList: GalleryArtwork[] = [];
		for (const g of galleries || []) {
			const sorted = [...(g.artworks || [])].sort(
				(a: GalleryArtwork, b: GalleryArtwork) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
			);
			remoteList.push(...sorted);
		}
		return remoteList;
	},

	/**
	 * Pushes published artworks to the recognition backend (`/api/recognize/sync`)
	 * so newly published paintings become immediately scannable without restarting FastAPI.
	 */
	async syncPublishedToBackend(artworks?: GalleryArtwork[]): Promise<void> {
		if (typeof fetch === 'undefined') return;
		try {
			const list = artworks ?? (await this.getPublishedArtworks());
			await fetch('/api/recognize/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ artworks: list })
			});
		} catch {
			// Ignore network errors when recognition backend is offline during static/unit tests
		}
	},

	async getGalleryById(galleryId: string, ownerId?: string): Promise<GalleryWithArtworks | null> {
		if (isPlaceholderClient()) {
			const found = getLocalGalleries().find((g) => g.id === galleryId);
			if (found && ownerId && found.owner_id !== ownerId && found.owner_id !== 'demo-artist-uuid' && found.status === 'draft') {
				// RLS check for draft
				return null;
			}
			return found || null;
		}

		const supabase = getSupabaseBrowserClient();
		const query = supabase
			.from('galleries')
			.select(`
				id,
				owner_id,
				title,
				description,
				status,
				created_at,
				artworks (
					id,
					title,
					artist_name,
					image_path,
					thumb_path,
					model_path,
					model_poster_path,
					model_source,
					target_path,
					trackability_score,
					sort_order
				)
			`)
			.eq('id', galleryId)
			.single();

		const { data, error } = await query;
		if (error || !data) return null;

		return {
			...data,
			artworks: (data.artworks || []).sort((a: GalleryArtwork, b: GalleryArtwork) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
		};
	},

	async saveGallery(params: {
		id?: string;
		owner_id: string;
		title: string;
		description?: string;
		status: 'draft' | 'published';
		artworks: GalleryArtwork[];
	}): Promise<GalleryWithArtworks> {
		if (isPlaceholderClient()) {
			const all = getLocalGalleries();
			const id = params.id || `gallery-${Date.now()}`;
			const existingIndex = all.findIndex((g) => g.id === id);

			const saved: GalleryWithArtworks = {
				id,
				owner_id: params.owner_id,
				title: params.title,
				description: params.description || '',
				status: params.status,
				created_at: existingIndex >= 0 ? all[existingIndex].created_at : new Date().toISOString(),
				artworks: params.artworks.map((a, idx) => ({
					...a,
					id: a.id || `art-${Date.now()}-${idx}`,
					model_source: a.model_source || (a.model_path ? 'uploaded' : null),
					target_path: a.target_path ?? null,
					trackability_score: a.trackability_score ?? null,
					sort_order: idx
				}))
			};

			if (existingIndex >= 0) {
				all[existingIndex] = saved;
			} else {
				all.unshift(saved);
			}
			saveLocalGalleries(all);

			if (saved.status === 'published') {
				void this.syncPublishedToBackend();
			}
			return saved;
		}

		const supabase = getSupabaseBrowserClient();
		const galleryId = params.id || crypto.randomUUID();

		// Upsert gallery
		const { error: gErr } = await supabase.from('galleries').upsert({
			id: galleryId,
			owner_id: params.owner_id,
			title: params.title,
			description: params.description || '',
			status: params.status
		});
		if (gErr) throw new Error(gErr.message);

		// Delete existing artworks if updating
		if (params.id) {
			await supabase.from('artworks').delete().eq('gallery_id', galleryId);
		}

		// Insert artworks
		if (params.artworks.length > 0) {
			const rows = params.artworks.map((a, idx) => ({
				id: a.id || crypto.randomUUID(),
				gallery_id: galleryId,
				owner_id: params.owner_id,
				title: a.title,
				artist_name: a.artist_name,
				image_path: a.image_path,
				thumb_path: a.thumb_path,
				model_path: a.model_path,
				model_poster_path: a.model_poster_path,
				model_source: a.model_source || (a.model_path ? 'uploaded' : null),
				target_path: a.target_path ?? null,
				trackability_score: a.trackability_score ?? null,
				sort_order: idx
			}));

			const { error: aErr } = await supabase.from('artworks').insert(rows);
			if (aErr) throw new Error(aErr.message);
		}

		const reloaded = await this.getGalleryById(galleryId, params.owner_id);
		if (!reloaded) throw new Error('Failed to retrieve saved gallery');

		if (reloaded.status === 'published') {
			void this.syncPublishedToBackend();
		}
		return reloaded;
	},

	async deleteGallery(galleryId: string, ownerId: string): Promise<void> {
		if (isPlaceholderClient()) {
			const all = getLocalGalleries();
			const filtered = all.filter((g) => g.id !== galleryId);
			saveLocalGalleries(filtered);
			return;
		}

		const supabase = getSupabaseBrowserClient();
		const { error } = await supabase
			.from('galleries')
			.delete()
			.eq('id', galleryId)
			.eq('owner_id', ownerId);

		if (error) throw new Error(error.message);
	},

	async uploadStorageFile(
		bucket: 'artwork-images' | 'models' | 'targets',
		filePath: string,
		file: Blob | File
	): Promise<string> {
		if (isPlaceholderClient()) {
			// For artwork images in local/demo mode, convert to a persistent Data URL when possible
			// so images survive page reloads and can be sent to the FastAPI recognition backend.
			if (
				bucket === 'artwork-images' &&
				typeof FileReader !== 'undefined' &&
				file.size <= 1_500_000
			) {
				try {
					return await blobToDataUrl(file);
				} catch {
					// fall through to object URL
				}
			}
			return URL.createObjectURL(file);
		}

		const supabase = getSupabaseBrowserClient();
		const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, {
			upsert: true
		});

		if (error) throw new Error(error.message);

		const { data: pub } = supabase.storage.from(bucket).getPublicUrl(data.path);
		return pub.publicUrl;
	}
};
