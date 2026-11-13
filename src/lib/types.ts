export interface RecognitionResponse {
	match: boolean;
	id: string | null;
	title: string | null;
	artist: string | null;
	confidence: number;
}

export interface PaintingDetails {
	id: string;
	title: string;
	artist: string;
	image: string;
	imageUrl: string | null;
}

export type ScannerStatus =
	| 'idle'
	| 'starting_camera'
	| 'scanning'
	| 'recognized'
	| 'permission_denied'
	| 'no_camera'
	| 'backend_unreachable';
