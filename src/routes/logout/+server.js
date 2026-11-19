import { redirect } from '@sveltejs/kit';
import { clearSessionCookie } from '#lib/server/auth.js';

export function POST(event) {
	clearSessionCookie(event);
	redirect(303, '/login');
}
