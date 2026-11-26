import { responseCounts, findPersonByName, getEvent, reservationProblem, setImage, setLock, setReservations, todayISO, updateEvent } from '#lib/server/db.js';
import { removeImage, resolveImage } from '#lib/server/images.js';
import { apiError, json, shapeDetail, validateBody } from '#lib/server/api.js';

function load(params) {
	const id = Number(params.id);
	return Number.isInteger(id) && id > 0 ? getEvent(id) : null;
}

export function GET({ params, url, locals }) {
	const e = load(params);
	if (!e) return apiError(404, 'No such event');
	const detail = shapeDetail(e, url, locals.person.id);
	if (e.created_by === locals.person.id) Object.assign(detail, { passed_count: responseCounts(e.id).passed, unseen_count: responseCounts(e.id).unseen });
	return json({ event: detail });
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
	const { locked: _l, lock_note: _n, reserved: _r, ...rest } = body;
	const r = validateBody(rest, { base, today: todayISO(), requireFuture: false });
	if (!r.ok) return apiError(400, 'Validation failed', r.errors);
	let img = null;
	if (body.image_url) {
		img = await resolveImage({ url: body.image_url });
		if (img?.error) return apiError(400, 'Validation failed', { image_url: img.error });
	}
	let rows = null;
	if (body.reserved !== undefined) {
		if (!Array.isArray(body.reserved)) return apiError(400, 'Validation failed', { reserved: 'Must be an array' });
		rows = [];
		for (const x of body.reserved) {
			let pid = null;
			if (x?.person) {
				const p = findPersonByName(String(x.person));
				if (!p) return apiError(400, 'Validation failed', { reserved: `No one called ${x.person}` });
				pid = p.id;
			}
			rows.push({ person_id: pid, note: String(x?.note ?? '').trim() });
		}
		const cap = r.values.capacity ?? e.capacity;
		const problem = reservationProblem(cap, e.interested.filter((p) => !p.waiting).map((p) => p.id), rows);
		if (problem) return apiError(400, 'Validation failed', { reserved: problem });
	}
	updateEvent(e.id, r.values);
	if (rows) setReservations(e.id, rows);
	if (body.locked !== undefined || body.lock_note !== undefined) {
		const lk = body.locked === undefined ? !!e.locked : !!body.locked;
		setLock(e.id, lk, body.lock_note === undefined ? e.lock_note : body.lock_note);
	}
	if (img?.name) {
		setImage(e.id, img.name);
		removeImage(e.image);
	} else if (body.image_url === null && e.image) {
		setImage(e.id, null);
		removeImage(e.image);
	}
	return json({ event: shapeDetail(getEvent(e.id), url, locals.person.id) });
}
