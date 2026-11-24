import { error } from '@sveltejs/kit';
import { getEvent, listOptions } from '#lib/server/db.js';
import { buildCalendar, chosenDate } from '#lib/server/ics.js';

export function GET({ params, url, locals }) {
	const id = Number(params.id);
	const event = Number.isInteger(id) ? getEvent(id) : null;
	if (!event) error(404, 'Event not found');
	const chosen = chosenDate(listOptions(event.id, locals.person.id));
	const body = buildCalendar([{ event, chosen }], { origin: url.origin, name: event.title });
	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': `attachment; filename="invites-event-${event.id}.ics"`
		}
	});
}
