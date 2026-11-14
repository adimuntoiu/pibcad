<script lang="ts">
	import { onDestroy } from 'svelte';
	import CornerOverlay from '#lib/CornerOverlay.svelte';
	import { PaintingScanner } from '#lib/recognition/scanner.svelte';

	const scanner = new PaintingScanner();

	let video = $state<HTMLVideoElement | null>(null);
	let boxWidth = $state(0);
	let boxHeight = $state(0);
	let videoWidth = $state(0);
	let videoHeight = $state(0);

	const running = $derived(
		scanner.status === 'scanning' ||
			scanner.status === 'detected' ||
			scanner.status === 'backend_unreachable'
	);

	function syncVideoSize() {
		if (!video) return;
		videoWidth = video.videoWidth;
		videoHeight = video.videoHeight;
	}

	function onVisibilityChange() {
		if (document.hidden) scanner.stop();
		else void scanner.resumeVideo();
	}

	onDestroy(() => scanner.stop());
</script>

<svelte:document onvisibilitychange={onVisibilityChange} />

<main
	class="relative h-dvh w-screen overflow-hidden bg-black select-none"
	bind:clientWidth={boxWidth}
	bind:clientHeight={boxHeight}
>
	<video
		bind:this={video}
		playsinline
		muted
		autoplay
		onloadedmetadata={syncVideoSize}
		onresize={syncVideoSize}
		class="h-full w-full object-cover {running ? 'opacity-100' : 'opacity-0'}"
	></video>

	<CornerOverlay
		corners={scanner.corners}
		{videoWidth}
		{videoHeight}
		width={boxWidth}
		height={boxHeight}
	/>

	{#if running}
		<header
			class="fixed top-0 right-0 left-0 z-30 flex items-center justify-between gap-2 px-4 pt-[max(0.85rem,env(safe-area-inset-top))]"
		>
			<div
				class="flex items-center gap-2.5 rounded-full border border-white/15 bg-zinc-950/80 px-4 py-2 text-sm font-medium text-white backdrop-blur-xl"
			>
				{#if scanner.status === 'detected'}
					<span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
					<span>Painting detected</span>
				{:else if scanner.status === 'backend_unreachable'}
					<span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
					<span>Backend unreachable — retrying…</span>
				{:else}
					<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400"></span>
					<span>Point the camera at a painting</span>
				{/if}
			</div>
			<button
				type="button"
				onclick={() => scanner.stop()}
				class="rounded-full border border-white/15 bg-zinc-950/80 px-3.5 py-2 text-xs font-semibold text-white/90 backdrop-blur-xl active:scale-95"
			>
				Close
			</button>
		</header>

		{#if scanner.title}
			<section
				class="fixed right-0 bottom-0 left-0 z-30 mx-auto max-w-xl px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]"
			>
				<div class="rounded-3xl border border-white/15 bg-zinc-950/90 p-4 backdrop-blur-xl">
					<p class="text-[11px] font-semibold tracking-wider text-sky-400 uppercase">
						{scanner.artist}
					</p>
					<h2 class="text-lg font-bold text-white">{scanner.title}</h2>
				</div>
			</section>
		{/if}
	{:else}
		<div class="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950 px-6 text-center">
			<div class="w-full max-w-sm rounded-3xl border border-white/15 bg-zinc-900 p-7">
				<h1 class="text-2xl font-bold text-white">Painting scanner</h1>
				<p class="mt-2 text-sm text-zinc-400">
					Point your camera at one of the demo paintings. Dots appear on its corners when it is
					found.
				</p>

				{#if scanner.status === 'permission_denied' || scanner.status === 'no_camera'}
					<div
						class="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-left text-xs text-red-200"
					>
						<p class="font-semibold text-red-100">
							{scanner.status === 'permission_denied'
								? 'Camera permission denied'
								: 'Camera unavailable'}
						</p>
						<p class="mt-1">{scanner.errorMessage}</p>
					</div>
				{/if}

				<button
					type="button"
					disabled={scanner.status === 'starting_camera'}
					onclick={() => video && scanner.start(video)}
					class="mt-6 w-full rounded-2xl bg-white py-3.5 text-base font-semibold text-black active:scale-[0.98] disabled:opacity-50"
				>
					{scanner.status === 'starting_camera' ? 'Starting camera…' : 'Start'}
				</button>
			</div>
		</div>
	{/if}
</main>
