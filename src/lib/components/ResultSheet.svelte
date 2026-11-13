<script lang="ts">
	import type { TrackerMode } from '#lib/ar/tracker';
	import type { HybridPhase } from '#lib/recognition/controller.svelte';
	import type {
		PairInfo,
		RotationDeg,
		ScannerStatus,
		SeamEvaluation,
		TrackedCanvas
	} from '#lib/types';

	interface Props {
		status: ScannerStatus;
		phase: HybridPhase;
		consecutiveMatches: number;
		lastConfidence: number;
		backendOnline: boolean;
		debugCornerDots: boolean;
		pair: PairInfo;
		canvasA: TrackedCanvas | null;
		canvasB: TrackedCanvas | null;
		seam: SeamEvaluation;
		trackerMode: TrackerMode;
		rigRotationA: RotationDeg;
		rigRotationB: RotationDeg;
		rigTrackA: boolean;
		rigTrackB: boolean;
		onRotateCanvas: (slot: 'A' | 'B') => void;
		onSetArrangement: (rotA: RotationDeg, rotB: RotationDeg) => void;
		onToggleCanvas: (slot: 'A' | 'B') => void;
		onSetTrackerMode: (mode: TrackerMode) => void;
		onToggleDebugDots: () => void;
	}

	let {
		status,
		phase,
		consecutiveMatches,
		lastConfidence,
		backendOnline,
		debugCornerDots,
		pair,
		canvasA,
		canvasB,
		seam,
		trackerMode,
		rigRotationA,
		rigRotationB,
		rigTrackA,
		rigTrackB,
		onRotateCanvas,
		onSetArrangement,
		onToggleCanvas,
		onSetTrackerMode,
		onToggleDebugDots
	}: Props = $props();

	let showControls = $state(true);

	const isSheetVisible = $derived(
		status === 'scanning' ||
			status === 'one_recognized' ||
			status === 'non_matching' ||
			status === 'valid_arrangement' ||
			status === 'tracking_lost' ||
			status === 'backend_unreachable'
	);

	const activePaintingTitle = $derived.by(() => {
		if (phase === 'recognizing') {
			return `Recognizing orientation (${consecutiveMatches}/3 consecutive frames)…`;
		}
		if (canvasA && canvasB) {
			return `${pair.paintingA.title} + ${pair.paintingB.title}`;
		}
		if (canvasA) return pair.paintingA.title;
		if (canvasB) return pair.paintingB.title;
		return 'Searching for paired canvases…';
	});
</script>

{#if isSheetVisible}
	<section
		aria-live="polite"
		class="fixed right-0 bottom-0 left-0 z-30 mx-auto max-w-xl px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out"
	>
		<div
			class="rounded-3xl border border-white/15 bg-zinc-950/90 p-4 text-white shadow-2xl backdrop-blur-xl"
		>
			<!-- Drag handle / collapse toggle -->
			<button
				type="button"
				onclick={() => (showControls = !showControls)}
				class="mx-auto mb-2.5 flex w-full items-center justify-between text-left"
			>
				<div class="flex items-center gap-2">
					<span class="text-[11px] font-semibold tracking-wider text-sky-400 uppercase">
						{pair.paintingA.artistName}
					</span>
					<span class="text-white/25">•</span>
					<span class="text-[11px] text-zinc-400">
						{#if phase === 'recognizing'}
							POST /api/recognize (500ms)
						{:else}
							On-Device Tracker ({Math.round(lastConfidence * 100)}% match)
						{/if}
					</span>
					<span
						class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold {backendOnline
							? 'bg-emerald-500/20 text-emerald-300'
							: 'bg-amber-500/20 text-amber-300'}"
					>
						{backendOnline ? 'API Online' : 'Local Fallback'}
					</span>
				</div>
				<span class="text-[11px] font-medium text-zinc-400 hover:text-white">
					{showControls ? 'Hide AR Rig ▾' : 'AR Rig Controls ▴'}
				</span>
			</button>

			<!-- Artist, Painting Title & Seam Badge -->
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 class="truncate text-base sm:text-lg font-bold leading-snug text-white">
						{activePaintingTitle}
					</h2>
					{#if phase === 'recognizing'}
						<p class="mt-0.5 text-xs text-sky-300">
							Verifying (painting_id, orientation) across 3 consecutive frames before tracker
							handover…
						</p>
					{:else if seam.bothTracked && seam.isValidMatch && seam.activeExperience}
						<p class="mt-0.5 text-xs font-medium text-emerald-300">
							{seam.activeExperience.title} — {seam.activeExperience.params.subtitle ??
								'Active shader blend across seam'}
						</p>
					{:else if seam.bothTracked && !seam.isValidMatch}
						<p class="mt-0.5 text-xs font-medium text-amber-300">
							Edges {seam.leftFacingEdge} &amp; {seam.rightFacingEdge} face the seam — rotate to match
							AA, BB, CC, or DD
						</p>
					{:else if status === 'one_recognized'}
						<p class="mt-0.5 text-xs text-sky-300">
							1 of 2 square canvases recognized — bring the companion canvas alongside it
						</p>
					{:else}
						<p class="mt-0.5 text-xs text-zinc-400">
							Align both square canvases side by side to trigger the seam experience
						</p>
					{/if}
				</div>

				{#if seam.bothTracked && phase === 'tracking'}
					<span
						class="shrink-0 rounded-full border px-3 py-1 text-xs font-bold tracking-wider {seam.isValidMatch
							? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
							: 'border-amber-400/40 bg-amber-500/20 text-amber-200'}"
					>
						Seam {seam.seamCode}
					</span>
				{/if}
			</div>

			{#if showControls}
				<div class="mt-3.5 border-t border-white/10 pt-3">
					<!-- Mode Switcher: Interactive AR Rig vs Camera CV -->
					<div class="mb-2.5 flex items-center justify-between gap-2">
						<div class="inline-flex rounded-xl border border-white/10 bg-zinc-900 p-0.5 text-xs">
							<button
								type="button"
								onclick={() => onSetTrackerMode('rig')}
								class="rounded-lg px-2.5 py-1 font-semibold transition {trackerMode === 'rig'
									? 'bg-white text-black'
									: 'text-zinc-400 hover:text-white'}"
							>
								Interactive AR Rig
							</button>
							<button
								type="button"
								onclick={() => onSetTrackerMode('camera_vision')}
								class="rounded-lg px-2.5 py-1 font-semibold transition {trackerMode ===
								'camera_vision'
									? 'bg-white text-black'
									: 'text-zinc-400 hover:text-white'}"
							>
								Live Camera Vision
							</button>
						</div>

						<div class="flex items-center gap-1.5 text-[11px]">
							<button
								type="button"
								onclick={onToggleDebugDots}
								class="rounded-lg border px-2 py-1 font-medium transition {debugCornerDots
									? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
									: 'border-white/10 bg-zinc-900 text-zinc-500'}"
							>
								Corner Dots: {debugCornerDots ? 'ON' : 'OFF'}
							</button>
							<button
								type="button"
								onclick={() => onToggleCanvas('A')}
								class="rounded-lg border px-2 py-1 font-medium transition {rigTrackA
									? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
									: 'border-white/10 bg-zinc-900 text-zinc-500'}"
							>
								Canvas A: {rigTrackA ? 'Tracked' : 'Hidden'}
							</button>
							<button
								type="button"
								onclick={() => onToggleCanvas('B')}
								class="rounded-lg border px-2 py-1 font-medium transition {rigTrackB
									? 'border-sky-400/40 bg-sky-500/15 text-sky-200'
									: 'border-white/10 bg-zinc-900 text-zinc-500'}"
							>
								Canvas B: {rigTrackB ? 'Tracked' : 'Hidden'}
							</button>
						</div>
					</div>

					<!-- 90-degree step rotation buttons for Canvas A & Canvas B -->
					<div class="grid grid-cols-2 gap-2">
						<button
							type="button"
							onclick={() => onRotateCanvas('A')}
							class="flex items-center justify-between rounded-xl border border-white/15 bg-zinc-900/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 active:scale-[0.98]"
						>
							<span>Rotate A ({rigRotationA}°)</span>
							<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-300">
								Edge {canvasA?.edges.right ?? '—'} →
							</span>
						</button>

						<button
							type="button"
							onclick={() => onRotateCanvas('B')}
							class="flex items-center justify-between rounded-xl border border-white/15 bg-zinc-900/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 active:scale-[0.98]"
						>
							<span class="rounded bg-sky-500/20 px-1.5 py-0.5 text-[11px] text-sky-300">
								← Edge {canvasB?.edges.left ?? '—'}
							</span>
							<span>Rotate B ({rigRotationB}°)</span>
						</button>
					</div>

					<!-- Quick presets for the 4 valid arrangements (AA, BB, CC, DD) + 1 non-matching -->
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						<span class="text-[11px] font-medium text-zinc-400">Presets (4/16 valid):</span>
						<button
							type="button"
							onclick={() => onSetArrangement(90, 270)}
							class="rounded-lg border px-2 py-1 text-[11px] font-bold transition {seam.seamCode ===
							'AA'
								? 'border-emerald-400 bg-emerald-500/25 text-emerald-200'
								: 'border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}"
						>
							AA (90°/270°)
						</button>
						<button
							type="button"
							onclick={() => onSetArrangement(0, 180)}
							class="rounded-lg border px-2 py-1 text-[11px] font-bold transition {seam.seamCode ===
							'BB'
								? 'border-emerald-400 bg-emerald-500/25 text-emerald-200'
								: 'border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}"
						>
							BB (0°/180°)
						</button>
						<button
							type="button"
							onclick={() => onSetArrangement(180, 0)}
							class="rounded-lg border px-2 py-1 text-[11px] font-bold transition {seam.seamCode ===
							'CC'
								? 'border-emerald-400 bg-emerald-500/25 text-emerald-200'
								: 'border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}"
						>
							CC (180°/0°)
						</button>
						<button
							type="button"
							onclick={() => onSetArrangement(270, 90)}
							class="rounded-lg border px-2 py-1 text-[11px] font-bold transition {seam.seamCode ===
							'DD'
								? 'border-emerald-400 bg-emerald-500/25 text-emerald-200'
								: 'border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}"
						>
							DD (270°/90°)
						</button>
						<button
							type="button"
							onclick={() => onSetArrangement(0, 0)}
							class="rounded-lg border px-2 py-1 text-[11px] font-medium transition {!seam.isValidMatch &&
							seam.bothTracked
								? 'border-amber-400 bg-amber-500/25 text-amber-200'
								: 'border-white/10 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}"
						>
							Mismatch BC (0°/0°)
						</button>
					</div>
				</div>
			{/if}
		</div>
	</section>
{/if}
