<script lang="ts">
	import { generate3D } from '#lib/services/generate3d';
	import type { RecognizedPainting } from '#lib/state/scanner.svelte';

	interface Props {
		painting: RecognizedPainting | null;
	}

	let { painting }: Props = $props();

	let isGenerating3D = $state(false);
	let comingSoonToast = $state<string | null>(null);

	$effect(() => {
		if (!painting) {
			comingSoonToast = null;
			isGenerating3D = false;
		}
	});

	async function handleGenerate3D() {
		if (!painting || isGenerating3D) return;
		isGenerating3D = true;
		comingSoonToast = null;
		try {
			const imageUrl = '/api/paintings/' + encodeURIComponent(painting.id);
			const res = await generate3D(painting.id, imageUrl);
			if (res.status === 'mock') {
				comingSoonToast = '3D model generation is coming soon!';
			}
		} finally {
			isGenerating3D = false;
		}
	}
</script>

{#if painting}
	<section aria-live="polite" class="fixed right-0 bottom-0 left-0 z-30 mx-auto max-w-lg px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out">
		<div class="rounded-3xl border border-white/15 bg-zinc-950/90 p-5 text-white shadow-2xl backdrop-blur-xl">
			<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25"></div>
			<div class="flex items-start justify-between gap-3">
				<div>
					<p class="text-xs font-semibold tracking-wider text-sky-400 uppercase">{painting.artist}</p>
					<h2 class="mt-1 text-2xl font-bold leading-tight text-white">{painting.title}</h2>
				</div>
				<span class="shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-zinc-200">
					{Math.round(painting.confidence * 100)}% match
				</span>
			</div>
			{#if comingSoonToast}
				<div class="mt-3 rounded-xl border border-sky-400/30 bg-sky-500/15 px-3.5 py-2.5 text-xs font-medium text-sky-200">
					{comingSoonToast}
				</div>
			{/if}
			<div class="mt-5">
				<button type="button" disabled={isGenerating3D} onclick={handleGenerate3D} class="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-black shadow-md transition active:scale-[0.98] disabled:opacity-60">
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
					</svg>
					{isGenerating3D ? 'Preparing 3D preview…' : 'Generate 3D model'}
				</button>
			</div>
		</div>
	</section>
{/if}
