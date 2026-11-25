import { deckFor, getInviteToken, listPeople, todayISO } from '#lib/server/db.js';
import { warm, withTravel } from '#lib/server/travel.js';

export function load({ locals, url }) {
	const events = withTravel(locals.person.id, deckFor(locals.person.id, todayISO()));
	warm(locals.person.id, events);
	return {
		events,
		welcome: {
			joinLink: `${url.origin}/join/${getInviteToken(locals.person.id)}`,
			friends: Math.max(0, listPeople().length - 1)
		}
	};
}
