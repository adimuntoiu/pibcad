<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import type { Point } from '#lib/types';
	import { loadOBJ, resolveModelUrl } from './modelLoader';

	interface Props {
		corners: Point[] | null;
		videoWidth: number;
		videoHeight: number;
		width: number;
		height: number;
		paintingId: string | null;
		customModelUrl?: string | null;
		userModel?: THREE.Group | null;
		visible?: boolean;
	}

	let {
		corners,
		videoWidth,
		videoHeight,
		width,
		height,
		paintingId,
		customModelUrl = null,
		userModel = null,
		visible = true
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let modelRoot = new THREE.Group();
	let currentMesh: THREE.Group | null = null;
	let animId = 0;
	let activePaintingId: string | null = null;
	let spinAngle = 0;

	// Target 3D transform for smooth lerping
	const targetPos = new THREE.Vector3(0, 0, -5);
	const targetQuat = new THREE.Quaternion();
	let targetScale = 1.0;
	let hasTarget = false;

	async function updateModel(pid: string | null, customUrl: string | null, customObj: THREE.Group | null) {
		if (customObj) {
			setModel(customObj.clone());
			return;
		}
		if (!pid) return;

		try {
			const resolvedUrl = await resolveModelUrl(pid, customUrl);
			const loaded = await loadOBJ(resolvedUrl);
			setModel(loaded);
		} catch (err) {
			console.warn('[ModelARCanvas] Failed to load 3D model:', err);
		}
	}

	function setModel(mesh: THREE.Group) {
		if (currentMesh) {
			modelRoot.remove(currentMesh);
		}
		currentMesh = mesh;
		modelRoot.add(mesh);
	}

	$effect(() => {
		if (userModel) {
			void updateModel(paintingId, customModelUrl, userModel);
		} else if (paintingId !== activePaintingId || customModelUrl) {
			activePaintingId = paintingId;
			void updateModel(paintingId, customModelUrl, null);
		}
	});

	function updatePose() {
		if (!corners || corners.length !== 4 || !videoWidth || !videoHeight || !width || !height) {
			hasTarget = false;
			return;
		}

		// Map normalized camera-frame corners to screen pixels matching `object-cover`
		const scale = Math.max(width / videoWidth, height / videoHeight);
		const offsetX = (videoWidth * scale - width) / 2;
		const offsetY = (videoHeight * scale - height) / 2;

		const pts = corners.map((p) => ({
			x: p.x * videoWidth * scale - offsetX,
			y: p.y * videoHeight * scale - offsetY
		}));

		const p0 = pts[0];
		const p1 = pts[1];
		const p2 = pts[2];
		const p3 = pts[3];

		const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
		const cy = (p0.y + p1.y + p2.y + p3.y) / 4;

		// Average side lengths
		const topW = Math.hypot(p1.x - p0.x, p1.y - p0.y);
		const botW = Math.hypot(p2.x - p3.x, p2.y - p3.y);
		const leftH = Math.hypot(p3.x - p0.x, p3.y - p0.y);
		const rightH = Math.hypot(p2.x - p1.x, p2.y - p1.y);

		const avgW = (topW + botW) / 2;
		const avgH = (leftH + rightH) / 2;
		const span = Math.max(avgW, avgH);

		if (span < 20) {
			hasTarget = false;
			return;
		}

		// Camera focal length matching standard 50° FOV
		const vFovRad = (50 * Math.PI) / 180;
		const fy = height / 2 / Math.tan(vFovRad / 2);
		const fx = fy;

		// Estimated distance Z so unit model fits painting span
		const Z = Math.max(1.5, Math.min(18.0, (fy * 1.0) / span));

		// Position in camera space
		const X = ((cx - width / 2) * Z) / fx;
		const Y = -((cy - height / 2) * Z) / fy;

		targetPos.set(X, Y, -Z);

		// Orientation angles
		const roll = Math.atan2(p1.y - p0.y, p1.x - p0.x);
		const pitch = Math.atan2(botW - topW, span) * 1.5;
		const yaw = Math.atan2(rightH - leftH, span) * 1.5;

		const euler = new THREE.Euler(pitch, yaw, -roll, 'YXZ');
		targetQuat.setFromEuler(euler);

		targetScale = (Z * span) / fy * 0.95;
		hasTarget = true;
	}

	onMount(() => {
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
		camera.position.set(0, 0, 0);

		renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		renderer.setSize(width, height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		// Scene lighting
		const ambient = new THREE.AmbientLight(0xffffff, 1.2);
		scene.add(ambient);

		const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
		dirLight.position.set(2, 4, 3);
		scene.add(dirLight);

		const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.0);
		rimLight.position.set(-3, -2, 2);
		scene.add(rimLight);

		scene.add(modelRoot);
		modelRoot.visible = false;

		function animate() {
			animId = requestAnimationFrame(animate);

			updatePose();

			if (hasTarget && visible) {
				modelRoot.visible = true;
				// Smooth damping toward detected pose
				modelRoot.position.lerp(targetPos, 0.35);
				modelRoot.quaternion.slerp(targetQuat, 0.35);

				// Subtle slow ambient floating rotation
				spinAngle += 0.015;
				if (currentMesh) {
					currentMesh.rotation.y = spinAngle;
					// Subtle vertical float
					currentMesh.position.y = Math.sin(spinAngle * 2) * 0.04;
				}

				const currentScale = modelRoot.scale.x;
				const nextScale = currentScale + (targetScale - currentScale) * 0.35;
				modelRoot.scale.setScalar(nextScale);
			} else {
				modelRoot.visible = false;
			}

			if (renderer && scene && camera) {
				renderer.render(scene, camera);
			}
		}

		animId = requestAnimationFrame(animate);
	});

	$effect(() => {
		if (renderer && camera && width > 0 && height > 0) {
			renderer.setSize(width, height);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		}
	});

	onDestroy(() => {
		cancelAnimationFrame(animId);
		renderer?.dispose();
	});
</script>

<canvas
	bind:this={canvas}
	class="pointer-events-none absolute inset-0 z-20 h-full w-full {visible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300"
></canvas>
