import {
	createEvent,
	findDuplicateEvent,
	getEvent,
	listEvents,
	todayISO
} from '#lib/server/db.js';
import { apiError, json, shapeEvent, validateBody } from '#lib/server/api.js';

export function GET({ url }) {
	const scope = url.searchParams.get('scope') ?? 'upcoming';
	if (!['upcoming', 'past', 'all'].includes(scope)) return apiError(400, 'scope must be upcoming, past or all');
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const events = listEvents({ scope, q, today: todayISO() });
	return json({ today: todayISO(), count: events.length, events: events.map((e) => shapeEvent(e, url)) });
}

export async function POST({ request, locals, url }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Body must be valid JSON');
	}
	const today = todayISO();
	const r = validateBody(body, { base: {}, today, requireFuture: true });
	if (!r.ok) return apiError(400, 'Validation failed', r.errors);
	const dup = findDuplicateEvent(r.values.title, r.values.start_date);
	if (dup) {
		return json(
			{ error: 'An event with this title and start date already exists', existing: shapeEvent(getEvent(dup), url) },
			409
		);
	}
	const id = createEvent(r.values, locals.person.id);
	return json({ event: shapeEvent(getEvent(id), url) }, 201);
}
