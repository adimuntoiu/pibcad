<script lang="ts">
	import { onDestroy } from 'svelte';
	import CameraView from '#lib/components/CameraView.svelte';
	import ResultSheet from '#lib/components/ResultSheet.svelte';
	import StatusMessage from '#lib/components/StatusMessage.svelte';
	import ExperienceSwitch from '#lib/experiences/ExperienceSwitch.svelte';
	import { HybridScannerController } from '#lib/recognition/controller.svelte';

	const scanner = new HybridScannerController();
	let videoElement = $state<HTMLVideoElement | null>(null);
	let debugCornerDots = $state<boolean>(true);

	const isCameraActive = $derived(
		scanner.status === 'scanning' ||
			scanner.status === 'one_recognized' ||
			scanner.status === 'non_matching' ||
			scanner.status === 'valid_arrangement' ||
			scanner.status === 'tracking_lost' ||
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
	<CameraView bind:videoRef={videoElement} active={isCameraActive}>
		<ExperienceSwitch
			active={isCameraActive}
			pair={scanner.pair}
			canvasA={scanner.canvasA}
			canvasB={scanner.canvasB}
			seam={scanner.seam}
			showRigCanvases={scanner.trackerMode === 'rig'}
			{debugCornerDots}
		/>
	</CameraView>

	<StatusMessage
		status={scanner.status}
		phase={scanner.phase}
		consecutiveMatches={scanner.consecutiveMatches}
		backendOnline={scanner.backendOnline}
		seam={scanner.seam}
		errorMessage={scanner.errorMessage}
		onStart={handleStart}
		onStop={handleStop}
	/>

	<ResultSheet
		status={scanner.status}
		phase={scanner.phase}
		consecutiveMatches={scanner.consecutiveMatches}
		lastConfidence={scanner.lastConfidence}
		backendOnline={scanner.backendOnline}
		{debugCornerDots}
		pair={scanner.pair}
		canvasA={scanner.canvasA}
		canvasB={scanner.canvasB}
		seam={scanner.seam}
		trackerMode={scanner.trackerMode}
		rigRotationA={scanner.rigRotationA}
		rigRotationB={scanner.rigRotationB}
		rigTrackA={scanner.rigTrackA}
		rigTrackB={scanner.rigTrackB}
		onRotateCanvas={(slot) => scanner.rotateCanvas(slot)}
		onSetArrangement={(rotA, rotB) => scanner.setArrangement(rotA, rotB)}
		onToggleCanvas={(slot) => scanner.toggleCanvasPresence(slot)}
		onSetTrackerMode={(mode) => scanner.setTrackerMode(mode)}
		onToggleDebugDots={() => (debugCornerDots = !debugCornerDots)}
	/>
</main>
