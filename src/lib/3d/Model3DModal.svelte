<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { loadOBJ, parseOBJ, resolveModelUrl } from './modelLoader';

	interface Props {
		paintingId: string | null;
		title: string | null;
		artist: string | null;
		customModelUrl?: string | null;
		userModel?: THREE.Group | null;
		onClose: () => void;
		onModelUploaded?: (group: THREE.Group, filename: string) => void;
	}

	let {
		paintingId,
		title,
		artist,
		customModelUrl = null,
		userModel = null,
		onClose,
		onModelUploaded
	}: Props = $props();

	let container: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let meshGroup = new THREE.Group();
	let animId = 0;

	let loading = $state(true);
	let wireframe = $state(false);
	let autoRotate = $state(true);
	let isDragging = $state(false);
	let lastPointerX = 0;
	let lastPointerY = 0;
	let rotX = 0.2;
	let rotY = 0;
	let cameraDistance = 2.4;
	let currentModelName = $state('3D Object');

	async function loadModel() {
		loading = true;
		if (userModel) {
			displayMesh(userModel.clone());
			currentModelName = 'Custom Uploaded .OBJ';
			loading = false;
			return;
		}

		try {
			const resolvedUrl = await resolveModelUrl(paintingId ?? 'default', customModelUrl);
			currentModelName = resolvedUrl.split('/').pop() ?? 'model.obj';
			const loaded = await loadOBJ(resolvedUrl);
			displayMesh(loaded);
		} catch (err) {
			console.error('[Model3DModal] Load failed:', err);
		} finally {
			loading = false;
		}
	}

	function displayMesh(group: THREE.Group) {
		while (meshGroup.children.length > 0) {
			meshGroup.remove(meshGroup.children[0]);
		}
		meshGroup.add(group);
		applyWireframe();
	}

	function applyWireframe() {
		meshGroup.traverse((child) => {
			if (child instanceof THREE.Mesh && child.material) {
				if (Array.isArray(child.material)) {
					child.material.forEach((m) => (m.wireframe = wireframe));
				} else {
					child.material.wireframe = wireframe;
				}
			}
		});
	}

	function toggleWireframe() {
		wireframe = !wireframe;
		applyWireframe();
	}

	function onPointerDown(e: PointerEvent) {
		isDragging = true;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		const dx = e.clientX - lastPointerX;
		const dy = e.clientY - lastPointerY;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;

		rotY += dx * 0.008;
		rotX = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, rotX + dy * 0.008));
	}

	function onPointerUp() {
		isDragging = false;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		cameraDistance = Math.max(1.0, Math.min(6.0, cameraDistance + e.deltaY * 0.003));
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		loadFromFile(file);
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (!file || !file.name.toLowerCase().endsWith('.obj')) return;
		loadFromFile(file);
	}

	function loadFromFile(file: File) {
		loading = true;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const text = reader.result as string;
				const parsed = parseOBJ(text);
				displayMesh(parsed);
				currentModelName = file.name;
				onModelUploaded?.(parsed, file.name);
			} catch (err) {
				alert('Could not parse .obj file: ' + String(err));
			} finally {
				loading = false;
			}
		};
		reader.readAsText(file);
	}

	onMount(() => {
		const w = container.clientWidth;
		const h = container.clientHeight;

		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 50);

		renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		renderer.setSize(w, h);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		// Lighting
		const ambient = new THREE.AmbientLight(0xffffff, 1.4);
		scene.add(ambient);

		const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
		keyLight.position.set(3, 5, 4);
		scene.add(keyLight);

		const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
		fillLight.position.set(-4, -2, 2);
		scene.add(fillLight);

		scene.add(meshGroup);

		void loadModel();

		function render() {
			animId = requestAnimationFrame(render);

			if (autoRotate && !isDragging) {
				rotY += 0.008;
			}

			// Spherical camera orbit around origin
			const camX = cameraDistance * Math.cos(rotX) * Math.sin(rotY);
			const camY = cameraDistance * Math.sin(rotX);
			const camZ = cameraDistance * Math.cos(rotX) * Math.cos(rotY);

			if (camera) {
				camera.position.set(camX, camY, camZ);
				camera.lookAt(0, 0, 0);
			}

			if (renderer && scene && camera) {
				renderer.render(scene, camera);
			}
		}

		animId = requestAnimationFrame(render);
	});

	onDestroy(() => {
		cancelAnimationFrame(animId);
		renderer?.dispose();
	});
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	ondragover={(e) => e.preventDefault()}
	ondrop={handleDrop}
>
	<div
		bind:this={container}
		class="relative flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-zinc-950 shadow-2xl"
	>
		<!-- Header -->
		<header class="flex items-center justify-between border-b border-white/10 px-5 py-4">
			<div>
				{#if artist}
					<p class="text-[11px] font-semibold tracking-wider text-sky-400 uppercase">
						{artist}
					</p>
				{/if}
				<h2 class="text-base font-bold text-white">
					{title ?? '3D Inspector'}
				</h2>
				<span class="text-xs text-zinc-400">{currentModelName}</span>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="rounded-full border border-white/15 bg-zinc-900 p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
				aria-label="Close"
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
		</header>

		<!-- 3D Canvas Area -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative flex-1 cursor-grab active:cursor-grabbing"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onwheel={onWheel}
		>
			<canvas bind:this={canvas} class="h-full w-full"></canvas>

			{#if loading}
				<div class="absolute inset-0 flex items-center justify-center bg-zinc-950/50 backdrop-blur-sm">
					<div class="flex items-center gap-3 rounded-full border border-white/15 bg-zinc-900 px-4 py-2 text-sm text-white">
						<span class="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"></span>
						<span>Loading .OBJ model…</span>
					</div>
				</div>
			{/if}

			<!-- Floating Controls -->
			<div class="absolute top-3 right-3 flex flex-col gap-2">
				<button
					type="button"
					onclick={toggleWireframe}
					class="rounded-xl border border-white/15 bg-zinc-900/90 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-lg hover:bg-zinc-800"
				>
					{wireframe ? 'Solid' : 'Wireframe'}
				</button>
				<button
					type="button"
					onclick={() => (autoRotate = !autoRotate)}
					class="rounded-xl border border-white/15 bg-zinc-900/90 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-lg hover:bg-zinc-800"
				>
					{autoRotate ? 'Pause Spin' : 'Auto Spin'}
				</button>
			</div>

			<!-- Helper note -->
			<div class="pointer-events-none absolute bottom-3 left-4 text-[11px] text-zinc-500">
				Drag to rotate • Scroll to zoom
			</div>
		</div>

		<!-- Footer with file drop/picker -->
		<footer class="flex items-center justify-between border-t border-white/10 bg-zinc-900/60 px-5 py-3 text-xs text-zinc-300">
			<div class="flex items-center gap-2">
				<span class="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
				<span>Drop any <strong>.obj</strong> file to inspect</span>
			</div>

			<label class="cursor-pointer rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-1.5 font-medium text-sky-300 hover:bg-sky-500/20 active:scale-95">
				<span>Upload .obj</span>
				<input type="file" accept=".obj" onchange={handleFileSelect} class="hidden" />
			</label>
		</footer>
	</div>
</div>
