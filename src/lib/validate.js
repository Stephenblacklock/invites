// Pure validation for event form input. Used on the server; safe to import anywhere.
import { parseMedia } from './media.js';
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

/** '45', '£45.50', 'free' or '0' → pence; '' → null; anything else → undefined (invalid). */
export function parsePrice(raw) {
	const t = String(raw ?? '').trim().replace(/^£/, '').replace(/,/g, '').toLowerCase();
	if (!t) return null;
	if (t === 'free') return 0;
	if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return undefined;
	return Math.round(parseFloat(t) * 100);
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
	const decideBy = get('decide_by');
	const pMin = parsePrice(get('price_min'));
	const pMax = parsePrice(get('price_max'));
	const media = get('media_link');

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
	if (decideBy) {
		if (!isValidDate(decideBy)) errors.decide_by = 'That date is not valid';
		else if (!errors.start_date && !errors.end_date && decideBy > (end || start)) errors.decide_by = 'Pick a date before the event ends';
		else if (requireFuture && decideBy < today) errors.decide_by = 'That date has already passed';
	}
	if (pMin === undefined) errors.price_min = 'Enter an amount like 45 or 45.50, or "free"';
	if (pMax === undefined) errors.price_max = 'Enter an amount like 60 or 60.50';
	if (!errors.price_min && !errors.price_max && pMax != null) {
		if (pMin == null) errors.price_min = 'Add the lowest price too';
		else if (pMax < pMin) errors.price_max = 'The top price is below the lowest price';
	}
	if (media && !parseMedia(media)) errors.media_link = 'Use a YouTube or Spotify link';
	if (!link.ok) errors.chat_link = 'Enter a full http(s) link, e.g. a WhatsApp invite';

	const values = {
		title,
		description,
		location,
		tags: parseTags(get('tags')),
		start_date: start,
		end_date: end && end !== start ? end : null,
		chat_link: link.ok ? link.value : null,
		decide_by: decideBy || null,
		// keep what was typed when it was invalid so the form can show it again
		price_min: pMin === undefined ? get('price_min') : pMin,
		price_max: pMax === undefined ? get('price_max') : pMax != null && pMax === pMin ? null : pMax,
		media_link: media ? (parseMedia(media)?.link ?? null) : null
	};
	return { ok: Object.keys(errors).length === 0, errors, values };
}
