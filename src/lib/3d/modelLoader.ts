import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const cache = new Map<string, THREE.Group>();
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

/** Normalizes any 3D mesh hierarchy so it is centered at origin and scaled to fit unit box [-0.5, 0.5]. */
export function normalizeModel(group: THREE.Group): THREE.Group {
	const box = new THREE.Box3().setFromObject(group);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z);
	const scale = maxDim > 0 ? 1.0 / maxDim : 1.0;

	// Center internal geometry
	group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.geometry.center();
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
		}
	});

	group.scale.setScalar(scale);
	return group;
}

/** Parses raw OBJ text (e.g. from user drag-and-drop or file input) into a normalized Three.js Group. */
export function parseOBJ(text: string): THREE.Group {
	const group = objLoader.parse(text);
	return normalizeModel(group);
}

/**
 * Loads a .obj model from a URL (with optional accompanying .mtl).
 * Falls back through candidate URLs if the primary fails.
 */
export async function loadOBJ(url: string, mtlUrl?: string): Promise<THREE.Group> {
	if (cache.has(url)) {
		return cache.get(url)!.clone();
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
	const normalized = normalizeModel(group);
	cache.set(url, normalized);
	return normalized.clone();
}

/**
 * Resolves the appropriate .obj URL for a given painting ID:
 * 1. Specific model for this painting: /models/{id}.obj
 * 2. Shared model: /models/model.obj
 * 3. Default built-in model: /models/default.obj
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
		`/models/${paintingId}.obj`,
		`/models/model.obj`,
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

	return '/models/default.obj';
}
