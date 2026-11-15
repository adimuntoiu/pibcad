<script lang="ts">
	import { goto } from '$app/navigation';
	import PillButton from '#lib/components/PillButton.svelte';
	import PillInput from '#lib/components/PillInput.svelte';
	import {
		galleryService,
		type GalleryArtwork,
		type GalleryWithArtworks
	} from '#lib/gallery/galleryService';
	import {
		validateImageFile,
		validateModelFile,
		downscaleImage,
		createThumbnail
	} from '#lib/utils/imageProcessing';
	import { generateModelPoster } from '#lib/3d/modelPoster';
	import {
		compileArtworkTarget,
		type TrackabilityMetrics
	} from '#lib/targets/targetCompiler';
	import MeshyGenerationModal from '#lib/components/MeshyGenerationModal.svelte';

	interface FormArtwork {
		id?: string;
		title: string;
		artist_name: string;
		image_path: string;
		image_file?: File | Blob;
		thumb_path?: string | null;
		thumb_blob?: Blob | null;
		model_path?: string | null;
		model_file?: File | Blob;
		model_poster_path?: string | null;
		model_poster_blob?: Blob | null;
		model_name?: string;
		target_path?: string | null;
		target_blob?: Blob | null;
		trackability_score?: number | null;
		trackability_warnings?: string[];
	}

	interface Props {
		initialGallery?: GalleryWithArtworks | null;
		ownerId: string;
		defaultArtistName: string;
		mode: 'create' | 'edit';
	}

	let { initialGallery = null, ownerId, defaultArtistName, mode }: Props = $props();

	let title = $state('');
	let description = $state('');
	let status = $state<'draft' | 'published'>('published');
	let artworks = $state<FormArtwork[]>([]);

	// Hydrate from initialGallery if provided
	$effect(() => {
		if (initialGallery) {
			title = initialGallery.title || '';
			description = initialGallery.description || '';
			status = initialGallery.status || 'published';
			artworks =
				initialGallery.artworks?.map((a) => ({
					id: a.id,
					title: a.title,
					artist_name: a.artist_name,
					image_path: a.image_path,
					thumb_path: a.thumb_path,
					model_path: a.model_path,
					model_poster_path: a.model_poster_path,
					model_name: a.model_path ? a.model_path.split('/').pop() : undefined,
					target_path: a.target_path,
					trackability_score: a.trackability_score ?? null
				})) || [];
		}
	});

	// New artwork draft state
	let newArtTitle = $state('');
	let newArtArtist = $state('');
	$effect(() => {
		if (!newArtArtist && defaultArtistName) {
			newArtArtist = defaultArtistName;
		}
	});

	let newArtImageFile = $state<File | null>(null);
	let newArtImagePreview = $state<string | null>(null);
	let newArtDownscaledBlob = $state<Blob | null>(null);
	let newArtThumbBlob = $state<Blob | null>(null);

	// Target compilation & trackability state
	let isCompilingTarget = $state(false);
	let targetCompileProgress = $state(0);
	let targetCompileStage = $state('');
	let newArtTargetBlob = $state<Blob | null>(null);
	let newArtTrackability = $state<TrackabilityMetrics | null>(null);

	let newArtModelFile = $state<File | null>(null);
	let newArtModelPosterBlob = $state<Blob | null>(null);
	let isGeneratingPoster = $state(false);

	let meshyModalOpen = $state(false);
	let meshyTargetIndex = $state<number | null>(null);

	function openMeshyModal(art: FormArtwork, idx: number) {
		meshyTargetIndex = idx;
		meshyModalOpen = true;
	}

	function handleMeshyAccept(result: { modelUrl: string; posterUrl: string }) {
		if (meshyTargetIndex !== null && artworks[meshyTargetIndex]) {
			artworks[meshyTargetIndex].model_path = result.modelUrl;
			artworks[meshyTargetIndex].model_poster_path = result.posterUrl;
			artworks[meshyTargetIndex].model_name = 'Meshy Generated';
			artworks = [...artworks];
		}
		meshyModalOpen = false;
		meshyTargetIndex = null;
	}

	let artworkFormError = $state<string | null>(null);
	let formError = $state<string | null>(null);
	let isSubmitting = $state(false);
	let submitProgressMessage = $state<string | null>(null);

	async function handleImageSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		artworkFormError = null;
		const val = validateImageFile(file);
		if (!val.valid) {
			artworkFormError = val.error || 'Invalid image file';
			target.value = '';
			return;
		}

		newArtImageFile = file;
		newArtTargetBlob = null;
		newArtTrackability = null;

		try {
			// Downscale image to max 2048px
			const downscaled = await downscaleImage(file, 2048, 0.88);
			newArtDownscaledBlob = downscaled;

			// Create 400px thumbnail
			const thumb = await createThumbnail(downscaled, 400, 0.85);
			newArtThumbBlob = thumb;

			// Compile MindAR target & compute trackability score in Web Worker
			isCompilingTarget = true;
			targetCompileProgress = 5;
			targetCompileStage = 'Starting target compiler...';

			const compiled = await compileArtworkTarget(downscaled, (progress, stage) => {
				targetCompileProgress = progress;
				targetCompileStage = stage;
			});

			newArtTargetBlob = compiled.targetBlob;
			newArtTrackability = compiled.metrics;
			// Use persistent data URL for preview & local fallback recognition
			newArtImagePreview = compiled.recognitionDataUrl || URL.createObjectURL(downscaled);
		} catch (err) {
			console.error('Image processing failed:', err);
			artworkFormError = 'Could not process image. Please try a different photo.';
		} finally {
			isCompilingTarget = false;
		}
	}

	async function handleModelSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		artworkFormError = null;
		const val = validateModelFile(file);
		if (!val.valid) {
			artworkFormError = val.error || 'Invalid 3D model';
			target.value = '';
			return;
		}

		newArtModelFile = file;
		isGeneratingPoster = true;

		try {
			// Render offscreen snapshot poster of the GLB
			const posterBlob = await generateModelPoster(file, 512, 512);
			newArtModelPosterBlob = posterBlob;
		} catch (err) {
			console.warn('Poster snapshot generation skipped:', err);
		} finally {
			isGeneratingPoster = false;
		}
	}

	function addArtworkToGallery() {
		artworkFormError = null;
		if (!newArtTitle.trim()) {
			artworkFormError = 'Please give your artwork a title.';
			return;
		}
		if (!newArtImagePreview || (!newArtImageFile && !newArtDownscaledBlob)) {
			artworkFormError = 'An artwork painting image is required.';
			return;
		}
		if (isCompilingTarget) {
			artworkFormError = 'Please wait for AR target compilation to finish.';
			return;
		}

		artworks = [
			...artworks,
			{
				title: newArtTitle.trim(),
				artist_name: newArtArtist.trim() || defaultArtistName || 'IRLO',
				image_path: newArtImagePreview,
				image_file: newArtDownscaledBlob || newArtImageFile || undefined,
				thumb_blob: newArtThumbBlob,
				model_file: newArtModelFile || undefined,
				model_poster_blob: newArtModelPosterBlob,
				model_name: newArtModelFile?.name,
				target_blob: newArtTargetBlob,
				trackability_score: newArtTrackability?.score ?? null,
				trackability_warnings: newArtTrackability?.warnings ?? []
			}
		];

		// Reset draft
		newArtTitle = '';
		newArtArtist = defaultArtistName || 'IRLO';
		newArtImageFile = null;
		newArtImagePreview = null;
		newArtDownscaledBlob = null;
		newArtThumbBlob = null;
		newArtTargetBlob = null;
		newArtTrackability = null;
		newArtModelFile = null;
		newArtModelPosterBlob = null;
	}

	function removeArtwork(index: number) {
		artworks = artworks.filter((_, idx) => idx !== index);
	}

	function moveArtwork(index: number, direction: 'up' | 'down') {
		const targetIdx = direction === 'up' ? index - 1 : index + 1;
		if (targetIdx < 0 || targetIdx >= artworks.length) return;
		const updated = [...artworks];
		const temp = updated[index];
		updated[index] = updated[targetIdx];
		updated[targetIdx] = temp;
		artworks = updated;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		formError = null;

		if (!title.trim()) {
			formError = 'Please enter a gallery title.';
			return;
		}

		if (artworks.length === 0) {
			formError = 'Please add at least one artwork to your gallery.';
			return;
		}

		isSubmitting = true;
		submitProgressMessage = 'Preparing uploads...';

		try {
			const preparedArtworks: GalleryArtwork[] = [];

			for (let i = 0; i < artworks.length; i++) {
				const art = artworks[i];
				submitProgressMessage = `Uploading artwork ${i + 1} of ${artworks.length}: "${art.title}"...`;

				let imagePath = art.image_path;
				let thumbPath = art.thumb_path || null;
				let modelPath = art.model_path || null;
				let posterPath = art.model_poster_path || null;
				let targetPath = art.target_path || null;

				// Upload image if newly selected
				if (art.image_file) {
					const ext = 'jpg';
					const imgName = `${ownerId}/${Date.now()}_art_${i}_main.${ext}`;
					imagePath = await galleryService.uploadStorageFile('artwork-images', imgName, art.image_file);
				}

				// Upload thumbnail if newly generated
				if (art.thumb_blob) {
					const thumbName = `${ownerId}/${Date.now()}_art_${i}_thumb.jpg`;
					thumbPath = await galleryService.uploadStorageFile('artwork-images', thumbName, art.thumb_blob);
				}

				// Upload compiled MindAR .mind target if newly generated
				if (art.target_blob) {
					submitProgressMessage = `Uploading AR tracking target ${i + 1} of ${artworks.length}...`;
					const targetName = `${ownerId}/${Date.now()}_art_${i}.mind`;
					targetPath = await galleryService.uploadStorageFile('targets', targetName, art.target_blob);
				}

				// Upload 3D model if newly selected
				if (art.model_file) {
					const modelName = `${ownerId}/${Date.now()}_art_${i}_model.glb`;
					modelPath = await galleryService.uploadStorageFile('models', modelName, art.model_file);
				}

				// Upload poster if newly generated
				if (art.model_poster_blob) {
					const posterName = `${ownerId}/${Date.now()}_art_${i}_poster.jpg`;
					posterPath = await galleryService.uploadStorageFile('artwork-images', posterName, art.model_poster_blob);
				}

				preparedArtworks.push({
					id: art.id,
					title: art.title,
					artist_name: art.artist_name,
					image_path: imagePath,
					thumb_path: thumbPath || imagePath,
					model_path: modelPath,
					model_poster_path: posterPath || thumbPath || imagePath,
					model_source: modelPath ? 'uploaded' : null,
					target_path: targetPath,
					trackability_score: art.trackability_score ?? null,
					sort_order: i
				});
			}

			submitProgressMessage = 'Saving gallery & syncing AR targets...';
			await galleryService.saveGallery({
				id: initialGallery?.id,
				owner_id: ownerId,
				title: title.trim(),
				description: description.trim(),
				status,
				artworks: preparedArtworks
			});

			await goto('/artist');
		} catch (err: unknown) {
			console.error('Gallery save error:', err);
			formError = err instanceof Error ? err.message : 'Failed to save gallery. Please retry.';
		} finally {
			isSubmitting = false;
			submitProgressMessage = null;
		}
	}
</script>

<form onsubmit={handleSubmit} class="w-full max-w-xl pb-16">
	<!-- Top Bar / Back Button & Header -->
	<div class="flex items-center justify-between pb-6">
		<a
			href="/artist"
			class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-opacity hover:opacity-80"
			aria-label="Back to dashboard"
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
			</svg>
		</a>
		<h1 class="font-display text-3xl font-bold tracking-tight text-white uppercase">
			{mode === 'create' ? 'Create Gallery' : 'Edit Gallery'}
		</h1>
		<div class="w-10"></div>
	</div>

	<!-- Form Error Notification with Retry -->
	{#if formError}
		<div
			class="mb-6 flex flex-col gap-2 rounded-2xl bg-rose-500/20 p-4 text-sm text-rose-200 border border-rose-500/30"
			role="alert"
		>
			<div class="flex items-center gap-2 font-bold text-rose-100">
				<svg class="h-5 w-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
				<span>{formError}</span>
			</div>
			<p class="text-xs text-rose-200/80">You can adjust your inputs and click retry below.</p>
		</div>
	{/if}

	<!-- Gallery Details Card -->
	<div class="mb-6 rounded-[2rem] bg-white/10 p-6 backdrop-blur-md border border-white/15">
		<h2 class="font-display text-xl font-bold text-white mb-4 uppercase tracking-wider">
			Gallery Details
		</h2>

		<div class="space-y-4">
			<div>
				<label for="gallery-title" class="mb-1.5 block font-display text-sm tracking-wider uppercase text-white/90">
					Title *
				</label>
				<PillInput
					placeholder="Autumn Horizons"
					ariaLabel="Gallery Title"
					required
					bind:value={title}
				/>
			</div>

			<div>
				<label for="gallery-desc" class="mb-1.5 block font-display text-sm tracking-wider uppercase text-white/90">
					Description (optional)
				</label>
				<textarea
					id="gallery-desc"
					bind:value={description}
					rows="3"
					placeholder="Describe the concept, series, or exhibition theme..."
					class="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 font-sans text-sm text-white placeholder-white/40 backdrop-blur-md outline-none transition focus:border-white focus:bg-white/15"
				></textarea>
			</div>

			<div>
				<span class="mb-1.5 block font-display text-sm tracking-wider uppercase text-white/90">
					Status
				</span>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => (status = 'published')}
						class="flex-1 rounded-xl py-2.5 text-xs font-bold uppercase tracking-wider transition-all {status ===
						'published'
							? 'bg-brand-purple text-white shadow-md'
							: 'bg-white/10 text-white/70 hover:bg-white/15'}"
					>
						Published (Public)
					</button>
					<button
						type="button"
						onclick={() => (status = 'draft')}
						class="flex-1 rounded-xl py-2.5 text-xs font-bold uppercase tracking-wider transition-all {status ===
						'draft'
							? 'bg-zinc-700 text-white shadow-md'
							: 'bg-white/10 text-white/70 hover:bg-white/15'}"
					>
						Draft (Private)
					</button>
				</div>
			</div>
		</div>
	</div>

	<!-- Added Artworks List -->
	<div class="mb-6 rounded-[2rem] bg-white/10 p-6 backdrop-blur-md border border-white/15">
		<div class="flex items-center justify-between mb-4">
			<h2 class="font-display text-xl font-bold text-white uppercase tracking-wider">
				Artworks ({artworks.length})
			</h2>
			{#if artworks.length > 0}
				<span class="text-xs text-white/60">Swipeable order on cards</span>
			{/if}
		</div>

		{#if artworks.length === 0}
			<p class="py-4 text-center font-sans text-sm text-white/60">
				No artworks added yet. Use the section below to add your first painting.
			</p>
		{:else}
			<div class="space-y-3">
				{#each artworks as art, idx (art.id || `${art.title}-${idx}`)}
					<div
						class="flex items-center gap-3 rounded-2xl bg-black/25 p-3 text-white border border-white/10"
					>
						<img
							src={art.image_path}
							alt={art.title}
							class="h-16 w-16 shrink-0 rounded-xl object-cover bg-zinc-800"
						/>
						<div class="min-w-0 flex-1">
							<h3 class="truncate font-display text-lg font-bold">{art.title}</h3>
							<p class="truncate font-sans text-xs text-white/70">by {art.artist_name}</p>
							<div class="mt-1 flex items-center gap-1.5 flex-wrap">
								{#if art.model_path || art.model_file}
									<span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
										3D Model Ready
									</span>
								{:else}
									<span class="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/60">
										2D Painting
									</span>
									<button
										type="button"
										onclick={() => openMeshyModal(art, idx)}
										class="rounded-full bg-brand-purple/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-200 hover:bg-brand-purple/70 border border-brand-purple/50 transition-colors"
									>
										✦ Generate 3D
									</button>
								{/if}

								{#if art.trackability_score != null}
									<span
										class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider {art.trackability_score >=
										70
											? 'bg-emerald-500/20 text-emerald-300'
											: art.trackability_score >= 45
												? 'bg-amber-500/20 text-amber-300'
												: 'bg-rose-500/20 text-rose-300'}"
									>
										AR Target {Math.round(art.trackability_score)}%
									</span>
								{/if}
							</div>
						</div>

						<!-- Reorder & Delete -->
						<div class="flex flex-col items-center gap-1">
							<div class="flex gap-1">
								<button
									type="button"
									disabled={idx === 0}
									onclick={() => moveArtwork(idx, 'up')}
									class="rounded bg-white/10 p-1 text-white/80 hover:bg-white/20 disabled:opacity-30"
									aria-label="Move Up"
								>
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7" />
									</svg>
								</button>
								<button
									type="button"
									disabled={idx === artworks.length - 1}
									onclick={() => moveArtwork(idx, 'down')}
									class="rounded bg-white/10 p-1 text-white/80 hover:bg-white/20 disabled:opacity-30"
									aria-label="Move Down"
								>
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
							</div>
							<button
								type="button"
								onclick={() => removeArtwork(idx)}
								class="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/30"
							>
								Remove
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Add Artwork Subform -->
	<div class="mb-8 rounded-[2rem] bg-white/10 p-6 backdrop-blur-md border border-white/15">
		<h2 class="font-display text-xl font-bold text-white mb-4 uppercase tracking-wider">
			+ Add Artwork
		</h2>

		{#if artworkFormError}
			<div class="mb-4 rounded-xl bg-rose-500/20 p-3 text-xs text-rose-200 border border-rose-500/30">
				{artworkFormError}
			</div>
		{/if}

		<div class="space-y-4">
			<!-- Image File Input -->
			<div>
				<label for="artwork-image-file" class="mb-1.5 block font-display text-sm tracking-wider uppercase text-white/90">
					Painting Image * (Max 10MB)
				</label>
				<input
					id="artwork-image-file"
					type="file"
					accept="image/jpeg,image/png,image/webp,image/jpg"
					onchange={handleImageSelect}
					class="block w-full text-xs text-white/80 file:mr-3 file:rounded-xl file:border-0 file:bg-white/20 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white file:transition-colors hover:file:bg-white/30"
				/>
				<p class="mt-1 text-[11px] text-white/60">
					Images are downscaled to max 2048px and compiled into an AR tracking target in the browser.
				</p>

				{#if isCompilingTarget}
					<div class="mt-3 rounded-xl bg-black/30 p-3 border border-white/10">
						<div class="flex items-center justify-between text-xs text-purple-200 mb-1.5">
							<span class="font-semibold">{targetCompileStage || 'Compiling AR tracking target...'}</span>
							<span class="font-mono font-bold">{targetCompileProgress}%</span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
							<div
								class="h-full bg-brand-purple transition-all duration-200"
								style="width: {targetCompileProgress}%"
							></div>
						</div>
					</div>
				{/if}

				{#if newArtImagePreview && !isCompilingTarget}
					<div class="mt-3 space-y-2">
						<div class="flex items-center gap-3 rounded-xl bg-black/25 p-2.5 border border-white/10">
							<img
								src={newArtImagePreview}
								alt="Preview"
								class="h-16 w-16 rounded-lg object-contain bg-zinc-900"
							/>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-xs text-emerald-300 font-semibold">Image & AR Target Ready</span>
									{#if newArtTrackability}
										<span
											class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {newArtTrackability.level ===
											'high'
												? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/30'
												: newArtTrackability.level === 'medium'
													? 'bg-amber-500/25 text-amber-200 border border-amber-400/30'
													: 'bg-rose-500/25 text-rose-200 border border-rose-400/30'}"
										>
											Trackability: {newArtTrackability.score}% ({newArtTrackability.level})
										</span>
									{/if}
								</div>
								{#if newArtTrackability}
									<p class="mt-1 text-[11px] text-white/60">
										{newArtTrackability.keypointCount} multi-scale features · {Math.round(
											newArtTrackability.spatialCoverage * 100
										)}% canvas coverage
									</p>
								{/if}
							</div>
						</div>

						{#if newArtTrackability && (newArtTrackability.isLowTrackability || newArtTrackability.warnings.length > 0)}
							<div
								class="rounded-xl bg-amber-500/15 p-3 text-xs text-amber-200 border border-amber-500/30"
								role="status"
							>
								<div class="flex items-center gap-1.5 font-bold text-amber-100 mb-1">
									<svg class="h-4 w-4 shrink-0 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
									</svg>
									<span>
										{newArtTrackability.isLowTrackability
											? 'Low AR Trackability Warning'
											: 'Trackability Notice'}
									</span>
								</div>
								<ul class="list-disc pl-4 space-y-0.5 text-[11px] text-amber-200/90">
									{#each newArtTrackability.warnings as warning}
										<li>{warning}</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Title -->
			<div>
				<label for="artwork-title-input" class="mb-1.5 block font-display text-sm tracking-wider uppercase text-white/90">
					Artwork Title *
				</label>
				<PillInput
					placeholder="Trumpet of Turmoil"
					ariaLabel="Artwork Title"
					bind:value={newArtTitle}
				/>
			</div>

			<!-- Artist Name -->
			<div>
				<label for="artwork-artist-input" class="mb-1.5 block font-display text-sm tracking-wider uppercase text-white/90">
					Artist Name
				</label>
				<PillInput
					placeholder="IRLO"
					ariaLabel="Artist Name"
					bind:value={newArtArtist}
				/>
			</div>

			<!-- 3D Model GLB File Input (Optional) -->
			<div>
				<label for="artwork-model-file" class="mb-1.5 block font-display text-sm tracking-wider uppercase text-white/90">
					3D Model GLB (Optional, Max 25MB)
				</label>
				<input
					id="artwork-model-file"
					type="file"
					accept=".glb"
					onchange={handleModelSelect}
					class="block w-full text-xs text-white/80 file:mr-3 file:rounded-xl file:border-0 file:bg-white/20 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white file:transition-colors hover:file:bg-white/30"
				/>
				<p class="mt-1 text-[11px] text-white/60">
					Upload a .glb file or generate one with Meshy after adding the painting.
				</p>

				{#if isGeneratingPoster}
					<div class="mt-2 flex items-center gap-2 text-xs text-amber-300">
						<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
						</svg>
						<span>Generating 3D poster snapshot...</span>
					</div>
				{:else if newArtModelFile}
					<div class="mt-2 flex items-center gap-2 text-xs text-emerald-300">
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						<span>Model "{newArtModelFile.name}" ready {newArtModelPosterBlob ? '+ 2D poster captured' : ''}</span>
					</div>
				{/if}
			</div>

			<button
				type="button"
				onclick={addArtworkToGallery}
				disabled={isCompilingTarget}
				class="w-full rounded-2xl bg-white/20 py-3 font-display text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-white/30 active:scale-95 disabled:opacity-50"
			>
				{isCompilingTarget ? 'Compiling AR Target...' : 'Add Artwork to Gallery'}
			</button>
		</div>
	</div>

	<!-- Submit / Save Button -->
	<div class="space-y-3">
		{#if isSubmitting && submitProgressMessage}
			<div class="flex items-center justify-center gap-2 rounded-2xl bg-white/10 p-3 text-sm text-white backdrop-blur-md">
				<svg class="h-4 w-4 animate-spin text-brand-purple" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
				</svg>
				<span>{submitProgressMessage}</span>
			</div>
		{/if}

		<PillButton
			type="submit"
			variant="purple"
			disabled={isSubmitting || isCompilingTarget}
			class="w-full text-center justify-center py-4 text-base"
		>
			{isSubmitting
				? 'SAVING GALLERY...'
				: mode === 'create'
					? 'SAVE AND PUBLISH GALLERY'
					: 'UPDATE GALLERY'}
		</PillButton>
	</div>
</form>

{#if meshyModalOpen && meshyTargetIndex !== null && artworks[meshyTargetIndex]}
	<MeshyGenerationModal
		isOpen={meshyModalOpen}
		artworkTitle={artworks[meshyTargetIndex].title}
		imageUrl={artworks[meshyTargetIndex].image_path}
		artworkId={artworks[meshyTargetIndex].id}
		onAccept={handleMeshyAccept}
		onDiscard={() => {
			meshyModalOpen = false;
			meshyTargetIndex = null;
		}}
		onClose={() => {
			meshyModalOpen = false;
			meshyTargetIndex = null;
		}}
	/>
{/if}
