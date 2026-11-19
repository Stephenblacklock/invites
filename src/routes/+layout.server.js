import { todayISO } from '#lib/server/db.js';

export function load({ locals }) {
	return { person: locals.person, today: todayISO() };
}
