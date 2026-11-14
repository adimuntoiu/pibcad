export type EdgeLetter = 'A' | 'B' | 'C' | 'D';

/** Local edge orientation for a square canvas in its canonical reference photo. */
export interface CanvasEdgeMap {
	top: EdgeLetter; // default 'A'
	right: EdgeLetter; // default 'B'
	bottom: EdgeLetter; // default 'D'
	left: EdgeLetter; // default 'C'
}

export type PlacementMode = 'overlay' | 'standout' | 'inside';
export type AxisConvention = 'yUp' | 'zUp';
export type PivotPoint = 'front' | 'base' | 'center' | 'back';
export type FitDimension = 'width' | 'height' | 'max';

/** 3D model specification with transform offsets in canvas-width units (1 unit = canvas width). */
export interface ModelSpec {
	url: string;
	mode?: PlacementMode;
	scale?: number;
	fitDimension?: FitDimension;
	fitFraction?: number;
	offset?: [number, number, number];
	/** Euler rotation in degrees [rx, ry, rz] applied in calibration/placement space. */
	rotation?: [number, number, number];
	axisConvention?: AxisConvention;
	flip?: [boolean, boolean, boolean];
	pivot?: PivotPoint;
	depthScale?: number;
	anchors?: Record<string, [number, number]>;
}

/** Fully resolved placement specification with all defaults materialized. */
export interface NormalizedModelSpec {
	url: string;
	mode: PlacementMode;
	scale: number;
	fitDimension: FitDimension;
	fitFraction: number;
	offset: [number, number, number];
	rotation: [number, number, number];
	axisConvention: AxisConvention;
	flip: [boolean, boolean, boolean];
	pivot: PivotPoint;
	depthScale: number;
	anchors?: Record<string, [number, number]>;
}

/** A single canvas (or tile) configuration. */
export interface CanvasConfig {
	id: string;
	name: string;
	aliases?: string[];
	imageTargetUrl: string;
	edges: CanvasEdgeMap;
	singleModel: ModelSpec;
}

/** Seam rule matching a facing edge letter on Canvas A and Canvas B. */
export interface SeamRule {
	id: string;
	canvasAId: string;
	canvasBId: string;
	edgeA: EdgeLetter;
	edgeB: EdgeLetter;
	combinedModel: ModelSpec;
}

/** Geometric constraints for a valid seam (distances in canvas-width units). */
export interface SeamTolerances {
	maxGapRatio: number;
	maxLateralOffsetRatio: number;
	maxNormalAngleDeg: number;
}

export interface AnimationConfig {
	loadingDurationMs: number;
	stateDebounceFrames: number;
	dropHoldMs: number;
	crossFadeDurationMs: number;
}

export interface ArtManifest {
	version: string;
	artist: string;
	tolerances: SeamTolerances;
	canvases: CanvasConfig[];
	seamRules: SeamRule[];
	animation: AnimationConfig;
}
