import type {
	ArtManifest,
	CanvasConfig,
	EdgeLetter,
	ModelSpec,
	NormalizedModelSpec,
	PivotPoint,
	PlacementMode
} from './types';

export interface ManifestRepository {
	loadManifest(): Promise<ArtManifest>;
}

const DEFAULT_EDGES = {
	top: 'A' as EdgeLetter,
	right: 'B' as EdgeLetter,
	left: 'C' as EdgeLetter,
	bottom: 'D' as EdgeLetter
};

export function defaultPivotForMode(mode: PlacementMode): PivotPoint {
	if (mode === 'standout') return 'base';
	if (mode === 'inside') return 'center';
	return 'front';
}

export function normalizeModelSpec(spec: ModelSpec): NormalizedModelSpec {
	const mode: PlacementMode = spec.mode ?? 'overlay';
	return {
		url: spec.url,
		mode,
		scale: typeof spec.scale === 'number' && Number.isFinite(spec.scale) ? spec.scale : 1.0,
		fitDimension: spec.fitDimension ?? 'width',
		fitFraction:
			typeof spec.fitFraction === 'number' && Number.isFinite(spec.fitFraction)
				? spec.fitFraction
				: 1.0,
		offset: spec.offset ? [spec.offset[0] ?? 0, spec.offset[1] ?? 0, spec.offset[2] ?? 0] : [0, 0, 0],
		rotation: spec.rotation
			? [spec.rotation[0] ?? 0, spec.rotation[1] ?? 0, spec.rotation[2] ?? 0]
			: [0, 0, 0],
		axisConvention: spec.axisConvention ?? 'yUp',
		flip: spec.flip ? [Boolean(spec.flip[0]), Boolean(spec.flip[1]), Boolean(spec.flip[2])] : [false, false, false],
		pivot: spec.pivot ?? defaultPivotForMode(mode),
		depthScale:
			typeof spec.depthScale === 'number' && Number.isFinite(spec.depthScale)
				? spec.depthScale
				: 1.0,
		...(spec.anchors ? { anchors: spec.anchors } : {})
	};
}

/** Validates and normalizes raw manifest JSON with safe defaults. */
export function normalizeManifest(raw: Partial<ArtManifest>): ArtManifest {
	if (!raw || !Array.isArray(raw.canvases)) {
		throw new Error('Invalid manifest: missing canvases array');
	}

	return {
		version: raw.version ?? '1.0.0',
		artist: raw.artist ?? 'IRLO',
		tolerances: {
			maxGapRatio: raw.tolerances?.maxGapRatio ?? 0.2,
			maxLateralOffsetRatio: raw.tolerances?.maxLateralOffsetRatio ?? 0.35,
			maxNormalAngleDeg: raw.tolerances?.maxNormalAngleDeg ?? 20
		},
		animation: {
			loadingDurationMs: raw.animation?.loadingDurationMs ?? 1200,
			stateDebounceFrames: raw.animation?.stateDebounceFrames ?? 5,
			dropHoldMs: raw.animation?.dropHoldMs ?? 500,
			crossFadeDurationMs: raw.animation?.crossFadeDurationMs ?? 400
		},
		canvases: raw.canvases.map((c) => ({
			...c,
			edges: { ...DEFAULT_EDGES, ...c.edges },
			singleModel: normalizeModelSpec(c.singleModel)
		})),
		seamRules: (raw.seamRules ?? []).map((r) => ({
			...r,
			combinedModel: normalizeModelSpec(r.combinedModel)
		}))
	};
}

/**
 * Resolves a backend or tracker painting ID (including aliases like `painting-c-monolith-i`)
 * to its canonical manifest `CanvasConfig`.
 */
export function resolveCanvasConfig(
	manifest: ArtManifest,
	paintingId: string | null | undefined
): CanvasConfig | null {
	if (!paintingId) return null;
	for (const c of manifest.canvases) {
		if (c.id === paintingId || c.aliases?.includes(paintingId)) {
			return c;
		}
	}
	return null;
}

/** Computes which edge letter sits at each physical side (Top/Right/Bottom/Left) after CW rotation. */
export function getRotatedEdgeLabels(
	edges: CanvasConfig['edges'],
	cwRotationDeg: number
): { top: EdgeLetter; right: EdgeLetter; bottom: EdgeLetter; left: EdgeLetter } {
	const steps = ((Math.round(cwRotationDeg / 90) % 4) + 4) % 4;
	const ring: EdgeLetter[] = [edges.top, edges.right, edges.bottom, edges.left];
	const shifted = [0, 1, 2, 3].map((i) => ring[(i - steps + 4) % 4]);
	return {
		top: shifted[0],
		right: shifted[1],
		bottom: shifted[2],
		left: shifted[3]
	};
}

export class StaticManifestRepository implements ManifestRepository {
	constructor(
		private readonly url = '/demo/manifest.json',
		private readonly fetcher: typeof fetch = fetch
	) {}

	async loadManifest(): Promise<ArtManifest> {
		const res = await this.fetcher(this.url);
		if (!res.ok) {
			throw new Error(`Failed to fetch manifest from ${this.url} (HTTP ${res.status})`);
		}
		const raw = (await res.json()) as Partial<ArtManifest>;
		return normalizeManifest(raw);
	}
}
