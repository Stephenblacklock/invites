import { fail, redirect } from '@sveltejs/kit';
import { setSessionCookie } from '#lib/server/auth.js';
import { findPersonByName, markInviteUsed, openInvite, personByInviteToken, redeemInvite } from '#lib/server/db.js';

// GET only shows what the link is for; signing in needs a tap (POST) so link previews and scanners don't use it up.
export function load({ params }) {
	if (openInvite(params.token)) return { mode: 'new', name: null };
	const person = personByInviteToken(params.token);
	return person ? { mode: 'back', name: person.name } : { mode: 'dead', name: null };
}

export const actions = {
	default: async (event) => {
		const invite = openInvite(event.params.token);
		if (invite) {
			const fd = await event.request.formData();
			const name = (fd.get('name') ?? '').toString().trim().replace(/\s+/g, ' ');
			if (!name) return fail(400, { error: 'Type your name first.', name });
			if (name.length > 30) return fail(400, { error: 'Keep it under 30 characters.', name });
			if (findPersonByName(name)) return fail(400, { error: 'Someone already has that name. Add a surname or initial.', name });
			let id;
			try {
				id = redeemInvite(invite.id, name);
			} catch {
				return fail(404, { error: 'This invite has already been used. Ask Stephen for a new one.' });
			}
			setSessionCookie(event, id, 0);
			redirect(303, '/');
		}
		const person = personByInviteToken(event.params.token);
		if (!person) return fail(404, { error: 'This link has been switched off. Ask Stephen for a new one.' });
		markInviteUsed(person.id);
		setSessionCookie(event, person.id, person.sess_epoch);
		redirect(303, '/');
	}
};
