import { error, json } from '@sveltejs/kit';
import { getEvent, getStations } from '#lib/server/db.js';
import { limiter } from '#lib/server/limit.js';
import { travelFor } from '#lib/server/travel.js';

const allowed = limiter(30);

export async function GET({ params, locals }) {
	const id = Number(params.id);
	const event = Number.isInteger(id) ? getEvent(id) : null;
	if (!event) error(404, 'Event not found');
	const st = getStations(locals.person.id);
	const hasStations = !!(st.home || st.work);
	if (!hasStations || !event.location) return json({ hasStations, rows: [] });
	if (!allowed(locals.person.id)) return json({ hasStations, rows: [], error: 'Slow down a little.' }, { status: 429 });
	return json({ hasStations, rows: await travelFor(locals.person.id, event) });
}
