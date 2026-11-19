import { eventsByDecision } from '#lib/server/db.js';
import { json, shapeEvent } from '#lib/server/api.js';

/** Events the API's person is interested in (their "Plans"). */
export function GET({ locals, url }) {
	const events = eventsByDecision(locals.person.id, 'interested');
	return json({ person: locals.person.name, count: events.length, events: events.map((e) => shapeEvent(e, url)) });
}
