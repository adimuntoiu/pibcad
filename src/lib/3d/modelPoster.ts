import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

let offscreenRenderer: THREE.WebGLRenderer | null = null;
let offscreenCanvas: HTMLCanvasElement | null = null;

function getOffscreenRenderer(width = 512, height = 512): THREE.WebGLRenderer {
	if (!offscreenRenderer) {
		offscreenCanvas = document.createElement('canvas');
		offscreenRenderer = new THREE.WebGLRenderer({
			canvas: offscreenCanvas,
			alpha: true,
			antialias: true,
			preserveDrawingBuffer: true
		});
		offscreenRenderer.outputColorSpace = THREE.SRGBColorSpace;
		offscreenRenderer.toneMapping = THREE.ACESFilmicToneMapping;
		offscreenRenderer.toneMappingExposure = 1.15;
	}
	offscreenRenderer.setSize(width, height);
	return offscreenRenderer;
}

/**
 * Renders a single clean frame of a 3D model onto an offscreen canvas
 * and returns it as a JPEG Blob to be used as a 2D poster thumbnail.
 */
export async function generateModelPoster(
	modelSource: File | Blob | string,
	width = 512,
	height = 512
): Promise<Blob | null> {
	if (typeof window === 'undefined') return null;

	const renderer = getOffscreenRenderer(width, height);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);

	// Multi-light rig matching ModelViewer3D
	const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
	scene.add(ambientLight);

	const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
	dirLight.position.set(2, 4, 3);
	scene.add(dirLight);

	const fillLight = new THREE.DirectionalLight(0xbfa5ff, 1.2);
	fillLight.position.set(-2, -1, 2);
	scene.add(fillLight);

	let modelUrl: string;
	let needsRevoke = false;

	if (typeof modelSource === 'string') {
		modelUrl = modelSource;
	} else {
		modelUrl = URL.createObjectURL(modelSource);
		needsRevoke = true;
	}

	try {
		const loader = new GLTFLoader();
		const draco = new DRACOLoader();
		draco.setDecoderPath('/draco/gltf/');
		loader.setDRACOLoader(draco);

		const gltf = await loader.loadAsync(modelUrl);
		const group = gltf.scene;

		// Center and frame
		const box = new THREE.Box3().setFromObject(group);
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z) || 1;

		group.position.sub(center);
		group.rotation.y = 0.4;
		group.rotation.x = 0.15;
		scene.add(group);

		const fovRad = (camera.fov * Math.PI) / 180;
		const fitDist = (maxDim * 0.75) / Math.sin(fovRad / 2);
		camera.position.set(0, 0, fitDist);
		camera.lookAt(0, 0, 0);

		renderer.render(scene, camera);

		// Dispose temporary 3D resources
		group.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry?.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((m) => m.dispose());
				} else if (child.material) {
					child.material.dispose();
				}
			}
		});
		scene.remove(group);

		if (offscreenCanvas) {
			return new Promise<Blob | null>((resolve) => {
				offscreenCanvas!.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
			});
		}
		return null;
	} catch (err) {
		console.warn('Failed to generate model poster snapshot:', err);
		return null;
	} finally {
		if (needsRevoke) {
			URL.revokeObjectURL(modelUrl);
		}
	}
}
