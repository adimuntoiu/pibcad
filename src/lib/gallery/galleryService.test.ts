import { describe, it, expect, beforeEach } from 'vitest';
import { galleryService, _resetGalleriesForTesting } from './galleryService';

describe('galleryService (local demo & RLS simulation)', () => {
	beforeEach(() => {
		_resetGalleriesForTesting();
	});

	it('returns initial galleries for artist', async () => {
		const galleries = await galleryService.getArtistGalleries('demo-artist-uuid');
		expect(galleries.length).toBeGreaterThan(0);
		expect(galleries[0].title).toBeDefined();
		expect(galleries[0].artworks.length).toBeGreaterThan(0);
	});

	it('creates, retrieves, and updates a gallery with artworks', async () => {
		const newGallery = await galleryService.saveGallery({
			owner_id: 'artist-alice',
			title: 'Neon Dreams',
			description: 'Cyberpunk art pieces',
			status: 'published',
			artworks: [
				{
					title: 'Chrome Fox',
					artist_name: 'Alice',
					image_path: '/demo/irlo1.jpg',
					model_path: '/demo/models/irlo1_single.glb'
				},
				{
					title: 'Cyber City',
					artist_name: 'Alice',
					image_path: '/demo/irlo2.jpg'
				}
			]
		});

		expect(newGallery.id).toBeDefined();
		expect(newGallery.title).toBe('Neon Dreams');
		expect(newGallery.artworks.length).toBe(2);
		expect(newGallery.artworks[0].title).toBe('Chrome Fox');
		expect(newGallery.artworks[0].model_source).toBe('uploaded');

		// Retrieve by ID
		const retrieved = await galleryService.getGalleryById(newGallery.id, 'artist-alice');
		expect(retrieved).not.toBeNull();
		expect(retrieved?.title).toBe('Neon Dreams');

		// Update gallery
		const updated = await galleryService.saveGallery({
			id: newGallery.id,
			owner_id: 'artist-alice',
			title: 'Neon Dreams V2',
			status: 'published',
			artworks: [
				{
					title: 'Chrome Fox Remastered',
					artist_name: 'Alice',
					image_path: '/demo/irlo1.jpg'
				}
			]
		});

		expect(updated.title).toBe('Neon Dreams V2');
		expect(updated.artworks.length).toBe(1);
	});

	it('enforces RLS: another artist cannot view or retrieve someone else draft gallery', async () => {
		const draftGallery = await galleryService.saveGallery({
			owner_id: 'artist-bob',
			title: 'Private Sketchbook',
			status: 'draft',
			artworks: [
				{
					title: 'Secret Concept',
					artist_name: 'Bob',
					image_path: '/demo/irlo1.jpg'
				}
			]
		});

		// Bob can view his own draft
		const bobView = await galleryService.getGalleryById(draftGallery.id, 'artist-bob');
		expect(bobView).not.toBeNull();

		// Alice cannot view Bob's draft gallery (RLS draft protection)
		const aliceView = await galleryService.getGalleryById(draftGallery.id, 'artist-alice');
		expect(aliceView).toBeNull();
	});

	it('deletes a gallery successfully', async () => {
		const created = await galleryService.saveGallery({
			owner_id: 'artist-charlie',
			title: 'Temporary Pop-up',
			status: 'published',
			artworks: []
		});

		let found = await galleryService.getGalleryById(created.id, 'artist-charlie');
		expect(found).not.toBeNull();

		await galleryService.deleteGallery(created.id, 'artist-charlie');
		found = await galleryService.getGalleryById(created.id, 'artist-charlie');
		expect(found).toBeNull();
	});
});
