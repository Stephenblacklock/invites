import { fail, redirect } from '@sveltejs/kit';
import { createClub, getClub, joinClub, leaveClub, listClubs } from '#lib/server/db.js';

export function load({ locals }) {
	return { clubs: listClubs(locals.person.id) };
}

export const actions = {
	create: async ({ request, locals }) => {
		const fd = await request.formData();
		const name = (fd.get('name') ?? '').toString().trim().replace(/\s+/g, ' ');
		const description = (fd.get('description') ?? '').toString().trim();
		const back = { where: 'create', name, description };
		if (name.length < 2 || name.length > 30) return fail(400, { ...back, error: 'Give the club a name between 2 and 30 characters' });
		if (description.length > 200) return fail(400, { ...back, error: 'Keep the description under 200 characters' });
		const r = createClub(name, description, locals.person.id);
		if (r.error) return fail(400, { ...back, error: r.error });
		redirect(303, `/clubs/${r.id}`);
	},
	join: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('club'));
		if (getClub(id, locals.person.id)) joinClub(id, locals.person.id);
	},
	leave: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('club'));
		leaveClub(id, locals.person.id);
	}
};
