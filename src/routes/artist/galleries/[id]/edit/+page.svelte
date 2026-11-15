<script lang="ts">
	import { onMount } from 'svelte';
	import BrandBackground from '#lib/components/BrandBackground.svelte';
	import GalleryForm from '#lib/components/GalleryForm.svelte';
	import { galleryService, type GalleryWithArtworks } from '#lib/gallery/galleryService';
	import { page } from '$app/state';

	const artistName = $derived(
		page.data.user?.user_metadata?.display_name ||
		page.data.user?.email?.split('@')[0]?.toUpperCase() ||
		'ARTIST'
	);
	const ownerId = $derived(page.data.user?.id || 'demo-artist-uuid');
	const galleryId = $derived(page.params?.id || '');

	let gallery = $state<GalleryWithArtworks | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	onMount(async () => {
		if (!galleryId) {
			loadError = 'Missing gallery ID';
			loading = false;
			return;
		}

		try {
			const found = await galleryService.getGalleryById(galleryId, ownerId);
			if (!found) {
				loadError = 'Gallery not found or you do not have permission to view or edit it.';
			} else {
				gallery = found;
			}
		} catch (err: unknown) {
			loadError = err instanceof Error ? err.message : 'Failed to load gallery.';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Edit Gallery — artizART</title>
</svelte:head>

<BrandBackground>
	<div class="flex flex-1 flex-col items-center pt-4 px-3">
		{#if loading}
			<div class="flex flex-1 flex-col items-center justify-center py-20 text-white">
				<svg class="h-8 w-8 animate-spin text-brand-purple" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
				</svg>
				<p class="mt-3 font-sans text-sm text-white/80">Loading gallery...</p>
			</div>
		{:else if loadError || !gallery}
			<div class="flex flex-1 flex-col items-center justify-center py-20 text-center px-4">
				<div class="rounded-2xl bg-rose-500/20 p-6 text-rose-200 border border-rose-500/30 max-w-md">
					<h2 class="font-display text-2xl font-bold uppercase text-white mb-2">Access Error</h2>
					<p class="text-sm text-rose-200 mb-4">{loadError || 'Gallery not found.'}</p>
					<a
						href="/artist"
						class="inline-flex rounded-full bg-white px-5 py-2 font-display text-xs font-bold uppercase text-zinc-900 shadow hover:bg-white/90"
					>
						Back to Dashboard
					</a>
				</div>
			</div>
		{:else}
			<GalleryForm
				mode="edit"
				initialGallery={gallery}
				ownerId={ownerId}
				defaultArtistName={artistName}
			/>
		{/if}
	</div>
</BrandBackground>
