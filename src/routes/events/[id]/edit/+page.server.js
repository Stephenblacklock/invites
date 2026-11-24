import { error, fail, redirect } from '@sveltejs/kit';
import { validateEvent } from '#lib/validate.js';
import { getEvent, setImage, todayISO, updateEvent } from '#lib/server/db.js';
import { removeImage, resolveImage } from '#lib/server/images.js';

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
		const img = ok ? await resolveImage({ file: fd.get('image'), url: fd.get('image_url') }) : null;
		if (img?.error) errors.image = img.error;
		if (!ok || img?.error) return fail(400, { errors, values: { ...values, image: ev.image } });
		updateEvent(ev.id, values);
		if (img?.name) {
			setImage(ev.id, img.name);
			removeImage(ev.image);
		} else if (fd.get('remove_image') && ev.image) {
			setImage(ev.id, null);
			removeImage(ev.image);
		}
		redirect(303, `/events/${ev.id}`);
	}
};
