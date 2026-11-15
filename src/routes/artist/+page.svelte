<script lang="ts">
	import { onMount } from 'svelte';
	import BrandBackground from '#lib/components/BrandBackground.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import PillButton from '#lib/components/PillButton.svelte';
	import GalleryCarouselCard from '#lib/components/GalleryCarouselCard.svelte';
	import MeshyGenerationModal from '#lib/components/MeshyGenerationModal.svelte';
	import {
		galleryService,
		type GalleryWithArtworks,
		type GalleryArtwork
	} from '#lib/gallery/galleryService';
	import { getSupabaseBrowserClient } from '#lib/supabase/client';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const supabase = getSupabaseBrowserClient();

	const artistName = $derived(
		page.data.user?.user_metadata?.display_name ||
		page.data.user?.email?.split('@')[0]?.toUpperCase() ||
		'ARTIST'
	);

	const ownerId = $derived(page.data.user?.id || 'demo-artist-uuid');

	let galleries = $state<GalleryWithArtworks[]>([]);
	let loading = $state(true);
	let galleryToDelete = $state<GalleryWithArtworks | null>(null);
	let isDeleting = $state(false);

	let meshyModalOpen = $state(false);
	let meshyArtwork = $state<GalleryArtwork | null>(null);
	let meshyGallery = $state<GalleryWithArtworks | null>(null);

	function handleGenerate3D(artwork: GalleryArtwork, gallery: GalleryWithArtworks) {
		meshyArtwork = artwork;
		meshyGallery = gallery;
		meshyModalOpen = true;
	}

	async function handleMeshyAccept(result: { modelUrl: string; posterUrl: string }) {
		if (meshyArtwork && meshyGallery) {
			const updatedArtworks = meshyGallery.artworks.map((a) => {
				if (a.id === meshyArtwork?.id || a.title === meshyArtwork?.title) {
					return {
						...a,
						model_path: result.modelUrl,
						model_poster_path: result.posterUrl,
						model_source: 'meshy' as const
					};
				}
				return a;
			});

			await galleryService.saveGallery({
				id: meshyGallery.id,
				owner_id: ownerId,
				title: meshyGallery.title,
				description: meshyGallery.description || '',
				status: meshyGallery.status,
				artworks: updatedArtworks
			});

			await loadGalleries();
		}
		meshyModalOpen = false;
		meshyArtwork = null;
		meshyGallery = null;
	}

	async function loadGalleries() {
		loading = true;
		try {
			const res = await galleryService.getArtistGalleries(ownerId);
			galleries = res;
		} catch (err) {
			console.error('Failed to load artist galleries:', err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadGalleries();
	});

	async function handleLogout() {
		const isPlaceholder =
			!import.meta.env.PUBLIC_SUPABASE_URL ||
			import.meta.env.PUBLIC_SUPABASE_URL.includes('placeholder');
		if (isPlaceholder) {
			document.cookie = 'artizart_demo_session=; path=/; max-age=0';
		} else {
			await supabase.auth.signOut();
		}
		await goto('/login', { invalidateAll: true });
	}

	function confirmDelete(gallery: GalleryWithArtworks) {
		galleryToDelete = gallery;
	}

	function cancelDelete() {
		galleryToDelete = null;
	}

	async function executeDelete() {
		if (!galleryToDelete) return;
		isDeleting = true;
		try {
			await galleryService.deleteGallery(galleryToDelete.id, ownerId);
			galleries = galleries.filter((g) => g.id !== galleryToDelete?.id);
			galleryToDelete = null;
		} catch (err) {
			console.error('Delete failed:', err);
		} finally {
			isDeleting = false;
		}
	}
</script>

<svelte:head>
	<title>Artist Dashboard ({artistName}) — artizART</title>
</svelte:head>

<BrandBackground>
	<div class="flex flex-1 flex-col items-center py-4 px-2">
		<!-- Header / Logo + Logout Action -->
		<header class="flex w-full items-center justify-between pt-1">
			<a
				href="/"
				class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-opacity hover:opacity-80"
				aria-label="Back to Scanner"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
				</svg>
			</a>

			<div class="flex-1 text-center">
				<Logo accent="light" size="md" />
			</div>

			<button
				type="button"
				onclick={handleLogout}
				class="inline-flex h-10 items-center justify-center rounded-full bg-white/15 px-3.5 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/25 active:scale-95"
				aria-label="Log Out"
			>
				LOGOUT
			</button>
		</header>

		<!-- Welcome & Action Button -->
		<div class="mt-6 flex w-full flex-col items-start px-1">
			<h1 class="font-display text-4xl font-bold uppercase tracking-tight text-white sm:text-5xl">
				Welcome, {artistName}
			</h1>

			<div class="mt-4 w-full">
				<PillButton variant="white" class="w-full sm:w-auto" href="/artist/galleries/new">
					CREATE A GALLERY
				</PillButton>
			</div>
		</div>

		<!-- Galleries Column (Latest First, Scrollable) -->
		<div class="mt-6 flex w-full flex-col gap-6 pb-12">
			{#if loading}
				<div class="flex flex-col items-center justify-center py-16 text-white">
					<svg class="h-8 w-8 animate-spin text-brand-purple" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
					</svg>
					<p class="mt-3 font-sans text-xs text-white/80">Loading your exhibitions...</p>
				</div>
			{:else if galleries.length === 0}
				<!-- Empty state -->
				<div class="flex flex-col items-center justify-center rounded-[2.25rem] bg-white/10 p-8 text-center text-white backdrop-blur-md border border-white/15 my-4">
					<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-white/80 mb-3">
						<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
						</svg>
					</div>
					<h2 class="font-display text-2xl font-bold uppercase tracking-tight">No Galleries Yet</h2>
					<p class="mt-1 max-w-xs font-sans text-xs text-white/70">
						You haven't created any galleries yet. Create your first gallery to showcase your paintings with interactive 3D models.
					</p>
					<div class="mt-5">
						<PillButton variant="purple" href="/artist/galleries/new">
							CREATE YOUR FIRST GALLERY
						</PillButton>
					</div>
				</div>
			{:else}
				{#each galleries as gallery (gallery.id)}
					<GalleryCarouselCard
						{gallery}
						onEdit={() => goto(`/artist/galleries/${gallery.id}/edit`)}
						onDelete={() => confirmDelete(gallery)}
						onGenerate3D={handleGenerate3D}
					/>
				{/each}
			{/if}
		</div>
	</div>
</BrandBackground>

<!-- Delete Confirmation Modal -->
{#if galleryToDelete}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-sm rounded-[2rem] bg-zinc-900 p-6 text-white shadow-2xl border border-white/15">
			<h3 class="font-display text-2xl font-bold uppercase tracking-tight text-white">
				Delete Gallery?
			</h3>
			<p class="mt-2 font-sans text-xs text-zinc-300">
				Are you sure you want to delete <strong class="text-white">"{galleryToDelete.title}"</strong>? All artworks and models within this gallery will be permanently deleted.
			</p>

			<div class="mt-6 flex gap-3">
				<button
					type="button"
					onclick={cancelDelete}
					disabled={isDeleting}
					class="flex-1 rounded-full bg-white/15 py-3 font-display text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/25 disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={executeDelete}
					disabled={isDeleting}
					class="flex-1 rounded-full bg-rose-600 py-3 font-display text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
				>
					{isDeleting ? 'Deleting...' : 'Delete'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if meshyModalOpen && meshyArtwork}
	<MeshyGenerationModal
		isOpen={meshyModalOpen}
		artworkTitle={meshyArtwork.title}
		imageUrl={meshyArtwork.image_path}
		artworkId={meshyArtwork.id}
		onAccept={handleMeshyAccept}
		onDiscard={() => {
			meshyModalOpen = false;
			meshyArtwork = null;
			meshyGallery = null;
		}}
		onClose={() => {
			meshyModalOpen = false;
			meshyArtwork = null;
			meshyGallery = null;
		}}
	/>
{/if}
