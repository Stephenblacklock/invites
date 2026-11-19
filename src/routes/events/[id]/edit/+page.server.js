import { error, fail, redirect } from '@sveltejs/kit';
import { validateEvent } from '#lib/validate.js';
import { getEvent, todayISO, updateEvent } from '#lib/server/db.js';

function mine(params, locals) {
	const ev = getEvent(Number(params.id));
	if (!ev) error(404, 'Event not found');
	if (ev.created_by !== locals.person.id) error(403, 'Only the person who added this can edit it');
	return ev;
}

export function load({ params, locals }) {
	return { event: mine(params, locals) };
}

export const actions = {
	default: async ({ params, locals, request }) => {
		const ev = mine(params, locals);
		const fd = await request.formData();
		const { ok, errors, values } = validateEvent(fd, { today: todayISO(), requireFuture: false });
		if (!ok) return fail(400, { errors, values });
		updateEvent(ev.id, values);
		redirect(303, `/events/${ev.id}`);
	}
};
