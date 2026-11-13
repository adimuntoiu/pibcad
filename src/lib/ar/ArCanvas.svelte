<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import * as THREE from 'three';
	import { LowPassPoseFilter, SmoothFadeEnvelope } from '#lib/ar/poseFilter';
	import { ShaderBlendSurface } from '#lib/experiences/shaderBlend';
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

	let containerEl = $state<HTMLDivElement | null>(null);

	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;

	let groupA: THREE.Group | null = null;
	let groupB: THREE.Group | null = null;
	let meshA: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
	let meshB: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
	let borderA: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> | null = null;
	let borderB: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> | null = null;
	let cornerDotsA: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
	let cornerDotsB: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;

	let shaderSurface: ShaderBlendSurface | null = null;

	const filterA = new LowPassPoseFilter(0.18);
	const filterB = new LowPassPoseFilter(0.18);
	const expFade = new SmoothFadeEnvelope(0.45, 0.35);
	const canvasFadeA = new SmoothFadeEnvelope(0.3, 0.25);
	const canvasFadeB = new SmoothFadeEnvelope(0.3, 0.25);

	let rafId: number | null = null;
	let lastFrameMs = 0;
	let startMs = 0;
	let loadedPairId: string | null = null;

	function initThree(container: HTMLDivElement) {
		scene = new THREE.Scene();
		const width = container.clientWidth || window.innerWidth;
		const height = container.clientHeight || window.innerHeight;

		camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 20);
		camera.position.set(0, 0, 2.4);

		renderer = new THREE.WebGLRenderer({
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setSize(width, height);
		renderer.setClearColor(0x000000, 0);

		// Clear container and mount WebGL canvas
		container.innerHTML = '';
		container.appendChild(renderer.domElement);

		const planeGeo = new THREE.PlaneGeometry(1, 1);
		const edgesGeo = new THREE.EdgesGeometry(planeGeo);

		// Corner dots geometry at the 4 corners of a 1x1 plane (-0.5 to +0.5)
		const cornerVertices = new Float32Array([
			-0.5, -0.5, 0.02,
			 0.5, -0.5, 0.02,
			 0.5,  0.5, 0.02,
			-0.5,  0.5, 0.02
		]);
		const cornersGeoA = new THREE.BufferGeometry();
		cornersGeoA.setAttribute('position', new THREE.BufferAttribute(cornerVertices, 3));
		const cornersGeoB = cornersGeoA.clone();

		cornerDotsA = new THREE.Points(
			cornersGeoA,
			new THREE.PointsMaterial({
				color: 0x34d399,
				size: 18,
				sizeAttenuation: false,
				transparent: true,
				opacity: 0
			})
		);
		cornerDotsB = new THREE.Points(
			cornersGeoB,
			new THREE.PointsMaterial({
				color: 0x38bdf8,
				size: 18,
				sizeAttenuation: false,
				transparent: true,
				opacity: 0
			})
		);

		// Canvas A anchor group
		groupA = new THREE.Group();
		meshA = new THREE.Mesh(
			planeGeo,
			new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0,
				side: THREE.DoubleSide
			})
		);
		borderA = new THREE.LineSegments(
			edgesGeo,
			new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0 })
		);
		groupA.add(meshA);
		groupA.add(borderA);
		groupA.add(cornerDotsA);
		scene.add(groupA);

		// Canvas B anchor group
		groupB = new THREE.Group();
		meshB = new THREE.Mesh(
			planeGeo,
			new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0,
				side: THREE.DoubleSide
			})
		);
		borderB = new THREE.LineSegments(
			edgesGeo,
			new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0 })
		);
		groupB.add(meshB);
		groupB.add(borderB);
		groupB.add(cornerDotsB);
		scene.add(groupB);

		// Unified 2x1 ShaderBlend surface across both canvases
		shaderSurface = new ShaderBlendSurface();
		shaderSurface.mesh.position.z = 0.015;
		scene.add(shaderSurface.mesh);

		loadPairTextures(pair);
		startMs = performance.now();
		lastFrameMs = startMs;
		ensureLoopRunning();
	}

	function loadPairTextures(currentPair: PairInfo) {
		if (!shaderSurface || !meshA || !meshB) return;
		if (loadedPairId === currentPair.id) return;
		loadedPairId = currentPair.id;

		const loader = new THREE.TextureLoader();
		loader.load(currentPair.paintingA.imageUrl, (tex) => {
			tex.colorSpace = THREE.SRGBColorSpace;
			if (meshA) {
				meshA.material.map = tex;
				meshA.material.needsUpdate = true;
			}
		});
		loader.load(currentPair.paintingB.imageUrl, (tex) => {
			tex.colorSpace = THREE.SRGBColorSpace;
			if (meshB) {
				meshB.material.map = tex;
				meshB.material.needsUpdate = true;
			}
		});
		shaderSurface.setTextures(currentPair.paintingA.imageUrl, currentPair.paintingB.imageUrl);
	}

	function handleResize() {
		if (!containerEl || !renderer || !camera) return;
		const w = containerEl.clientWidth || window.innerWidth;
		const h = containerEl.clientHeight || window.innerHeight;
		camera.aspect = w / h;
		// Adjust camera Z on narrow portrait phones so the 2x1 pair fits comfortably
		camera.position.z = w < h ? 3.25 : 2.35;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
	}

	function ensureLoopRunning() {
		if (rafId === null && renderer) {
			lastFrameMs = performance.now();
			rafId = requestAnimationFrame(renderTick);
		}
	}

	function stopLoop() {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	function renderTick(nowMs: number) {
		rafId = null;
		if (!renderer || !scene || !camera || !shaderSurface || !groupA || !groupB) return;

		const dt = Math.min(Math.max((nowMs - lastFrameMs) / 1000, 0.001), 0.1);
		lastFrameMs = nowMs;
		const elapsedSec = (nowMs - startMs) / 1000;

		const opA = canvasFadeA.step(Boolean(active && canvasA), dt);
		const opB = canvasFadeB.step(Boolean(active && canvasB), dt);

		const shouldPlayShader = Boolean(
			active &&
				seam.bothTracked &&
				seam.isValidMatch &&
				seam.activeExperience &&
				seam.activeExperience.type === 'shader_blend'
		);
		const expOpacity = expFade.step(shouldPlayShader, dt);

		// Update smoothed pose for Canvas A
		if (canvasA) {
			const pA = filterA.update(canvasA.pose, dt);
			groupA.position.set(pA.x, pA.y, pA.z);
			groupA.scale.set(pA.size, pA.size, 1);
			groupA.rotation.set(0, 0, pA.rollRad);
		} else if (opA <= 0.01) {
			filterA.reset();
		}

		// Update smoothed pose for Canvas B
		if (canvasB) {
			const pB = filterB.update(canvasB.pose, dt);
			groupB.position.set(pB.x, pB.y, pB.z);
			groupB.scale.set(pB.size, pB.size, 1);
			groupB.rotation.set(0, 0, pB.rollRad);
		} else if (opB <= 0.01) {
			filterB.reset();
		}

		if (meshA && borderA) {
			// Dim individual base canvases smoothly as the unified shader blend takes over
			const baseAlphaA = showRigCanvases ? opA * (1 - expOpacity * 0.72) : 0;
			meshA.material.opacity = baseAlphaA;
			meshA.visible = baseAlphaA > 0.005;
			borderA.material.opacity = opA * 0.75;
			borderA.material.color.setHex(seam.isValidMatch ? 0x34d399 : 0xfbbf24);
			borderA.visible = opA > 0.005;

			if (cornerDotsA) {
				cornerDotsA.material.opacity = debugCornerDots ? opA : 0;
				cornerDotsA.material.color.setHex(seam.isValidMatch ? 0x34d399 : 0xfbbf24);
				cornerDotsA.visible = debugCornerDots && opA > 0.005;
			}
		}

		if (meshB && borderB) {
			const baseAlphaB = showRigCanvases ? opB * (1 - expOpacity * 0.72) : 0;
			meshB.material.opacity = baseAlphaB;
			meshB.visible = baseAlphaB > 0.005;
			borderB.material.opacity = opB * 0.75;
			borderB.material.color.setHex(seam.isValidMatch ? 0x34d399 : 0x38bdf8);
			borderB.visible = opB > 0.005;

			if (cornerDotsB) {
				cornerDotsB.material.opacity = debugCornerDots ? opB : 0;
				cornerDotsB.material.color.setHex(seam.isValidMatch ? 0x34d399 : 0x38bdf8);
				cornerDotsB.visible = debugCornerDots && opB > 0.005;
			}
		}

		// Position unified 2x1 ShaderBlend plane across both tracked canvases
		const poseAVal = filterA.value;
		const poseBVal = filterB.value;
		if (poseAVal && poseBVal) {
			const midX = (poseAVal.x + poseBVal.x) * 0.5;
			const midY = (poseAVal.y + poseBVal.y) * 0.5;
			const midZ = (poseAVal.z + poseBVal.z) * 0.5 + 0.015;
			const avgSize = (poseAVal.size + poseBVal.size) * 0.5;
			const dx = poseBVal.x - poseAVal.x;
			const dy = poseBVal.y - poseAVal.y;
			const pairAngle = Math.atan2(dy, dx);

			shaderSurface.mesh.position.set(midX, midY, midZ);
			shaderSurface.mesh.scale.set(avgSize, avgSize, 1);
			shaderSurface.mesh.rotation.set(0, 0, Math.abs(dx) > 0.05 ? pairAngle : 0);
		}

		if (seam.leftCanvas && seam.rightCanvas) {
			const leftUrl =
				seam.leftCanvas.slot === 'A' ? pair.paintingA.imageUrl : pair.paintingB.imageUrl;
			const rightUrl =
				seam.rightCanvas.slot === 'A' ? pair.paintingA.imageUrl : pair.paintingB.imageUrl;
			shaderSurface.setTextures(leftUrl, rightUrl);
			shaderSurface.setRotations(seam.leftCanvas.rotation, seam.rightCanvas.rotation);
		}

		if (seam.activeExperience && seam.activeExperience.type === 'shader_blend') {
			shaderSurface.setParams(seam.activeExperience.params);
		}

		shaderSurface.update(elapsedSec, expOpacity);
		renderer.render(scene, camera);

		// Performance rule: pause rendering when nothing is tracked and fade-out is complete
		const anythingVisible = opA > 0.001 || opB > 0.001 || expOpacity > 0.001;
		if (active && (anythingVisible || canvasA !== null || canvasB !== null)) {
			rafId = requestAnimationFrame(renderTick);
		} else {
			renderer.clear();
		}
	}

	// Wake render loop whenever tracking state or active state changes
	$effect(() => {
		if (active || canvasA || canvasB || seam.bothTracked) {
			loadPairTextures(pair);
			ensureLoopRunning();
		}
	});

	onMount(() => {
		if (containerEl) {
			initThree(containerEl);
			handleResize();
		}
		window.addEventListener('resize', handleResize);
		return () => {
			window.removeEventListener('resize', handleResize);
		};
	});

	onDestroy(() => {
		stopLoop();
		shaderSurface?.dispose();
		renderer?.dispose();
	});
</script>

<div bind:this={containerEl} class="pointer-events-none absolute inset-0 z-10 h-full w-full"></div>
