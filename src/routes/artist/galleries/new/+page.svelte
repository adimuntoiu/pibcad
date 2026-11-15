<script lang="ts">
	import BrandBackground from '#lib/components/BrandBackground.svelte';
	import GalleryForm from '#lib/components/GalleryForm.svelte';
	import { page } from '$app/state';

	const artistName = $derived(
		page.data.user?.user_metadata?.display_name ||
		page.data.user?.email?.split('@')[0]?.toUpperCase() ||
		'ARTIST'
	);
	const ownerId = $derived(page.data.user?.id || 'demo-artist-uuid');
</script>

<svelte:head>
	<title>Create Gallery — artizART</title>
</svelte:head>

<BrandBackground>
	<div class="flex flex-1 flex-col items-center pt-4 px-3">
		<GalleryForm
			mode="create"
			ownerId={ownerId}
			defaultArtistName={artistName}
		/>
	</div>
</BrandBackground>
