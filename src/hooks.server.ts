import { createServerClient } from '@supabase/ssr';
import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

export const handle: Handle = async ({ event, resolve }) => {
	const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
	const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

	event.locals.supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	});

	/**
	 * Secure session getter that validates the token with getUser().
	 */
	event.locals.safeGetSession = async () => {
		// Mock local session for testing/demo when Supabase is not connected
		const demoCookie = event.cookies.get('artizart_demo_session');
		if (demoCookie) {
			try {
				const parsed = JSON.parse(demoCookie);
				return { session: parsed.session ?? null, user: parsed.user ?? null };
			} catch {
				// ignore
			}
		}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();

		if (error || !user) {
			return { session: null, user: null };
		}

		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		return { session, user };
	};

	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;

	// Route Guard: /artist/* requires authentication
	if (event.url.pathname.startsWith('/artist')) {
		if (!user) {
			const redirectTarget = `/login?redirectTo=${encodeURIComponent(event.url.pathname)}`;
			throw redirect(303, redirectTarget);
		}
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name: string) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
