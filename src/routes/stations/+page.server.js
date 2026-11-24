import { fail } from '@sveltejs/kit';
import { getStations, setStation } from '#lib/server/db.js';

export function load({ locals }) {
	return { stations: getStations(locals.person.id) };
}

export const actions = {
	save: async ({ request, locals }) => {
		const fd = await request.formData();
		const kind = (fd.get('kind') ?? '').toString();
		const id = (fd.get('id') ?? '').toString().trim();
		const name = (fd.get('name') ?? '').toString().trim();
		if (kind !== 'home' && kind !== 'work') return fail(400, { error: 'Unknown kind.' });
		if (!/^[A-Za-z0-9]{3,24}$/.test(id) || !name || name.length > 60) return fail(400, { error: 'Pick a station from the list.' });
		setStation(locals.person.id, kind, id, name);
	},
	clear: async ({ request, locals }) => {
		const fd = await request.formData();
		const kind = (fd.get('kind') ?? '').toString();
		if (kind !== 'home' && kind !== 'work') return fail(400, { error: 'Unknown kind.' });
		setStation(locals.person.id, kind, null, null);
	}
};
