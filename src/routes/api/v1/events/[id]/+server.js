import { getEvent, todayISO, updateEvent } from '#lib/server/db.js';
import { apiError, json, shapeDetail, validateBody } from '#lib/server/api.js';

function load(params) {
	const id = Number(params.id);
	return Number.isInteger(id) && id > 0 ? getEvent(id) : null;
}

export function GET({ params, url, locals }) {
	const e = load(params);
	if (!e) return apiError(404, 'No such event');
	return json({ event: shapeDetail(e, url, locals.person.id) });
}

export async function PATCH({ params, request, locals, url }) {
	const e = load(params);
	if (!e) return apiError(404, 'No such event');
	if (e.created_by !== locals.person.id) return apiError(403, 'Only the person who created an event can edit it (the API acts as ' + locals.person.name + ')');
	let body;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Body must be valid JSON');
	}
	const base = { ...e, tags: e.tags };
	const r = validateBody(body, { base, today: todayISO(), requireFuture: false });
	if (!r.ok) return apiError(400, 'Validation failed', r.errors);
	updateEvent(e.id, r.values);
	return json({ event: shapeDetail(getEvent(e.id), url, locals.person.id) });
}
