export interface SavedArtwork {
	artworkId: string;
	title: string;
	artistName: string;
	thumbUrl?: string | null;
	modelUrl?: string | null;
	scannedAt: number;
}
