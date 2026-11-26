import { error } from '@sveltejs/kit';
import { eventsByDecision, listOptions, personByCalToken, todayISO } from '#lib/server/db.js';
import { buildCalendar, chosenDate } from '#lib/server/ics.js';

// Calendar apps can't log in, so this feed is protected by the long random token in its address.
export function GET({ params, url }) {
	const token = params.token;
	const person = /^[A-Za-z0-9_-]{32}$/.test(token) ? personByCalToken(token) : null;
	if (!person) error(404, 'Not found');
	const since = new Date(todayISO() + 'T00:00:00Z');
	since.setUTCDate(since.getUTCDate() - 30);
	const cutoff = since.toISOString().slice(0, 10);
	const items = eventsByDecision(person.id, 'interested')
		.filter((e) => (e.end_date || e.start_date) >= cutoff)
		.map((event) => ({ event, chosen: chosenDate(listOptions(event.id, person.id)) }))
		// a date that is still TBC would put a guess in people's calendars, so wait until one is picked
		.filter(({ event, chosen }) => !event.anytime && (!event.date_tbd || chosen));
	return new Response(buildCalendar(items, { origin: url.origin, name: `Invites (${person.name})` }), {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'cache-control': 'private, max-age=600'
		}
	});
}
