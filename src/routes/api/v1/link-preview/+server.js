import { apiError, json } from '#lib/server/api.js';
import { previewAllowed, previewLink } from '#lib/server/linkinfo.js';

/** Read a public event/ticket page and suggest event fields. Nothing is saved. */
export async function GET({ url, locals }) {
	if (!previewAllowed(`api:${locals.person.id}`)) return apiError(429, 'Too many link previews, try again in a minute');
	const link = (url.searchParams.get('url') ?? '').trim();
	if (!link || link.length > 500) return apiError(400, 'Provide a full https link in ?url=');
	const r = await previewLink(link);
	if (r.error) return apiError(422, r.error);
	return json({ source: r.source, suggestion: r.info, note: 'Check the date and venue, then pass these fields (image as image_url) to create_event.' });
}
