export type Point = { x: number; y: number };

/** Response of POST /api/recognize. Corners are normalized (0..1) in the camera frame: TL, TR, BR, BL. */
export interface DetectionResponse {
	match: boolean;
	painting_id: string | null;
	title: string | null;
	artist: string | null;
	corners: [number, number][] | null;
	inliers: number;
}

export type ScannerStatus =
	| 'idle'
	| 'starting_camera'
	| 'scanning'
	| 'detected'
	| 'permission_denied'
	| 'no_camera'
	| 'backend_unreachable';
