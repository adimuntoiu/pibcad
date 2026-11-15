import { describe, it, expect } from 'vitest';

describe('Auth Route Guard Logic', () => {
	function checkRouteAccess(pathname: string, user: { id: string } | null): { allowed: boolean; redirectUrl?: string } {
		if (pathname.startsWith('/artist')) {
			if (!user) {
				return {
					allowed: false,
					redirectUrl: `/login?redirectTo=${encodeURIComponent(pathname)}`
				};
			}
		}
		return { allowed: true };
	}

	it('blocks unauthenticated access to /artist and redirects to /login', () => {
		const res = checkRouteAccess('/artist', null);
		expect(res.allowed).toBe(false);
		expect(res.redirectUrl).toBe('/login?redirectTo=%2Fartist');
	});

	it('blocks unauthenticated access to /artist/galleries/new and preserves redirectTo', () => {
		const res = checkRouteAccess('/artist/galleries/new', null);
		expect(res.allowed).toBe(false);
		expect(res.redirectUrl).toBe('/login?redirectTo=%2Fartist%2Fgalleries%2Fnew');
	});

	it('allows authenticated users to access /artist', () => {
		const res = checkRouteAccess('/artist', { id: 'test-artist-id' });
		expect(res.allowed).toBe(true);
		expect(res.redirectUrl).toBeUndefined();
	});

	it('allows anyone to access public routes like / and /saved', () => {
		expect(checkRouteAccess('/', null).allowed).toBe(true);
		expect(checkRouteAccess('/saved', null).allowed).toBe(true);
		expect(checkRouteAccess('/login', null).allowed).toBe(true);
	});
});

describe('User Profile Metadata Extraction', () => {
	function extractProfileDefaults(user: { email: string; raw_user_meta_data?: { display_name?: string; username?: string } }) {
		return {
			username: user.raw_user_meta_data?.username || user.email.split('@')[0],
			display_name: user.raw_user_meta_data?.display_name || user.email.split('@')[0].toUpperCase(),
			role: 'artist',
			approved: true,
			meshy_daily_quota: 10
		};
	}

	it('extracts display name and username or defaults to email handle', () => {
		const profile1 = extractProfileDefaults({
			email: 'sonia.art@example.com',
			raw_user_meta_data: { display_name: 'Sonia Delaunay', username: 'sonia' }
		});
		expect(profile1.display_name).toBe('Sonia Delaunay');
		expect(profile1.username).toBe('sonia');

		const profile2 = extractProfileDefaults({
			email: 'irlo@streetart.org'
		});
		expect(profile2.display_name).toBe('IRLO');
		expect(profile2.username).toBe('irlo');
	});
});
