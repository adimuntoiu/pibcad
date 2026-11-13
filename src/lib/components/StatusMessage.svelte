<script lang="ts">
	import type { HybridPhase } from '#lib/recognition/controller.svelte';
	import type { ScannerStatus, SeamEvaluation } from '#lib/types';

	interface Props {
		status: ScannerStatus;
		phase: HybridPhase;
		consecutiveMatches: number;
		backendOnline: boolean;
		seam: SeamEvaluation;
		errorMessage: string | null;
		onStart: () => void;
		onStop: () => void;
	}

	let {
		status,
		phase,
		consecutiveMatches,
		backendOnline,
		seam,
		errorMessage,
		onStart,
		onStop
	}: Props = $props();

	const isRunning = $derived(
		status === 'scanning' ||
			status === 'one_recognized' ||
			status === 'non_matching' ||
			status === 'valid_arrangement' ||
			status === 'tracking_lost' ||
			status === 'backend_unreachable'
	);
</script>

{#if isRunning}
	<header
		class="fixed top-0 right-0 left-0 z-30 flex items-center justify-between gap-2 px-4 pt-[max(0.85rem,env(safe-area-inset-top))] pb-2"
	>
		<div
			class="flex items-center gap-2.5 rounded-full border border-white/15 bg-zinc-950/80 px-4 py-2 text-xs sm:text-sm font-medium text-white shadow-lg backdrop-blur-xl"
		>
			{#if phase === 'recognizing'}
				<span class="h-2.5 w-2.5 animate-ping rounded-full bg-sky-400"></span>
				<span>
					{backendOnline ? 'FastAPI Recognition' : 'Recognition'} ({consecutiveMatches}/3 frames)…
				</span>
			{:else if status === 'valid_arrangement'}
				<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400"></span>
				<span>Seam {seam.seamCode} matched — on-device tracking</span>
			{:else if status === 'non_matching'}
				<span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
				<span>Seam {seam.leftFacingEdge} ↔ {seam.rightFacingEdge} (non-matching)</span>
			{:else if status === 'one_recognized'}
				<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400"></span>
				<span>1 canvas tracked — waiting for second canvas…</span>
			{:else if status === 'tracking_lost'}
				<span class="h-2.5 w-2.5 animate-ping rounded-full bg-amber-300"></span>
				<span>Tracking lost — returning to recognition…</span>
			{:else if status === 'backend_unreachable'}
				<span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
				<span>Backend unreachable — retrying…</span>
			{:else}
				<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400"></span>
				<span>Point camera at the pair of square canvases</span>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			<a
				href="/demo-targets/printable-pair.html"
				target="_blank"
				rel="noopener noreferrer"
				class="rounded-full border border-white/15 bg-zinc-950/80 px-3 py-2 text-xs font-semibold text-zinc-200 backdrop-blur-xl transition hover:bg-zinc-900 active:scale-95"
			>
				Targets
			</a>
			<button
				type="button"
				onclick={onStop}
				class="rounded-full border border-white/15 bg-zinc-950/80 px-3.5 py-2 text-xs font-semibold text-white/90 backdrop-blur-xl transition hover:bg-zinc-900 active:scale-95"
			>
				Close
			</button>
		</div>
	</header>

	<!-- Subtle center-top hint when both canvases are tracked in one of the 12 non-matching orientations -->
	{#if status === 'non_matching' && phase === 'tracking'}
		<div
			class="pointer-events-none fixed top-16 right-0 left-0 z-20 flex justify-center px-4 transition-opacity duration-300"
		>
			<div
				class="flex items-center gap-2.5 rounded-2xl border border-amber-400/35 bg-zinc-950/85 px-4 py-2.5 text-xs sm:text-sm font-medium text-amber-100 shadow-2xl backdrop-blur-xl"
			>
				<svg
					class="h-4 w-4 shrink-0 text-amber-300"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
				<span>Keep rotating to find the match (need AA, BB, CC, or DD)</span>
			</div>
		</div>
	{/if}
{/if}

{#if status === 'idle' || status === 'starting_camera' || status === 'permission_denied' || status === 'no_camera'}
	<div
		class="fixed inset-0 z-40 flex flex-col items-center justify-center bg-zinc-950/95 px-6 text-center"
	>
		<div
			class="w-full max-w-sm rounded-3xl border border-white/15 bg-zinc-900/90 p-7 shadow-2xl backdrop-blur-xl"
		>
			<div
				class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-500/10"
			>
				<svg
					class="h-8 w-8 text-emerald-300"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.8"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
					/>
				</svg>
			</div>

			<p class="text-xs font-semibold tracking-widest text-emerald-400 uppercase">
				Hybrid Recognition + AR
			</p>
			<h1 class="mt-1 text-2xl font-bold tracking-tight text-white">Equinox Diptych</h1>
			<p class="mt-2 text-sm leading-relaxed text-zinc-400">
				FastAPI identifies the painting &amp; 90° orientation over 3 consecutive frames, then hands
				over to 60fps on-device AR tracking across the seam (<span
					class="font-semibold text-zinc-200">AA, BB, CC, DD</span
				>).
			</p>

			{#if status === 'permission_denied' || status === 'no_camera'}
				<div
					class="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-left text-xs text-red-200"
				>
					<p class="font-semibold text-red-100">
						{status === 'permission_denied' ? 'Camera Permission Denied' : 'Camera Unavailable'}
					</p>
					<p class="mt-1 opacity-90">{errorMessage}</p>
				</div>
			{/if}

			<button
				type="button"
				disabled={status === 'starting_camera'}
				onclick={onStart}
				class="mt-6 w-full cursor-pointer rounded-2xl bg-white py-3.5 text-base font-semibold text-black shadow-lg transition hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-50"
			>
				{#if status === 'starting_camera'}
					Starting camera…
				{:else if status === 'permission_denied' || status === 'no_camera'}
					Try Again
				{:else}
					Start AR Scanner
				{/if}
			</button>

			<a
				href="/demo-targets/printable-pair.html"
				target="_blank"
				rel="noopener noreferrer"
				class="mt-3 inline-block text-xs font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-4 hover:text-zinc-200"
			>
				Open printable / second-screen target sheet
			</a>
		</div>
	</div>
{/if}
