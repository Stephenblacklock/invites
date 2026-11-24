import { json } from '@sveltejs/kit';
import { previewAllowed, previewLink } from '#lib/server/linkinfo.js';

export async function POST({ request, locals }) {
	if (!previewAllowed(locals.person.id)) return json({ error: 'Slow down a little and try again in a minute.' }, { status: 429 });
	let url = '';
	try {
		url = String((await request.json())?.url ?? '').trim();
	} catch {
		/* falls through to the empty check */
	}
	if (!url || url.length > 500) return json({ error: 'Paste a full link first.' }, { status: 400 });
	const r = await previewLink(url);
	if (r.error) return json({ error: r.error }, { status: 422 });
	return json(r);
}
