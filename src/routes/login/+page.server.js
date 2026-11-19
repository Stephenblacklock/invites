import { fail, redirect } from '@sveltejs/kit';
import {
	checkPassword,
	clearLoginFailures,
	clientIp,
	loginBlocked,
	recordLoginFailure,
	setSessionCookie
} from '#lib/server/auth.js';

export function load({ locals }) {
	if (locals.session) redirect(303, '/');
}

export const actions = {
	default: async (event) => {
		const ip = clientIp(event);
		if (loginBlocked(ip)) return fail(429, { error: 'Too many attempts. Try again in a few minutes.' });

		const fd = await event.request.formData();
		if (!checkPassword(fd.get('password'))) {
			recordLoginFailure(ip);
			return fail(401, { error: 'Wrong password.' });
		}
		clearLoginFailures(ip);
		setSessionCookie(event, 0);
		redirect(303, '/who');
	}
};
