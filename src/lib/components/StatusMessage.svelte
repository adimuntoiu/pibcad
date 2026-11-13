<script lang="ts">
	import type { ScannerStatus } from '$lib/types';

	interface Props {
		status: ScannerStatus;
		errorMessage: string | null;
		onStart: () => void;
		onStop: () => void;
	}

	let { status, errorMessage, onStart, onStop }: Props = $props();
</script>

{#if status === 'scanning' || status === 'recognized' || status === 'backend_unreachable'}
	<header class="fixed top-0 right-0 left-0 z-20 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
		<div class="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-md">
			{#if status === 'scanning'}
				<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400"></span>
				<span>Point the camera at a painting</span>
			{:else if status === 'recognized'}
				<span class="h-2.5 w-2.5 rounded-full bg-sky-400"></span>
				<span>Painting recognized</span>
			{:else if status === 'backend_unreachable'}
				<span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
				<span>Backend unreachable — retrying…</span>
			{/if}
		</div>
		<button type="button" onclick={onStop} class="rounded-full border border-white/15 bg-black/70 px-3.5 py-2 text-xs font-semibold text-white/90 backdrop-blur-md active:scale-95">
			Close
		</button>
	</header>
{/if}

{#if status === 'idle' || status === 'starting_camera' || status === 'permission_denied' || status === 'no_camera'}
	<div class="fixed inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/95 px-6 text-center">
		<div class="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900/90 p-7 shadow-2xl backdrop-blur-xl">
			<div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
				<svg class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
			</div>
			<h1 class="text-2xl font-bold tracking-tight text-white">ArtLens Scanner</h1>
			<p class="mt-2 text-sm leading-relaxed text-zinc-400">
				Instantly identify paintings in real time using your phone camera.
			</p>
			{#if status === 'permission_denied' || status === 'no_camera'}
				<div class="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-left text-xs text-red-200">
					<p class="font-semibold text-red-100">
						{status === 'permission_denied' ? 'Camera Permission Denied' : 'Camera Unavailable'}
					</p>
					<p class="mt-1 opacity-90">{errorMessage}</p>
				</div>
			{/if}
			<button type="button" disabled={status === 'starting_camera'} onclick={onStart} class="mt-6 w-full rounded-2xl bg-white py-3.5 text-base font-semibold text-black shadow-lg transition active:scale-[0.98] disabled:opacity-50">
				{#if status === 'starting_camera'}
					Starting camera…
				{:else if status === 'permission_denied' || status === 'no_camera'}
					Try Again
				{:else}
					Start scanning
				{/if}
			</button>
		</div>
	</div>
{/if}
