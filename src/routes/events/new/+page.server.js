import { fail, redirect } from '@sveltejs/kit';
import { validateEvent } from '#lib/validate.js';
import { clubIdSet, createEvent, listClubs, setImage, todayISO } from '#lib/server/db.js';
import { resolveImage } from '#lib/server/images.js';

export function load({ locals }) {
	return { clubs: listClubs(locals.person.id).map((c) => ({ id: c.id, name: c.name })) };
}

export const actions = {
	default: async ({ request, locals }) => {
		const fd = await request.formData();
		const today = todayISO();
		const { ok, errors, values } = validateEvent(fd, { today, requireFuture: true, clubIds: clubIdSet() });
		const img = ok ? await resolveImage({ file: fd.get('image'), url: fd.get('image_url') }) : null;
		if (img?.error) errors.image = img.error;
		if (!ok || img?.error) return fail(400, { errors, values });
		const id = createEvent(values, locals.person.id);
		if (img?.name) setImage(id, img.name);
		redirect(303, `/events/${id}`);
	}
};
