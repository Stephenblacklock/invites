import { fail, redirect } from '@sveltejs/kit';
import { setSessionCookie } from '#lib/server/auth.js';
import { createPerson, findPersonByName, getPerson, listPeople } from '#lib/server/db.js';

export function load({ locals }) {
	return { people: listPeople(), currentId: locals.person?.id ?? null };
}

export const actions = {
	pick: async (event) => {
		const fd = await event.request.formData();
		const person = getPerson(Number(fd.get('id')));
		if (!person || person.disabled) return fail(400, { error: 'Pick a name from the list.' });
		setSessionCookie(event, person.id, person.sess_epoch);
		redirect(303, '/');
	},
	create: async (event) => {
		const fd = await event.request.formData();
		const name = (fd.get('name') ?? '').toString().trim().replace(/\s+/g, ' ');
		if (!name) return fail(400, { error: 'Type a name first.', name });
		if (name.length > 30) return fail(400, { error: 'Keep it under 30 characters.', name });
		if (findPersonByName(name))
			return fail(400, { error: 'That name is taken. If it is you, tap it in the list above.', name });
		const id = createPerson(name);
		setSessionCookie(event, id, 0);
		redirect(303, '/');
	}
};
