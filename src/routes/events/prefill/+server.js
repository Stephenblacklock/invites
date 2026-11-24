import { json } from '@sveltejs/kit';
import { previewLink } from '#lib/server/linkinfo.js';

// Small per-person limit so a signed-in friend can't turn this into a page-fetching proxy.
const hits = new Map();
function allowed(personId) {
	const now = Date.now();
	const recent = (hits.get(personId) ?? []).filter((t) => now - t < 60_000);
	if (recent.length >= 12) return false;
	recent.push(now);
	hits.set(personId, recent);
	return true;
}

export async function POST({ request, locals }) {
	if (!allowed(locals.person.id)) return json({ error: 'Slow down a little and try again in a minute.' }, { status: 429 });
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
