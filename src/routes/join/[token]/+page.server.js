import { fail, redirect } from '@sveltejs/kit';
import { setSessionCookie } from '#lib/server/auth.js';
import { markInviteUsed, personByInviteToken } from '#lib/server/db.js';

// GET only shows who the link is for; signing in needs a tap (POST) so link previews and scanners don't use it up.
export function load({ params }) {
	const person = personByInviteToken(params.token);
	return { name: person?.name ?? null };
}

export const actions = {
	default: (event) => {
		const person = personByInviteToken(event.params.token);
		if (!person) return fail(404, { error: 'This link has been switched off. Ask Stephen for a new one.' });
		markInviteUsed(person.id);
		setSessionCookie(event, person.id, person.sess_epoch);
		redirect(303, '/');
	}
};
