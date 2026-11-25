import { listClubs } from '#lib/server/db.js';
import { json } from '#lib/server/api.js';

/** All clubs with their members, so events can be put in one by name. */
export function GET({ locals }) {
	const clubs = listClubs(locals.person.id);
	return json({
		count: clubs.length,
		clubs: clubs.map((c) => ({ name: c.name, description: c.description, members: c.members.map((m) => m.name), upcoming_events: c.upcoming }))
	});
}
