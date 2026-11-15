<script lang="ts">
	import BrandBackground from '#lib/components/BrandBackground.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import PillButton from '#lib/components/PillButton.svelte';
	import CarouselCard from '#lib/components/CarouselCard.svelte';

	// Mock artist profile and galleries
	const artistName = 'SONIA';

	const activeGallery = {
		id: 'autumn-exhibit-2026',
		title: 'Autumn Horizons',
		artworks: [
			{
				title: 'Neon Sweep',
				image: '/brand/purple-waves.webp',
				model: '3D Ready'
			},
			{
				title: 'Trumpet of Turmoil',
				image: '/demo/irlo1.jpg',
				model: 'Meshy Generated'
			}
		]
	};

	const pastGalleries = [
		{ id: '1', title: 'Monolith Reflections', artworkCount: 4, date: 'Oct 2026' },
		{ id: '2', title: 'Equinox Inversions', artworkCount: 2, date: 'Sep 2026' }
	];
</script>

<svelte:head>
	<title>Artist Dashboard — artizART</title>
</svelte:head>

<BrandBackground>
	<div class="flex flex-1 flex-col items-center py-4">
		<!-- Header / Logo -->
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

			<div class="flex-1 text-center pr-10">
				<Logo accent="light" size="md" />
			</div>
		</header>

		<!-- Welcome & Action Button -->
		<div class="mt-6 flex w-full flex-col items-start px-2">
			<h1 class="font-display text-4xl font-bold uppercase tracking-tight text-white sm:text-5xl">
				Welcome, {artistName}
			</h1>

			<div class="mt-4 w-full">
				<PillButton variant="white" class="w-full sm:w-auto" href="/artist/galleries/new">
					CREATE A GALLERY
				</PillButton>
			</div>
		</div>

		<!-- Featured Gallery Carousel Card -->
		<div class="mt-6 w-full px-2">
			<CarouselCard class="w-full max-w-none">
				<div class="flex h-full w-full flex-col items-center justify-center text-center p-6">
					<div class="flex h-20 w-20 items-center justify-center rounded-3xl bg-zinc-300/80 text-zinc-600 shadow-inner">
						<svg class="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
						</svg>
					</div>
					<h3 class="mt-4 font-display text-2xl font-bold tracking-tight text-zinc-800">
						{activeGallery.title}
					</h3>
					<p class="mt-1 font-sans text-sm font-semibold text-zinc-600">
						{activeGallery.artworks.length} artworks · Swipeable carousel
					</p>
				</div>
			</CarouselCard>
		</div>

		<!-- Past Galleries Section (Scrollable) -->
		<div class="mt-8 flex w-full flex-col items-start px-2 pb-6">
			<h2 class="font-display text-2xl font-bold tracking-tight text-white">
				Earlier Galleries
			</h2>

			<div class="mt-3 flex w-full flex-col gap-2.5">
				{#each pastGalleries as g (g.id)}
					<div
						class="flex w-full items-center justify-between rounded-2xl bg-white/10 px-5 py-3.5 backdrop-blur-md transition-colors hover:bg-white/15"
					>
						<div>
							<h3 class="font-display text-lg font-bold text-white">{g.title}</h3>
							<p class="font-sans text-xs text-purple-200/70">{g.artworkCount} artworks · {g.date}</p>
						</div>
						<span class="font-sans text-sm font-bold text-white">→</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
</BrandBackground>
