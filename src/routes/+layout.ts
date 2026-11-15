import type { LayoutLoad } from './$types';
import { getSupabaseBrowserClient } from '#lib/supabase/client';

export const load: LayoutLoad = async ({ data, depends }) => {
	depends('supabase:auth');

	const supabase = getSupabaseBrowserClient();

	return {
		supabase,
		session: data.session,
		user: data.user
	};
};
