<script lang="ts">
	import { onDestroy } from 'svelte';
	import ModelViewer3D from '#lib/components/ModelViewer3D.svelte';
	import PillButton from '#lib/components/PillButton.svelte';

	interface Props {
		isOpen: boolean;
		artworkTitle: string;
		imageUrl: string;
		artworkId?: string;
		onAccept: (result: { modelUrl: string; posterUrl: string }) => void;
		onDiscard: () => void;
		onClose: () => void;
	}

	let {
		isOpen,
		artworkTitle,
		imageUrl,
		artworkId,
		onAccept,
		onDiscard,
		onClose
	}: Props = $props();

	type ModalStep = 'confirm' | 'generating' | 'review' | 'error';
	let step = $state<ModalStep>('confirm');

	let jobId = $state<string | null>(null);
	let progress = $state(0);
	let generatedModelUrl = $state<string | null>(null);
	let generatedPosterUrl = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);
	let retryCount = $state(0);

	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollStartTime = 0;
	const TIMEOUT_MS = 180000; // 3 minutes timeout

	function resetState() {
		stopPolling();
		step = 'confirm';
		jobId = null;
		progress = 0;
		generatedModelUrl = null;
		generatedPosterUrl = null;
		errorMessage = null;
		retryCount = 0;
	}

	function stopPolling() {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	onDestroy(() => {
		stopPolling();
	});

	async function startGeneration() {
		step = 'generating';
		progress = 5;
		errorMessage = null;

		try {
			const res = await fetch('/api/meshy/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					artworkId,
					imageUrl,
					title: artworkTitle
				})
			});

			const data = await res.json();
			if (!res.ok) {
				step = 'error';
				errorMessage = data.error || 'Failed to start 3D model generation.';
				return;
			}

			jobId = data.jobId;
			pollStartTime = Date.now();
			scheduleNextPoll();
		} catch (err: unknown) {
			step = 'error';
			errorMessage = err instanceof Error ? err.message : 'Network error starting generation.';
		}
	}

	function scheduleNextPoll() {
		stopPolling();
		pollTimer = setTimeout(pollStatus, 2500);
	}

	async function pollStatus() {
		if (!jobId) return;

		// Check for timeout
		if (Date.now() - pollStartTime > TIMEOUT_MS) {
			step = 'error';
			errorMessage = 'Generation timed out after 3 minutes. Please retry or try a simpler image.';
			return;
		}

		try {
			const res = await fetch(`/api/meshy/status/${jobId}`);
			const data = await res.json();

			if (!res.ok) {
				step = 'error';
				errorMessage = data.error || 'Failed to check generation progress.';
				return;
			}

			progress = typeof data.progress === 'number' ? data.progress : progress;

			if (data.status === 'SUCCEEDED') {
				progress = 100;
				generatedModelUrl = data.modelUrl;
				generatedPosterUrl = data.posterUrl;
				step = 'review';
				return;
			}

			if (data.status === 'FAILED' || data.status === 'EXPIRED') {
				step = 'error';
				errorMessage = data.error || 'Meshy 3D generation failed.';
				return;
			}

			// Still in progress, continue polling
			scheduleNextPoll();
		} catch (err: unknown) {
			console.warn('Poll error, retrying in 3s:', err);
			scheduleNextPoll();
		}
	}

	async function handleAccept() {
		if (!generatedModelUrl || !jobId) return;

		try {
			await fetch('/api/meshy/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'accept',
					jobId,
					artworkId,
					modelUrl: generatedModelUrl,
					posterUrl: generatedPosterUrl
				})
			});

			onAccept({
				modelUrl: generatedModelUrl,
				posterUrl: generatedPosterUrl || imageUrl
			});
			handleClose();
		} catch (err) {
			console.error('Accept error:', err);
		}
	}

	async function handleDiscard() {
		if (jobId) {
			try {
				await fetch('/api/meshy/action', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'discard',
						jobId
					})
				});
			} catch {
				// ignore
			}
		}
		onDiscard();
		handleClose();
	}

	async function handleRegenerate() {
		if (!jobId) return;
		step = 'generating';
		progress = 5;
		errorMessage = null;

		try {
			const res = await fetch('/api/meshy/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'regenerate',
					jobId,
					artworkId,
					imageUrl,
					retryCount
				})
			});

			const data = await res.json();
			if (!res.ok) {
				step = 'error';
				errorMessage = data.error || 'Could not restart generation.';
				return;
			}

			jobId = data.jobId;
			retryCount = data.retryCount ?? retryCount + 1;
			pollStartTime = Date.now();
			scheduleNextPoll();
		} catch (err: unknown) {
			step = 'error';
			errorMessage = err instanceof Error ? err.message : 'Error regenerating model.';
		}
	}

	function handleClose() {
		resetState();
		onClose();
	}

	const stageDescription = $derived.by(() => {
		if (progress < 30) return 'Analyzing painting geometry & contours...';
		if (progress < 70) return 'Constructing 3D depth & polygon mesh...';
		if (progress < 99) return 'Synthesizing PBR textures & materials...';
		return 'Finalizing mobile-optimized GLB...';
	});
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative flex w-full max-w-md flex-col overflow-hidden rounded-[2.25rem] bg-zinc-900 p-6 text-white shadow-2xl border border-white/20"
		>
			<!-- Close 'X' button -->
			{#if step !== 'generating'}
				<button
					type="button"
					onclick={handleClose}
					class="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white"
					aria-label="Close modal"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			{/if}

			<!-- Step 1: Confirmation Dialog -->
			{#if step === 'confirm'}
				<div class="flex flex-col items-center text-center">
					<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-purple/30 text-purple-300 mb-4 border border-brand-purple/40">
						<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
						</svg>
					</div>

					<h3 class="font-display text-2xl font-bold uppercase tracking-tight text-white">
						Generate 3D Model?
					</h3>
					<p class="mt-2 font-sans text-xs text-zinc-300">
						Construct a full 3D AR model from <strong class="text-white">"{artworkTitle}"</strong> using Meshy AI.
					</p>

					<div class="mt-3 my-4 flex items-center gap-3 rounded-2xl bg-black/40 p-3 w-full border border-white/10">
						<img
							src={imageUrl}
							alt={artworkTitle}
							class="h-16 w-16 rounded-xl object-contain bg-zinc-800"
						/>
						<div class="text-left">
							<p class="font-display text-sm font-bold text-white truncate max-w-[200px]">{artworkTitle}</p>
							<p class="font-sans text-[11px] text-emerald-400 font-semibold">1 Credit Required</p>
							<p class="font-sans text-[10px] text-zinc-400">Takes ~60–90 seconds</p>
						</div>
					</div>

					<p class="font-sans text-[11px] text-zinc-400 mb-5">
						Once generated, you can rotate the model in 3D, and choose to accept, regenerate, or discard.
					</p>

					<div class="flex w-full gap-3">
						<button
							type="button"
							onclick={handleClose}
							class="flex-1 rounded-full bg-white/10 py-3 font-display text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/20"
						>
							Cancel
						</button>
						<PillButton
							variant="purple"
							onclick={startGeneration}
							class="flex-1 text-center justify-center py-3 text-xs"
						>
							Generate Now
						</PillButton>
					</div>
				</div>

			<!-- Step 2: Generating & Progress Bar -->
			{:else if step === 'generating'}
				<div class="flex flex-col items-center text-center py-4">
					<div class="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-purple/20 border border-brand-purple/40">
						<svg class="h-10 w-10 animate-spin text-brand-purple" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
						</svg>
						<span class="absolute text-xs font-bold text-white">{progress}%</span>
					</div>

					<h3 class="mt-5 font-display text-2xl font-bold uppercase tracking-tight text-white">
						Synthesizing 3D Model
					</h3>
					<p class="mt-1 font-sans text-xs text-purple-300 font-medium">
						{stageDescription}
					</p>

					<!-- Progress bar -->
					<div class="mt-6 w-full rounded-full bg-white/10 p-1 border border-white/10">
						<div
							class="h-2.5 rounded-full bg-gradient-to-r from-purple-500 to-brand-purple transition-all duration-500"
							style="width: {Math.max(5, progress)}%"
						></div>
					</div>

					<p class="mt-4 text-[11px] text-zinc-400">
						Meshy neural pipeline is generating mobile-optimized polygons & textures. Please leave this window open.
					</p>

					<button
						type="button"
						onclick={() => {
							stopPolling();
							step = 'confirm';
						}}
						class="mt-6 text-xs text-zinc-400 underline hover:text-white"
					>
						Cancel generation
					</button>
				</div>

			<!-- Step 3: Review Preview & Accept / Discard / Regenerate -->
			{:else if step === 'review' && generatedModelUrl}
				<div class="flex flex-col items-center text-center">
					<h3 class="font-display text-2xl font-bold uppercase tracking-tight text-white mb-1">
						3D Model Ready
					</h3>
					<p class="font-sans text-xs text-zinc-300 mb-3">
						Touch and drag to rotate the generated 3D geometry.
					</p>

					<!-- 3D Preview Canvas -->
					<div class="relative aspect-square w-full max-w-[260px] overflow-hidden rounded-2xl bg-zinc-800/80 border border-white/15 shadow-inner">
						<ModelViewer3D
							modelUrl={generatedModelUrl}
							thumbUrl={generatedPosterUrl || imageUrl}
							title={artworkTitle}
						/>
					</div>

					<div class="mt-5 flex w-full flex-col gap-2.5">
						<PillButton
							variant="purple"
							onclick={handleAccept}
							class="w-full text-center justify-center py-3.5 text-sm"
						>
							ACCEPT 3D MODEL
						</PillButton>

						<div class="flex w-full gap-2">
							<button
								type="button"
								onclick={handleRegenerate}
								disabled={retryCount >= 3}
								class="flex-1 rounded-full bg-white/10 py-2.5 font-display text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/20 disabled:opacity-40"
							>
								Regenerate ({retryCount}/3)
							</button>
							<button
								type="button"
								onclick={handleDiscard}
								class="flex-1 rounded-full bg-rose-500/20 py-2.5 font-display text-[11px] font-bold uppercase tracking-wider text-rose-300 transition-colors hover:bg-rose-500/30"
							>
								Discard Model
							</button>
						</div>
					</div>
				</div>

			<!-- Step 4: Error State -->
			{:else if step === 'error'}
				<div class="flex flex-col items-center text-center py-2">
					<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 mb-3 border border-rose-500/30">
						<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
					</div>

					<h3 class="font-display text-2xl font-bold uppercase tracking-tight text-white">
						Generation Failed
					</h3>
					<p class="mt-2 font-sans text-xs text-rose-200 bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 w-full">
						{errorMessage || 'An error occurred during 3D model construction.'}
					</p>

					<div class="mt-6 flex w-full gap-3">
						<button
							type="button"
							onclick={handleClose}
							class="flex-1 rounded-full bg-white/10 py-3 font-display text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/20"
						>
							Close
						</button>
						<button
							type="button"
							onclick={startGeneration}
							class="flex-1 rounded-full bg-brand-purple py-3 font-display text-xs font-bold uppercase tracking-wider text-white transition-colors hover:opacity-90"
						>
							Retry
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
