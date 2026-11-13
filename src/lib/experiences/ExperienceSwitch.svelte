<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import type { PairInfo, SeamEvaluation, TrackedCanvas } from '#lib/types';

	interface Props {
		active: boolean;
		pair: PairInfo;
		canvasA: TrackedCanvas | null;
		canvasB: TrackedCanvas | null;
		seam: SeamEvaluation;
		showRigCanvases: boolean;
		debugCornerDots?: boolean;
	}

	let { active, pair, canvasA, canvasB, seam, showRigCanvases, debugCornerDots = true }: Props = $props();

	let ArCanvasComponent = $state<Component<Props> | null>(null);

	onMount(async () => {
		const mod = await import('#lib/ar/ArCanvas.svelte');
		ArCanvasComponent = mod.default;
	});
</script>

{#if ArCanvasComponent}
	<ArCanvasComponent {active} {pair} {canvasA} {canvasB} {seam} {showRigCanvases} {debugCornerDots} />
{/if}
