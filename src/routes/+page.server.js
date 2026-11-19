import { deckFor, todayISO } from '#lib/server/db.js';

export function load({ locals }) {
	return { events: deckFor(locals.person.id, todayISO()) };
}
