import { clearSwipe, getEvent, setSwipe } from '#lib/server/db.js';

const DECISIONS = new Set(['interested', 'not_interested', 'undo']);

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
	if (!getEvent(eventId)) return Response.json({ error: 'No such event' }, { status: 404 });

	if (decision === 'undo') clearSwipe(locals.person.id, eventId);
	else setSwipe(locals.person.id, eventId, decision);
	return Response.json({ ok: true });
}
