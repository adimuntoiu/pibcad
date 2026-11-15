<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import BrandBackground from '#lib/components/BrandBackground.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import CircularButton from '#lib/components/CircularButton.svelte';
	import ModelViewer3D from '#lib/components/ModelViewer3D.svelte';
	import { collectionStore } from '#lib/collection/collectionStore.svelte';
	import { InactivityFadeTimer } from '#lib/collection/fadeTimer';

	const FADE_TIMEOUT_MS = 2500;

	let currentIndex = $state(0);
	let controlsVisible = $state(true);
	let fadeTimer: InactivityFadeTimer | null = null;

	const savedArtworks = $derived(collectionStore.artworks);
	const hasArtworks = $derived(!collectionStore.loading && savedArtworks.length > 0);

	// Safe current artwork reference
	const currentArtwork = $derived(
		hasArtworks ? savedArtworks[Math.min(currentIndex, savedArtworks.length - 1)] : null
	);

	const preloadUrls = $derived.by<string[]>(() => {
		if (!hasArtworks) return [];
		const urls: string[] = [];
		if (currentIndex > 0 && savedArtworks[currentIndex - 1]?.modelUrl) {
			urls.push(savedArtworks[currentIndex - 1].modelUrl!);
		}
		if (currentIndex < savedArtworks.length - 1 && savedArtworks[currentIndex + 1]?.modelUrl) {
			urls.push(savedArtworks[currentIndex + 1].modelUrl!);
		}
		return urls;
	});

	function handleInteraction() {
		fadeTimer?.triggerInteraction();
	}

	function handlePrev() {
		if (currentIndex > 0) {
			currentIndex -= 1;
			fadeTimer?.reset();
		}
	}

	function handleNext() {
		if (currentIndex < savedArtworks.length - 1) {
			currentIndex += 1;
			fadeTimer?.reset();
		}
	}

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		if (params.get('demo') === '1') {
			await collectionStore.seedDemo();
		} else {
			await collectionStore.init();
		}

		fadeTimer = new InactivityFadeTimer({
			timeoutMs: FADE_TIMEOUT_MS,
			onFadeChange: (v) => {
				controlsVisible = v;
			}
		});
	});

	onDestroy(() => {
		fadeTimer?.dispose();
	});
</script>

<svelte:head>
	{#if currentArtwork}
		<title>{currentArtwork.title} by {currentArtwork.artistName} — artizART Collection</title>
	{:else}
		<title>Saved Collection — artizART</title>
	{/if}
</svelte:head>

<BrandBackground>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative flex flex-1 flex-col justify-between py-4"
		onpointerdown={handleInteraction}
	>
		<!-- Header / Logo -->
		<header class="flex w-full items-center justify-between pt-1">
			<a
				href="/"
				class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-opacity hover:opacity-80"
				aria-label="Back to Camera"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
				</svg>
			</a>

			<div class="flex-1 text-center pr-10">
				<Logo accent="light" size="md" />
			</div>
		</header>

		{#if collectionStore.loading}
			<!-- Loading State -->
			<div class="my-auto flex flex-col items-center justify-center">
				<div class="flex items-center gap-2.5 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-md">
					<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
					<span>Loading collection…</span>
				</div>
			</div>
		{:else if !hasArtworks}
			<!-- Empty State -->
			<main class="my-auto flex flex-col items-center justify-center px-4 text-center">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md">
					<svg class="h-8 w-8 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<rect x="3" y="3" width="18" height="18" rx="3" stroke-width="1.8" />
						<path d="M3 16l5-5 4 4 5-6 4 5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						<circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
					</svg>
				</div>
				<h2 class="font-display text-3xl font-bold uppercase tracking-tight text-white sm:text-4xl">
					No paintings saved yet
				</h2>
				<p class="mt-2 max-w-xs text-sm text-zinc-300">
					Scan a painting to save it here
				</p>
				<a
					href="/"
					class="mt-6 inline-flex items-center gap-2.5 rounded-full bg-white px-7 py-3 text-sm font-semibold text-black shadow-xl transition-transform active:scale-95"
				>
					<svg class="h-5 w-5 text-brand-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
					<span>Open Scanner</span>
				</a>
			</main>
		{:else if currentArtwork}
			<!-- 3D Interactive Model Stage with < and > controls (Mockup 1) -->
			<main class="relative my-auto flex h-[48dvh] w-full items-center justify-center">
				<!-- Prev Button (<): hidden if at the beginning (currentIndex === 0) -->
				{#if currentIndex > 0}
					<div
						class="absolute left-2 z-20 transition-opacity duration-300 {controlsVisible
							? 'opacity-100 pointer-events-auto'
							: 'opacity-0 pointer-events-none'}"
					>
						<CircularButton ariaLabel="Previous artwork" onclick={handlePrev} size="md">
							<span class="font-display text-xl font-bold text-zinc-800">&lt;</span>
						</CircularButton>
					</div>
				{/if}

				<!-- 3D Viewport with Draco / Pinch-to-zoom / Rotation / Fallback -->
				<div class="relative h-full w-full max-w-sm">
					<ModelViewer3D
						modelUrl={currentArtwork.modelUrl}
						thumbUrl={currentArtwork.thumbUrl}
						title={currentArtwork.title}
						{preloadUrls}
						onInteraction={handleInteraction}
					/>
				</div>

				<!-- Next Button (>): hidden if at the end (currentIndex === savedArtworks.length - 1) -->
				{#if currentIndex < savedArtworks.length - 1}
					<div
						class="absolute right-2 z-20 transition-opacity duration-300 {controlsVisible
							? 'opacity-100 pointer-events-auto'
							: 'opacity-0 pointer-events-none'}"
					>
						<CircularButton ariaLabel="Next artwork" onclick={handleNext} size="md">
							<span class="font-display text-xl font-bold text-zinc-800">&gt;</span>
						</CircularButton>
					</div>
				{/if}
			</main>

			<!-- Artwork Meta Info: Big condensed white title & grey artist below (Always Visible) -->
			<footer class="flex flex-col items-start px-3 pb-6">
				<h1 class="font-display text-5xl font-bold tracking-tight text-white sm:text-6xl">
					{currentArtwork.title}
				</h1>
				<p class="mt-1 font-display text-2xl font-semibold tracking-wide text-zinc-300 sm:text-3xl">
					by {currentArtwork.artistName}
				</p>
			</footer>
		{/if}
	</div>
</BrandBackground>
