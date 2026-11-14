export type Point = { x: number; y: number };

export interface Pose6DoF {
	position: [number, number, number];
	quaternion: [number, number, number, number];
	normal: [number, number, number];
}

export interface DetectedPainting {
	painting_id: string;
	title: string;
	artist: string;
	corners: [number, number][];
	inliers: number;
	model_path?: string | null;
	rotation_deg?: number;
	snapped_rotation_deg?: number;
	pose?: Pose6DoF | null;
}

/** Response of POST /api/recognize. Supports both multi-painting and single-painting formats. */
export interface DetectionResponse {
	match: boolean;
	count?: number;
	paintings?: DetectedPainting[];
	painting_id: string | null;
	title: string | null;
	artist: string | null;
	corners: [number, number][] | null;
	inliers: number;
	model_url?: string | null;
	model_path?: string | null;
	rotation_deg?: number;
	snapped_rotation_deg?: number;
	pose?: Pose6DoF | null;
}

export type ScannerStatus =
	| 'idle'
	| 'starting_camera'
	| 'scanning'
	| 'detected'
	| 'permission_denied'
	| 'no_camera'
	| 'backend_unreachable';
