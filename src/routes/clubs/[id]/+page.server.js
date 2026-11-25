import { error, fail, redirect } from '@sveltejs/kit';
import { deleteClub, eventsForClub, getClub, joinClub, leaveClub, todayISO, updateClub } from '#lib/server/db.js';

function load1(params, locals) {
	const club = getClub(Number(params.id), locals.person.id);
	if (!club) error(404, 'Club not found');
	return club;
}

export function load({ params, locals }) {
	const club = load1(params, locals);
	return { club, events: eventsForClub(club.id, todayISO()), mine: club.created_by === locals.person.id };
}

export const actions = {
	join: ({ params, locals }) => {
		joinClub(load1(params, locals).id, locals.person.id);
	},
	leave: ({ params, locals }) => {
		leaveClub(load1(params, locals).id, locals.person.id);
	},
	save: async ({ params, locals, request }) => {
		const club = load1(params, locals);
		if (club.created_by !== locals.person.id) error(403, 'Only the person who started the club can change it');
		const fd = await request.formData();
		const name = (fd.get('name') ?? '').toString().trim().replace(/\s+/g, ' ');
		const description = (fd.get('description') ?? '').toString().trim();
		if (name.length < 2 || name.length > 30) return fail(400, { error: 'Give the club a name between 2 and 30 characters', name, description });
		if (description.length > 200) return fail(400, { error: 'Keep the description under 200 characters', name, description });
		const r = updateClub(club.id, name, description);
		if (r.error) return fail(400, { error: r.error, name, description });
	},
	delete: ({ params, locals }) => {
		const club = load1(params, locals);
		if (club.created_by !== locals.person.id) error(403, 'Only the person who started the club can delete it');
		deleteClub(club.id);
		redirect(303, '/clubs');
	}
};
