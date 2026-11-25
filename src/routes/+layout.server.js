import { todayISO } from '#lib/server/db.js';

export function load({ locals }) {
	return {
		person: locals.person && { id: locals.person.id, name: locals.person.name, is_admin: !!locals.person.is_admin },
		today: todayISO()
	};
}
