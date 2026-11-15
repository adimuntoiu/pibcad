import type { ArtManifest, NormalizedModelSpec } from '../manifest/types';

export async function saveCalibrationSpec(
	targetId: string,
	spec: NormalizedModelSpec
): Promise<{ ok: boolean; manifest?: ArtManifest; error?: string }> {
	const res = await fetch('/_dev/calibration', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetId, spec })
	});
	const data = (await res.json()) as { ok?: boolean; manifest?: ArtManifest; error?: string };
	if (!res.ok || !data.manifest) {
		return { ok: false, error: data.error ?? `Save error (${res.status})` };
	}
	return { ok: true, manifest: data.manifest };
}
