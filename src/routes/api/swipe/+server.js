import { clearSwipe, getEvent, setSwipe, setInterest, joinBlocked } from '#lib/server/db.js';

const DECISIONS = new Set(['interested', 'not_interested', 'undo', 'interest']);

export async function POST({ request, locals }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: 'Bad JSON' }, { status: 400 });
	}
	const eventId = Number(body?.eventId);
	const decision = body?.decision;
	if (!Number.isInteger(eventId) || !DECISIONS.has(decision))
		return Response.json({ error: 'Bad request' }, { status: 400 });
	const ev = getEvent(eventId);
	if (!ev) return Response.json({ error: 'No such event' }, { status: 404 });
	if ((decision === 'interested' || decision === 'interest') && joinBlocked(locals.person.id, ev))
		return Response.json({ error: 'This event is locked' }, { status: 409 });

	const level = body?.interest == null ? null : Number(body.interest);
	if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= 3))
		return Response.json({ error: 'interest must be 1, 2 or 3' }, { status: 400 });
	if (decision === 'interest') {
		if (level === null) return Response.json({ error: 'interest required' }, { status: 400 });
		setInterest(locals.person.id, eventId, level);
		return Response.json({ ok: true });
	}

	if (decision === 'undo') clearSwipe(locals.person.id, eventId);
	else setSwipe(locals.person.id, eventId, decision, decision === 'interested' ? level : null);
	return Response.json({ ok: true });
}
