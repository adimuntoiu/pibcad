/**
 * POST /api/gallery/upload
 *
 * Secure server-side file uploader for Supabase storage buckets
 * ('artwork-images', 'models', 'targets'). Uses the service role key
 * so uploads succeed reliably for authenticated artists as well as demo sessions.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';

function getAdminClient() {
	const url = process.env.PUBLIC_SUPABASE_URL || 'https://vznrfywqybmdtqbqtfyl.supabase.co';
	const serviceKey =
		process.env.SUPABASE_SERVICE_KEY ||
		process.env.SUPABASE_SECKEY ||
		'sb_secret_BFao3sKzpp7sheAlyvkXBQ_bHAYlwaS';
	return createClient(url, serviceKey);
}

export async function POST({ request }: RequestEvent) {
	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const bucket = (formData.get('bucket') as string) || 'artwork-images';
		const filePath = (formData.get('filePath') as string) || `upload_${Date.now()}`;

		if (!(file instanceof Blob)) {
			throw error(400, 'Invalid file payload.');
		}

		const supabase = getAdminClient();
		const arrayBuf = await file.arrayBuffer();
		const uint8 = new Uint8Array(arrayBuf);

		const contentType =
			file.type ||
			(bucket === 'models'
				? 'model/gltf-binary'
				: bucket === 'targets'
					? 'application/octet-stream'
					: 'image/jpeg');

		const { data, error: uploadErr } = await supabase.storage
			.from(bucket)
			.upload(filePath, uint8, {
				contentType,
				upsert: true
			});

		if (uploadErr) {
			console.error('[gallery/upload] Storage upload error:', uploadErr);
			throw error(500, uploadErr.message);
		}

		const { data: pubData } = supabase.storage.from(bucket).getPublicUrl(data.path);
		return json({
			ok: true,
			path: data.path,
			publicUrl: pubData.publicUrl
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[gallery/upload] Error:', msg);
		return json({ ok: false, error: msg }, { status: 500 });
	}
}
