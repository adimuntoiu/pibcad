export type RotationDeg = 0 | 90 | 180 | 270;

export type EdgeLetter = 'A' | 'B' | 'C' | 'D';

export type ValidSeamCode = 'AA' | 'BB' | 'CC' | 'DD';

export interface EdgeMap {
	top: EdgeLetter;
	right: EdgeLetter;
	bottom: EdgeLetter;
	left: EdgeLetter;
}

export type ExperienceType = 'shader_blend' | 'video_uploaded' | 'video_generated' | 'model_3d';

export interface ShaderBlendParams {
	speed: number;
	intensity: number;
	waveFrequency?: number;
	seamWidth?: number;
	accentColor?: [number, number, number];
	subtitle?: string;
}

export interface PairExperience {
	id: string;
	pairId: string;
	seamLetter: EdgeLetter;
	type: ExperienceType;
	title: string;
	assetPath: string | null;
	params: ShaderBlendParams & Record<string, unknown>;
	status: 'pending' | 'processing' | 'ready' | 'rejected';
	isActive: boolean;
	version: number;
}

export interface PaintingInfo {
	id: string;
	artistId: string;
	artistName: string;
	title: string;
	year: number;
	medium: string;
	description: string;
	widthCm: number;
	heightCm: number;
	imageUrl: string;
	thumbnailUrl?: string | null;
	trackabilityScore?: number;
	/**
	 * Default edge letters at 0° rotation:
	 * Standard convention: top='A', right='B', left='C', bottom='D'
	 */
	baseEdges: EdgeMap;
	/**
	 * Optional explicit override per rotation (from painting_orientations table)
	 */
	orientationEdges?: Partial<Record<RotationDeg, EdgeMap>>;
	trackingTargetUrl?: string | null;
}

export interface PairInfo {
	id: string;
	paintingA: PaintingInfo;
	paintingB: PaintingInfo;
	published: boolean;
	experiences: Partial<Record<EdgeLetter, PairExperience>>;
}

export interface CanvasPose {
	/** Normalized or Three.js world X coordinate (-1..1) */
	x: number;
	/** Normalized or Three.js world Y coordinate (-1..1) */
	y: number;
	/** Depth / Z offset */
	z: number;
	/** Side length in world units */
	size: number;
	/** In-plane Z rotation in radians */
	rollRad: number;
	/** Snapped 90-degree orientation (0 | 90 | 180 | 270) */
	rotation: RotationDeg;
	/** Tracking confidence (0..1) */
	confidence: number;
}

export interface TrackedCanvas {
	paintingId: string;
	slot: 'A' | 'B';
	rotation: RotationDeg;
	edges: EdgeMap;
	pose: CanvasPose;
	lastSeenAt: number;
}

export interface SeamEvaluation {
	bothTracked: boolean;
	leftCanvas: TrackedCanvas | null;
	rightCanvas: TrackedCanvas | null;
	leftFacingEdge: EdgeLetter | null;
	rightFacingEdge: EdgeLetter | null;
	seamCode: string | null;
	isValidMatch: boolean;
	matchedLetter: EdgeLetter | null;
	activeExperience: PairExperience | null;
}

export type ScannerStatus =
	| 'idle'
	| 'starting_camera'
	| 'scanning'
	| 'one_recognized'
	| 'non_matching'
	| 'valid_arrangement'
	| 'tracking_lost'
	| 'permission_denied'
	| 'no_camera'
	| 'backend_unreachable';

export interface RecognitionResponse {
	match: boolean;
	painting_id: string | null;
	orientation: RotationDeg | null;
	confidence: number;
	// Legacy compatibility fields
	id?: string | null;
	title?: string | null;
	artist?: string | null;
}

export interface PaintingDetails {
	id: string;
	title: string;
	artist: string;
	image: string;
	imageUrl: string | null;
}
