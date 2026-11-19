import { error } from '@sveltejs/kit';
import { eventsByDecision, getEvent, setSwipe, todayISO } from '#lib/server/db.js';

export function load({ locals }) {
	const today = todayISO();
	return {
		events: eventsByDecision(locals.person.id, 'not_interested').filter((e) => (e.end_date || e.start_date) >= today)
	};
}

export const actions = {
	join: async ({ request, locals }) => {
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!getEvent(id)) error(404, 'Event not found');
		setSwipe(locals.person.id, id, 'interested');
	}
};
