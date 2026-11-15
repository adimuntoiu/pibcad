<script lang="ts">
	import type { GalleryWithArtworks, GalleryArtwork } from '#lib/gallery/galleryService';
	import { webglCoordinator } from '#lib/gallery/webglCoordinator.svelte';
	import ModelViewer3D from '#lib/components/ModelViewer3D.svelte';

	interface Props {
		gallery: GalleryWithArtworks;
		onEdit?: (gallery: GalleryWithArtworks) => void;
		onDelete?: (gallery: GalleryWithArtworks) => void;
		onGenerate3D?: (artwork: GalleryArtwork, gallery: GalleryWithArtworks) => void;
	}

	let { gallery, onEdit, onDelete, onGenerate3D }: Props = $props();

	let activeSlideIndex = $state(0);

	function handleSlideScroll(e: Event) {
		const target = e.currentTarget as HTMLElement;
		const slideWidth = target.clientWidth || 1;
		const index = Math.round(target.scrollLeft / slideWidth);
		if (index !== activeSlideIndex && index >= 0 && index < gallery.artworks.length) {
			activeSlideIndex = index;
		}
	}
</script>

<div class="relative flex w-full flex-col overflow-hidden rounded-[2.25rem] bg-[#D9D9D9] p-5 shadow-xl transition-all">
	<!-- Gallery Header: Title, Status Badge, & Edit/Delete Actions -->
	<div class="flex items-start justify-between gap-3 border-b border-black/10 pb-3">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<h2 class="truncate font-display text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
					{gallery.title}
				</h2>
				<span
					class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {gallery.status === 'published'
						? 'bg-emerald-600/15 text-emerald-800'
						: 'bg-zinc-800/15 text-zinc-700'}"
				>
					{gallery.status}
				</span>
			</div>
			{#if gallery.description}
				<p class="mt-0.5 line-clamp-1 font-sans text-xs text-zinc-600">
					{gallery.description}
				</p>
			{/if}
		</div>

		<div class="flex shrink-0 items-center gap-1.5">
			{#if onEdit}
				<a
					href="/artist/galleries/{gallery.id}/edit"
					class="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-zinc-800 shadow-sm transition-colors hover:bg-white active:scale-95"
				>
					Edit
				</a>
			{/if}
			{#if onDelete}
				<button
					type="button"
					onclick={() => onDelete(gallery)}
					class="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-500/25 active:scale-95"
				>
					Delete
				</button>
			{/if}
		</div>
	</div>

	<!-- Swipeable Carousel (CSS scroll-snap) -->
	{#if gallery.artworks.length > 0}
		<div
			class="relative mt-3 flex w-full overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
			onscroll={handleSlideScroll}
			style="scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;"
		>
			{#each gallery.artworks as art, idx (`${gallery.id}-art-${art.id || idx}`)}
				{@const slideId = `${gallery.id}-slide-${art.id || idx}`}
				{@const is3dActive = webglCoordinator.isActive(slideId)}

				<div class="flex w-full shrink-0 snap-center flex-col items-center justify-center py-2 px-1">
					<div class="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl bg-zinc-200/90 shadow-inner sm:max-w-[320px]">
						{#if art.model_path}
							<!-- Model Slide: Active WebGL Canvas or Static Poster -->
							{#if is3dActive}
								<div class="h-full w-full">
									<ModelViewer3D
										modelUrl={art.model_path}
										thumbUrl={art.model_poster_path || art.thumb_path}
										title={art.title}
									/>
								</div>
							{:else}
								<button
									type="button"
									onclick={() => webglCoordinator.activate(slideId)}
									class="group relative flex h-full w-full items-center justify-center cursor-pointer"
									aria-label="Activate interactive 3D model"
								>
									<img
										src={art.model_poster_path || art.thumb_path || art.image_path}
										alt={art.title}
										class="max-h-[85%] max-w-[85%] object-contain transition-transform group-hover:scale-105"
									/>
									<div class="absolute bottom-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white shadow backdrop-blur-md transition-opacity group-hover:bg-black/80">
										<svg class="h-3.5 w-3.5 text-brand-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
										</svg>
										<span>Tap to view 3D</span>
									</div>
								</button>
							{/if}
						{:else}
							<!-- 2D Painting Slide -->
							<img
								src={art.image_path}
								alt={art.title}
								class="max-h-[90%] max-w-[90%] rounded-xl object-contain shadow-md"
							/>
							{#if onGenerate3D}
								<button
									type="button"
									onclick={() => onGenerate3D?.(art, gallery)}
									class="absolute bottom-3 flex items-center gap-1.5 rounded-full bg-brand-purple/90 px-3 py-1 text-[11px] font-semibold text-white shadow backdrop-blur-md transition-all hover:bg-brand-purple active:scale-95 cursor-pointer"
								>
									<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
									</svg>
									<span>Generate 3D</span>
								</button>
							{/if}
						{/if}
					</div>

					<!-- Artwork Meta -->
					<div class="mt-2.5 text-center">
						<p class="font-display text-lg font-bold text-zinc-900">{art.title}</p>
						<p class="font-sans text-xs font-semibold text-zinc-600">by {art.artist_name}</p>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination Dots -->
		{#if gallery.artworks.length > 1}
			<div class="mt-2 flex items-center justify-center gap-1.5">
				{#each gallery.artworks as _, idx}
					<span
						class="h-1.5 rounded-full transition-all {idx === activeSlideIndex
							? 'w-4 bg-zinc-800'
							: 'w-1.5 bg-zinc-400'}"
					></span>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="my-8 text-center text-sm font-medium text-zinc-500">
			No artworks in this gallery yet.
		</div>
	{/if}
</div>
