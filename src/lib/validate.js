// Pure validation for event form input. Used on the server; safe to import anywhere.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s) {
	if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
	const d = new Date(s + 'T00:00:00Z');
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseTags(raw) {
	if (typeof raw !== 'string') return [];
	const seen = new Set();
	for (const part of raw.split(/[,\n]/)) {
		const t = part.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 24);
		if (t) seen.add(t);
		if (seen.size >= 8) break;
	}
	return [...seen];
}

export function cleanLink(raw) {
	const s = (raw ?? '').toString().trim();
	if (!s) return { ok: true, value: null };
	if (s.length > 300) return { ok: false };
	try {
		const u = new URL(s);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
		return { ok: true, value: u.toString() };
	} catch {
		return { ok: false };
	}
}

/**
 * @param {FormData} fd
 * @param {{ today: string, requireFuture: boolean }} opts
 */
export function validateEvent(fd, { today, requireFuture }) {
	const get = (k) => (fd.get(k) ?? '').toString().trim();
	const errors = {};
	const title = get('title');
	const description = get('description');
	const location = get('location');
	const start = get('start_date');
	const end = get('end_date');
	const link = cleanLink(get('chat_link'));

	if (!title) errors.title = 'Give it a title';
	else if (title.length > 80) errors.title = 'Keep the title under 80 characters';
	if (description.length > 1000) errors.description = 'Keep the description under 1000 characters';
	if (location.length > 120) errors.location = 'Keep the location under 120 characters';
	if (!isValidDate(start)) errors.start_date = 'Pick a start date';
	if (end && !isValidDate(end)) errors.end_date = 'That end date is not valid';
	if (!errors.start_date && !errors.end_date && end && end < start)
		errors.end_date = 'End date is before the start date';
	if (!errors.start_date && !errors.end_date && requireFuture && (end || start) < today)
		errors.start_date = 'That event has already finished';
	if (!link.ok) errors.chat_link = 'Enter a full http(s) link, e.g. a WhatsApp invite';

	const values = {
		title,
		description,
		location,
		tags: parseTags(get('tags')),
		start_date: start,
		end_date: end && end !== start ? end : null,
		chat_link: link.ok ? link.value : null
	};
	return { ok: Object.keys(errors).length === 0, errors, values };
}
