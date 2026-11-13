<script lang="ts">
	import { onDestroy } from 'svelte';
	import CameraView from '#lib/components/CameraView.svelte';
	import ResultSheet from '#lib/components/ResultSheet.svelte';
	import StatusMessage from '#lib/components/StatusMessage.svelte';
	import { ScannerController } from '#lib/state/scanner.svelte';

	const scanner = new ScannerController();
	let videoElement = $state<HTMLVideoElement | null>(null);

	const isCameraActive = $derived(
		scanner.status === 'scanning' ||
			scanner.status === 'recognized' ||
			scanner.status === 'backend_unreachable'
	);

	function handleStart() {
		if (!videoElement) return;
		void scanner.start(videoElement);
	}

	function handleStop() {
		scanner.stop();
	}

	function onVisibilityChange() {
		void scanner.handleVisibilityChange();
	}

	onDestroy(() => {
		scanner.stop();
	});
</script>

<svelte:document onvisibilitychange={onVisibilityChange} />

<main class="relative h-dvh w-screen overflow-hidden bg-black select-none">
	<CameraView bind:videoRef={videoElement} active={isCameraActive} />
	<StatusMessage status={scanner.status} errorMessage={scanner.errorMessage} onStart={handleStart} onStop={handleStop} />
	<ResultSheet painting={scanner.recognized} />
</main>
