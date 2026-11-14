import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { ArtManifest, ModelSpec } from '../manifest/types';
import { buildNormalizedModelHierarchy } from './modelNormalization';

const cache = new Map<string, THREE.Group>();
const inFlight = new Map<string, Promise<THREE.Group>>();
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

let gltfLoader: GLTFLoader | null = null;

function getGltfLoader(): GLTFLoader {
	if (!gltfLoader) {
		gltfLoader = new GLTFLoader();
		const draco = new DRACOLoader();
		draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
		gltfLoader.setDRACOLoader(draco);
	}
	return gltfLoader;
}

/** Clones a cached group along with per-instance material copies for safe opacity cross-fading. */
function cloneGroupWithMaterials(source: THREE.Group): THREE.Group {
	const clone = source.clone();
	clone.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			if (Array.isArray(child.material)) {
				child.material = child.material.map((mat) => {
					const m = mat.clone();
					m.userData.baseOpacity = m.opacity ?? 1;
					return m;
				});
			} else if (child.material) {
				const m = child.material.clone();
				m.userData.baseOpacity = m.opacity ?? 1;
				child.material = m;
			}
		}
	});
	return clone;
}

/** Ensures raw OBJ meshes have vertex normals, usable PBR materials, and cached baseOpacity without mutating geometry positions. */
function prepareRawObjGroup(group: THREE.Group): THREE.Group {
	group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			if (!child.geometry.attributes.normal) {
				child.geometry.computeVertexNormals();
			}
			// If default material, use a clean reflective aesthetic PBR material
			if (
				!child.material ||
				(Array.isArray(child.material) && child.material.length === 0) ||
				(child.material instanceof THREE.MeshBasicMaterial &&
					child.material.color.getHex() === 0xffffff)
			) {
				child.material = new THREE.MeshStandardMaterial({
					color: 0xd1d5db,
					roughness: 0.25,
					metalness: 0.35,
					side: THREE.DoubleSide
				});
			}
			if (Array.isArray(child.material)) {
				child.material.forEach((m) => {
					m.userData.baseOpacity = m.opacity ?? 1;
				});
			} else if (child.material) {
				child.material.userData.baseOpacity = child.material.opacity ?? 1;
			}
		}
	});
	return group;
}

/** Normalizes any 3D mesh hierarchy using the non-destructive normalization hierarchy. */
export function normalizeModel(group: THREE.Group, spec?: Partial<ModelSpec>): THREE.Group {
	return buildNormalizedModelHierarchy(prepareRawObjGroup(group), spec);
}

/** Parses raw OBJ text (e.g. from user drag-and-drop or file input) into a normalized Three.js Group. */
export function parseOBJ(text: string): THREE.Group {
	const group = objLoader.parse(text);
	return buildNormalizedModelHierarchy(prepareRawObjGroup(group), {
		url: 'inline.obj',
		mode: 'overlay',
		pivot: 'center'
	});
}

/**
 * Loads a raw .obj model from a URL (with optional accompanying .mtl) without shifting its raw vertices.
 */
export async function loadOBJ(url: string, mtlUrl?: string): Promise<THREE.Group> {
	if (cache.has(url)) {
		return cloneGroupWithMaterials(cache.get(url)!);
	}

	if (mtlUrl) {
		try {
			const materials = await mtlLoader.loadAsync(mtlUrl);
			materials.preload();
			objLoader.setMaterials(materials);
		} catch {
			// MTL failed, continue with default materials
			objLoader.setMaterials(null as unknown as MTLLoader.MaterialCreator);
		}
	} else {
		objLoader.setMaterials(null as unknown as MTLLoader.MaterialCreator);
	}

	const group = await objLoader.loadAsync(url);
	const raw = prepareRawObjGroup(group);
	cache.set(url, raw);
	return cloneGroupWithMaterials(raw);
}

/**
 * Loads a .glb or .gltf model preserving exact author/manifest coordinates (1 unit = 1 canvas width).
 */
export async function loadGLB(url: string): Promise<THREE.Group> {
	if (cache.has(url)) {
		return cloneGroupWithMaterials(cache.get(url)!);
	}

	let pending = inFlight.get(url);
	if (!pending) {
		const loader = getGltfLoader();
		pending = loader.loadAsync(url).then((gltf) => {
			const wrapper = new THREE.Group();
			wrapper.add(gltf.scene);
			wrapper.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					if (Array.isArray(child.material)) {
						child.material.forEach((m) => {
							m.userData.baseOpacity = m.opacity ?? 1;
						});
					} else if (child.material) {
						child.material.userData.baseOpacity = child.material.opacity ?? 1;
					}
				}
			});
			cache.set(url, wrapper);
			inFlight.delete(url);
			return wrapper;
		});
		inFlight.set(url, pending);
	}

	try {
		const base = await pending;
		return cloneGroupWithMaterials(base);
	} catch (err) {
		inFlight.delete(url);
		throw err;
	}
}

/**
 * Loads any supported 3D model (.glb, .gltf, or .obj) and wraps it in the normalized placement hierarchy.
 */
export async function loadModel3D(
	url: string,
	options?: { mtlUrl?: string; spec?: Partial<ModelSpec> }
): Promise<THREE.Group> {
	const cleanUrl = url.split('?')[0].toLowerCase();
	const model =
		cleanUrl.endsWith('.glb') || cleanUrl.endsWith('.gltf')
			? await loadGLB(url)
			: await loadOBJ(url, options?.mtlUrl);

	return buildNormalizedModelHierarchy(model, {
		...options?.spec,
		url: options?.spec?.url ?? url
	});
}

/** Preloads all single & combined models associated with a tracked canvas ID (and its pair rules). */
export async function preloadPairModels(manifest: ArtManifest, canvasId: string): Promise<void> {
	const urls = new Set<string>();
	const partnerIds = new Set<string>([canvasId]);

	for (const rule of manifest.seamRules) {
		if (rule.canvasAId === canvasId || rule.canvasBId === canvasId) {
			urls.add(rule.combinedModel.url);
			partnerIds.add(rule.canvasAId);
			partnerIds.add(rule.canvasBId);
		}
	}

	for (const canvas of manifest.canvases) {
		if (partnerIds.has(canvas.id)) {
			urls.add(canvas.singleModel.url);
		}
	}

	await Promise.allSettled(Array.from(urls).map((url) => loadModel3D(url)));
}

/** Preloads every single and combined model declared in the manifest. */
export async function preloadManifestModels(manifest: ArtManifest): Promise<void> {
	const urls = new Set<string>();
	for (const canvas of manifest.canvases) {
		urls.add(canvas.singleModel.url);
	}
	for (const rule of manifest.seamRules) {
		urls.add(rule.combinedModel.url);
	}
	await Promise.allSettled(Array.from(urls).map((url) => loadModel3D(url)));
}

/**
 * Resolves the appropriate model URL for a given painting ID.
 */
export async function resolveModelUrl(paintingId: string, customUrl?: string | null): Promise<string> {
	if (customUrl) {
		try {
			const res = await fetch(customUrl, { method: 'HEAD' });
			if (res.ok) return customUrl;
		} catch {
			// fallback
		}
	}

	const candidates = [
		`/demo/models/${paintingId}_single.glb`,
		`/models/${paintingId}.obj`,
		`/models/model.obj`,
		`/demo/models/default.glb`,
		`/models/default.obj`
	];

	for (const path of candidates) {
		try {
			const res = await fetch(path, { method: 'HEAD' });
			if (res.ok) return path;
		} catch {
			// continue
		}
	}

	return '/demo/models/default.glb';
}
