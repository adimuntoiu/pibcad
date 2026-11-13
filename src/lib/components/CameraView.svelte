<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		videoRef?: HTMLVideoElement | null;
		active: boolean;
		children?: Snippet;
	}

	let { videoRef = $bindable(null), active, children }: Props = $props();
</script>

<div class="relative inset-0 h-dvh w-screen overflow-hidden bg-black">
	<video
		bind:this={videoRef}
		playsinline
		muted
		autoplay
		class="h-full w-full object-cover transition-opacity duration-300 {active
			? 'opacity-100'
			: 'opacity-0'}"
	></video>

	{#if active}
		<!-- Subtle top & bottom gradient for UI legibility over any camera feed -->
		<div
			class="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-black/60 via-transparent to-black/75"
		></div>
	{/if}

	<!-- AR Canvas overlay layer -->
	{#if children}
		{@render children()}
	{/if}
</div>
