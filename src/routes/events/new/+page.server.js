import { fail, redirect } from '@sveltejs/kit';
import { validateEvent } from '#lib/validate.js';
import { createEvent, todayISO } from '#lib/server/db.js';

export const actions = {
	default: async ({ request, locals }) => {
		const fd = await request.formData();
		const today = todayISO();
		const { ok, errors, values } = validateEvent(fd, { today, requireFuture: true });
		if (!ok) return fail(400, { errors, values });
		const id = createEvent(values, locals.person.id);
		redirect(303, `/events/${id}`);
	}
};
