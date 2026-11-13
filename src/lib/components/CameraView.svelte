<script lang="ts">
	interface Props {
		videoRef?: HTMLVideoElement | null;
		active: boolean;
	}

	let { videoRef = $bindable(null), active }: Props = $props();
</script>

<div class="relative inset-0 h-dvh w-screen overflow-hidden bg-black">
	<video
		bind:this={videoRef}
		playsinline
		webkit-playsinline="true"
		muted
		autoplay
		class="h-full w-full object-cover transition-opacity duration-300 {active ? 'opacity-100' : 'opacity-0'}"
	></video>

	{#if active}
		<div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60"></div>
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-10">
			<div class="relative aspect-[3/4] w-full max-w-xs">
				<div class="absolute top-0 left-0 h-7 w-7 rounded-tl-xl border-t-2 border-l-2 border-white/60"></div>
				<div class="absolute top-0 right-0 h-7 w-7 rounded-tr-xl border-t-2 border-r-2 border-white/60"></div>
				<div class="absolute bottom-0 left-0 h-7 w-7 rounded-bl-xl border-b-2 border-l-2 border-white/60"></div>
				<div class="absolute bottom-0 right-0 h-7 w-7 rounded-br-xl border-b-2 border-r-2 border-white/60"></div>
			</div>
		</div>
	{/if}
</div>
