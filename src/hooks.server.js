import { redirect } from '@sveltejs/kit';
import { COOKIE, passwordConfigured, readSession } from '#lib/server/auth.js';
import { db, getPerson } from '#lib/server/db.js';
import { apiError, authenticate } from '#lib/server/api.js';

const PUBLIC_PATHS = new Set(['/login', '/healthz', '/manifest.webmanifest', '/robots.txt', '/service-worker.js']);
const isAsset = (p) => p.startsWith('/_app/') || p.startsWith('/icon');

function withHeaders(res) {
	res.headers.set('X-Robots-Tag', 'noindex, nofollow');
	res.headers.set('X-Content-Type-Options', 'nosniff');
	res.headers.set('X-Frame-Options', 'DENY');
	res.headers.set('Referrer-Policy', 'same-origin');
	res.headers.set('Cache-Control', res.headers.get('Cache-Control') ?? 'no-store');
	return res;
}

export async function handle({ event, resolve }) {
	const path = event.url.pathname;

	if (path === '/healthz') {
		try {
			db().prepare('SELECT 1').get();
			return withHeaders(new Response('ok'));
		} catch {
			return withHeaders(new Response('db error', { status: 500 }));
		}
	}

	// Token-authenticated JSON API: its own bearer auth, no cookie session. The spec is public.
	if (path.startsWith('/api/v1/')) {
		if (path !== '/api/v1/openapi.json') {
			const auth = authenticate(event);
			if (auth.response) return withHeaders(auth.response);
			event.locals.person = auth.person;
		}
		try {
			return withHeaders(await resolve(event));
		} catch {
			return withHeaders(apiError(500, 'Internal error'));
		}
	}

	// Calendar subscription feed: authenticated by the secret token in the path (calendar apps can't log in).
	if (path.startsWith('/calendar/')) {
		return withHeaders(await resolve(event));
	}

	if (!passwordConfigured()) {
		return withHeaders(
			new Response('Invites is not configured: set INVITES_PASSWORD (at least 8 characters).', { status: 503 })
		);
	}

	const session = readSession(event.cookies.get(COOKIE));
	event.locals.session = session;
	event.locals.person = session?.pid ? getPerson(session.pid) : null;

	if (isAsset(path) || PUBLIC_PATHS.has(path)) {
		const res = await resolve(event);
		return isAsset(path) ? res : withHeaders(res);
	}

	const wantsJson = path.startsWith('/api/');

	if (!session) {
		if (wantsJson) return withHeaders(Response.json({ error: 'unauthorised' }, { status: 401 }));
		redirect(303, '/login');
	}
	if (!event.locals.person && path !== '/who' && path !== '/logout') {
		if (wantsJson) return withHeaders(Response.json({ error: 'choose a name first' }, { status: 401 }));
		redirect(303, '/who');
	}

	return withHeaders(await resolve(event));
}
