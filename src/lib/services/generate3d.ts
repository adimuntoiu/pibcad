export interface Generate3DResult {
	status: 'mock';
	modelUrl: string | null;
}

/**
 * Stub service for generating a 3D relief/scene model from a recognized 2D painting.
 */
export async function generate3D(
	paintingId: string,
	imageUrl: string
): Promise<Generate3DResult> {
	console.info('[generate3D stub] Called for paintingId="' + paintingId + '", imageUrl="' + imageUrl + '"');
	await new Promise((resolve) => setTimeout(resolve, 600));
	return {
		status: 'mock',
		modelUrl: null
	};
}
