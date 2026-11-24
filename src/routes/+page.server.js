import { deckFor, todayISO } from '#lib/server/db.js';
import { warm, withTravel } from '#lib/server/travel.js';

export function load({ locals }) {
	const events = withTravel(locals.person.id, deckFor(locals.person.id, todayISO()));
	warm(locals.person.id, events);
	return { events };
}
