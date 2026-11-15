<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { loadModel3D } from '../3d/modelLoader';

	interface Props {
		modelUrl?: string | null;
		thumbUrl?: string | null;
		title?: string;
		preloadUrls?: string[];
		class?: string;
		onInteraction?: () => void;
	}

	let {
		modelUrl = null,
		thumbUrl = null,
		title = '',
		preloadUrls = [],
		class: className = '',
		onInteraction
	}: Props = $props();

	let containerEl = $state<HTMLDivElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);

	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let renderer: THREE.WebGLRenderer | null = null;
	let modelGroup: THREE.Group | null = null;
	let animId: number | null = null;

	let loading = $state(true);
	let loadError = $state(false);

	// Orbit & Zoom State
	let rotX = 0.15;
	let rotY = 0;
	let velX = 0;
	let velY = 0;
	const DAMPING = 0.92;

	let camDistance = 1.8;
	let minDistance = 0.6;
	let maxDistance = 5.0;

	let autoRotate = true;
	let isInteracting = false;

	// Multi-touch tracking
	const activePointers = new Map<number, { x: number; y: number }>();
	let lastPinchDist = 0;
	let lastPointerX = 0;
	let lastPointerY = 0;

	function disposeModelGroup(group: THREE.Group | null) {
		if (!group) return;
		group.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry?.dispose();
				if (Array.isArray(child.material)) {
					for (const m of child.material) disposeMaterial(m);
				} else if (child.material) {
					disposeMaterial(child.material);
				}
			}
		});
		if (scene) {
			scene.remove(group);
		}
	}

	function disposeMaterial(mat: THREE.Material) {
		const m = mat as unknown as Record<string, unknown>;
		for (const key of Object.keys(m)) {
			const value = m[key];
			if (value && typeof value === 'object' && 'dispose' in value && typeof (value as { dispose: () => void }).dispose === 'function') {
				(value as { dispose: () => void }).dispose();
			}
		}
		mat.dispose();
	}

	function fitCameraToModel(group: THREE.Group) {
		if (!camera) return;
		const box = new THREE.Box3().setFromObject(group);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());

		// Center the group around origin
		group.position.sub(center);

		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		const sphere = box.getBoundingSphere(new THREE.Sphere());
		const radius = Math.max(sphere.radius, maxDim * 0.5);

		const fovRad = (camera.fov * Math.PI) / 180;
		const fitDist = (radius * 1.35) / Math.sin(fovRad / 2);

		camDistance = fitDist;
		minDistance = Math.max(0.3, fitDist * 0.35);
		maxDistance = fitDist * 3.2;

		camera.position.set(0, 0, camDistance);
		camera.lookAt(0, 0, 0);
	}

	async function loadCurrentModel(url: string) {
		loading = true;
		loadError = false;

		// Dispose existing model from scene
		if (modelGroup) {
			disposeModelGroup(modelGroup);
			modelGroup = null;
		}

		try {
			const group = await loadModel3D(url);
			if (!scene) return;

			modelGroup = group;
			fitCameraToModel(group);
			scene.add(group);
			loading = false;
		} catch (err) {
			console.warn('Failed to load 3D model, falling back to thumbnail:', err);
			loadError = true;
			loading = false;
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (!canvasEl) return;
		canvasEl.setPointerCapture(e.pointerId);
		activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		isInteracting = true;
		autoRotate = false;
		velX = 0;
		velY = 0;

		if (activePointers.size === 1) {
			lastPointerX = e.clientX;
			lastPointerY = e.clientY;
		} else if (activePointers.size === 2) {
			const pts = Array.from(activePointers.values());
			lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
		}

		onInteraction?.();
	}

	function handlePointerMove(e: PointerEvent) {
		if (!activePointers.has(e.pointerId)) return;
		activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (activePointers.size === 1) {
			// One finger rotation
			const dx = e.clientX - lastPointerX;
			const dy = e.clientY - lastPointerY;

			velY = dx * 0.008;
			velX = dy * 0.008;

			rotY += velY;
			rotX = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, rotX + velX));

			lastPointerX = e.clientX;
			lastPointerY = e.clientY;
		} else if (activePointers.size === 2) {
			// Two finger pinch-to-zoom
			const pts = Array.from(activePointers.values());
			const currentDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
			if (lastPinchDist > 0 && currentDist > 0) {
				const factor = lastPinchDist / currentDist;
				camDistance = Math.max(minDistance, Math.min(maxDistance, camDistance * factor));
				if (camera) {
					camera.position.z = camDistance;
				}
			}
			lastPinchDist = currentDist;
		}

		onInteraction?.();
	}

	function handlePointerUp(e: PointerEvent) {
		activePointers.delete(e.pointerId);
		if (activePointers.size === 0) {
			isInteracting = false;
			lastPinchDist = 0;
		} else if (activePointers.size === 1) {
			const remaining = Array.from(activePointers.values())[0];
			lastPointerX = remaining.x;
			lastPointerY = remaining.y;
		}
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
		camDistance = Math.max(minDistance, Math.min(maxDistance, camDistance * zoomFactor));
		if (camera) {
			camera.position.z = camDistance;
		}
		onInteraction?.();
	}

	onMount(() => {
		if (!containerEl || !canvasEl) return;
		const width = containerEl.clientWidth || 340;
		const height = containerEl.clientHeight || 340;

		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
		camera.position.set(0, 0, camDistance);

		renderer = new THREE.WebGLRenderer({
			canvas: canvasEl,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		renderer.setSize(width, height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.15;

		// Lighting
		const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
		scene.add(ambientLight);

		const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
		dirLight.position.set(2, 4, 3);
		scene.add(dirLight);

		const fillLight = new THREE.DirectionalLight(0xbfa5ff, 1.2);
		fillLight.position.set(-2, -1, 2);
		scene.add(fillLight);

		function animate() {
			animId = requestAnimationFrame(animate);

			if (modelGroup) {
				if (!isInteracting) {
					// Apply residual rotational inertia
					rotY += velY;
					rotX = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, rotX + velX));
					velX *= DAMPING;
					velY *= DAMPING;

					if (autoRotate) {
						rotY += 0.006;
					}
				}

				modelGroup.rotation.y = rotY;
				modelGroup.rotation.x = rotX;
			}

			if (camera) {
				camera.position.z = camDistance;
			}

			if (renderer && scene && camera) {
				renderer.render(scene, camera);
			}
		}
		animate();

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const w = entry.contentRect.width;
				const h = entry.contentRect.height;
				if (w && h && camera && renderer) {
					camera.aspect = w / h;
					camera.updateProjectionMatrix();
					renderer.setSize(w, h);
				}
			}
		});
		resizeObserver.observe(containerEl);

		// Preload adjacent models
		for (const pUrl of preloadUrls) {
			if (pUrl) void loadModel3D(pUrl);
		}

		return () => {
			resizeObserver.disconnect();
			if (animId !== null) cancelAnimationFrame(animId);
			if (modelGroup) disposeModelGroup(modelGroup);
			renderer?.dispose();
		};
	});

	// Re-load when modelUrl changes
	$effect(() => {
		const url = modelUrl;
		if (url) {
			void loadCurrentModel(url);
		} else {
			loading = false;
			loadError = false;
			if (modelGroup) {
				disposeModelGroup(modelGroup);
				modelGroup = null;
			}
		}
	});
</script>

<div
	bind:this={containerEl}
	class="relative flex h-full w-full items-center justify-center select-none {className}"
	style="touch-action: none;"
>
	<!-- WebGL Canvas for 3D Model -->
	<canvas
		bind:this={canvasEl}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onwheel={handleWheel}
		class="h-full w-full cursor-grab active:cursor-grabbing {modelUrl && !loadError ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-300"
		style="touch-action: none;"
		aria-label="3D Model Viewer - swipe to rotate, pinch to zoom"
	></canvas>

	<!-- Fallback 2D Artwork Image if no 3D model or model load failed -->
	{#if (!modelUrl || loadError) && thumbUrl}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
			<img
				src={thumbUrl}
				alt={title || 'Artwork thumbnail'}
				class="max-h-full max-w-full rounded-2xl object-contain shadow-2xl transition-transform duration-500 hover:scale-[1.02]"
			/>
		</div>
	{/if}

	<!-- Loading Spinner -->
	{#if loading && modelUrl}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<div class="flex items-center gap-2.5 rounded-full bg-black/40 px-4 py-2 text-xs font-semibold text-white/90 backdrop-blur-md">
				<span class="h-3 w-3 animate-spin rounded-full border-2 border-brand-accent border-t-transparent"></span>
				<span>Loading 3D…</span>
			</div>
		</div>
	{/if}
</div>
