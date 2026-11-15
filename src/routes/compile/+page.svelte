<script lang="ts">
	import { onMount } from 'svelte';
	import { StaticManifestRepository, getRotatedEdgeLabels } from '#lib/manifest/repository';
	import type { ArtManifest } from '#lib/manifest/types';

	let manifest = $state<ArtManifest | null>(null);
	let error = $state<string | null>(null);
	let rotations = $state<Record<string, number>>({ irlo1: 0, irlo2: 0 });
	let isSwapped = $state(false);
	let compiledStatus = $state<string | null>(null);

	const repo = new StaticManifestRepository('/demo/manifest.json');

	onMount(async () => {
		try {
			manifest = await repo.loadManifest();
		} catch (e) {
			error = String(e);
		}
	});

	function rotateCanvas(id: string) {
		rotations[id] = ((rotations[id] ?? 0) + 90) % 360;
	}

	function setPreset(kind: 'AA' | 'BB' | 'CC' | 'DD') {
		isSwapped = false;
		if (kind === 'AA') {
			rotations = { irlo1: 0, irlo2: 270 };
		} else if (kind === 'BB') {
			rotations = { irlo1: 270, irlo2: 90 };
		} else if (kind === 'CC') {
			rotations = { irlo1: 90, irlo2: 180 };
		} else if (kind === 'DD') {
			rotations = { irlo1: 180, irlo2: 0 };
		}
	}

	const activeCanvases = $derived.by(() => {
		if (!manifest || manifest.canvases.length < 2) return [];
		return isSwapped ? [manifest.canvases[1], manifest.canvases[0]] : [manifest.canvases[0], manifest.canvases[1]];
	});

	const seamCheck = $derived.by(() => {
		if (activeCanvases.length < 2) return null;
		const c1 = activeCanvases[0];
		const c2 = activeCanvases[1];
		const e1 = getRotatedEdgeLabels(c1.edges, rotations[c1.id] ?? 0);
		const e2 = getRotatedEdgeLabels(c2.edges, rotations[c2.id] ?? 0);
		// Left canvas right edge faces right canvas left edge
		const facing1 = e1.right;
		const facing2 = e2.left;
		const rule = manifest?.seamRules.find(
			(r) =>
				(r.canvasAId === c1.id && r.canvasBId === c2.id && r.edgeA === facing1 && r.edgeB === facing2) ||
				(r.canvasAId === c2.id && r.canvasBId === c1.id && r.edgeA === facing2 && r.edgeB === facing1)
		);
		return {
			c1Name: c1.name,
			c2Name: c2.name,
			facing1,
			facing2,
			rule: rule ?? null
		};
	});

	async function verifyCompiledTargets() {
		try {
			const res = await fetch('/demo/targets/compiled-targets.json');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			compiledStatus = `Verified ${data.targets.length} target packs compiled at ${data.compiledAt}`;
		} catch (e) {
			compiledStatus = `Not compiled yet (${String(e)}). Run: npm run compile:targets`;
		}
	}
</script>

<div class="min-h-screen bg-zinc-950 p-6 text-zinc-100 print:bg-white print:text-black">
	<div class="mx-auto max-w-4xl space-y-6">
		<header class="flex flex-wrap items-center justify-between gap-4 print:hidden">
			<div>
				<a href="/" class="text-xs font-semibold tracking-wider text-sky-400 uppercase hover:underline">
					← Back to AR Scanner
				</a>
				<h1 class="mt-1 text-2xl font-bold text-white">Target Compiler & Test Sheet</h1>
				<p class="text-sm text-zinc-400">
					Inspect edge orientations (A/B/C/D), test 90° rotations, or print the test targets.
				</p>
			</div>

			<div class="flex gap-2">
				<button
					type="button"
					onclick={verifyCompiledTargets}
					class="rounded-xl border border-white/15 bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
				>
					Verify Compiled Targets
				</button>
				<button
					type="button"
					onclick={() => window.print()}
					class="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
				>
					Print Sheet
				</button>
			</div>
		</header>

		{#if compiledStatus}
			<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300 print:hidden">
				{compiledStatus}
			</div>
		{/if}

		{#if error}
			<div class="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
				{error}
			</div>
		{:else if manifest}
			{#if seamCheck}
				<div class="space-y-3 print:hidden">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs font-semibold text-zinc-400">Artwork Presets:</span>
						<button
							type="button"
							onclick={() => setPreset('AA')}
							class="rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-900/60"
						>
							Set AA (irlo1 0° / irlo2 270°)
						</button>
						<button
							type="button"
							onclick={() => setPreset('BB')}
							class="rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-900/60"
						>
							Set BB (irlo1 270° / irlo2 90°)
						</button>
						<button
							type="button"
							onclick={() => setPreset('CC')}
							class="rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-900/60"
						>
							Set CC (irlo1 90° / irlo2 180°)
						</button>
						<button
							type="button"
							onclick={() => setPreset('DD')}
							class="rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-900/60"
						>
							Set DD (irlo1 180° / irlo2 0°)
						</button>
						<button
							type="button"
							onclick={() => (isSwapped = !isSwapped)}
							class="rounded-lg border border-white/20 bg-zinc-800 px-2.5 py-1 text-xs font-bold text-white hover:bg-zinc-700"
						>
							{isSwapped ? 'Order: irlo2 | irlo1 (Click to swap)' : 'Order: irlo1 | irlo2 (Click to swap)'}
						</button>
					</div>

					<div class="flex items-center justify-between rounded-2xl border border-white/15 bg-zinc-900/90 px-5 py-3 text-sm">
						<div class="flex items-center gap-3">
							<span
								class="h-2.5 w-2.5 rounded-full {seamCheck.rule ? 'bg-emerald-400' : 'bg-amber-400'}"
							></span>
							<span>
								Horizontal Seam: <strong>{seamCheck.c1Name} (Edge {seamCheck.facing1})</strong> ⟷
								<strong>{seamCheck.c2Name} (Edge {seamCheck.facing2})</strong>
							</span>
						</div>
						<span class="font-semibold {seamCheck.rule ? 'text-emerald-400' : 'text-zinc-400'}">
							{seamCheck.rule ? `VALID SEAM (${seamCheck.rule.id})` : 'Incompatible (Individual Models)'}
						</span>
					</div>
				</div>
			{/if}

			<div class="grid gap-8 rounded-3xl border border-white/15 bg-white p-8 text-zinc-900 sm:grid-cols-2 print:border-0 print:p-2">
				{#each activeCanvases as canvas (canvas.id)}
					{@const rot = rotations[canvas.id] ?? 0}
					{@const lbl = getRotatedEdgeLabels(canvas.edges, rot)}
					<div class="flex flex-col items-center">
						<div class="mb-2 text-xs font-bold tracking-widest text-zinc-500 uppercase">
							Edge {lbl.top} (Top)
						</div>

						<div class="flex items-center gap-2">
							<div class="text-xs font-bold text-zinc-500 uppercase [writing-mode:vertical-rl] rotate-180">
								Edge {lbl.left}
							</div>

							<button
								type="button"
								onclick={() => rotateCanvas(canvas.id)}
								title="Click to rotate 90° clockwise"
								class="group relative h-64 w-64 cursor-pointer overflow-hidden border-[6px] border-zinc-950 bg-black shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
							>
								<img
									src={canvas.imageTargetUrl}
									alt={canvas.name}
									class="h-full w-full object-cover transition-transform duration-300"
									style="transform: rotate({rot}deg);"
								/>
							</button>

							<div class="text-xs font-bold text-zinc-500 uppercase [writing-mode:vertical-rl]">
								Edge {lbl.right}
							</div>
						</div>

						<div class="mt-2 text-xs font-bold tracking-widest text-zinc-500 uppercase">
							Edge {lbl.bottom} (Bottom)
						</div>

						<div class="mt-3 flex items-center gap-3 print:hidden">
							<span class="text-sm font-bold text-zinc-900">{canvas.name}</span>
							<span class="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-semibold text-zinc-700">
								{rot}°
							</span>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-sm text-zinc-400">Loading manifest…</p>
		{/if}
	</div>
</div>
