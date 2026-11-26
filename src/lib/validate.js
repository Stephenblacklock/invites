// Pure validation for event form input. Used on the server; safe to import anywhere.
import { parseMedia } from './media.js';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s) {
	if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
	const d = new Date(s + 'T00:00:00Z');
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Same cleaning as parseTags but a longer list, for the primary tag list. */
export function parseTagList(raw, max = 12) {
	if (typeof raw !== 'string') return [];
	const seen = new Set();
	for (const part of raw.split(/[,\n]/)) {
		const t = part.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 24);
		if (t) seen.add(t);
		if (seen.size >= max) break;
	}
	return [...seen];
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

/** '3' → 3; '' → null; anything that is not a whole number from 1 to 500 → undefined (invalid). */
export function parseCapacity(raw) {
	const t = String(raw ?? '').trim();
	if (!t) return null;
	if (!/^\d{1,3}$/.test(t)) return undefined;
	const n = parseInt(t, 10);
	return n >= 1 && n <= 500 ? n : undefined;
}

/** Stored as the start date of an "anytime" event (no date yet): sorts after everything and never passes. Shown and exported as no date. */
export const ANYTIME = '9999-12-31';

export const MAX_PRICE_ROWS = 8;

/**
 * Price rows come from the form as price_label_N / price_amount_N / price_estimate_N.
 * Blank rows are dropped. An amount that can't be read keeps its raw text so the form can show it again.
 */
function readPriceRows(fd, errors) {
	const rows = [];
	for (let i = 0; i < 20; i++) {
		const label = (fd.get('price_label_' + i) ?? '').toString().trim();
		const rawAmount = (fd.get('price_amount_' + i) ?? '').toString().trim();
		const estimate = ['1', 'on', 'true'].includes((fd.get('price_estimate_' + i) ?? '').toString());
		if (!label && !rawAmount) continue;
		const amount = parsePrice(rawAmount);
		const at = rows.length;
		if (label.length > 40) errors['price_' + at] = 'Keep the label under 40 characters';
		else if (amount === undefined) errors['price_' + at] = 'Enter an amount like 45 or 45.50, or "free"';
		else if (amount === null) errors['price_' + at] = 'Add an amount for this price';
		rows.push({ label, amount: amount ?? rawAmount, estimate });
	}
	if (rows.length > MAX_PRICE_ROWS) errors.prices = `Up to ${MAX_PRICE_ROWS} prices`;
	return rows;
}

/** Lowest and highest of the valid rows (pence), for the cards. price_max stays null unless there is a real range. */
export function priceSummary(rows) {
	const nums = rows.filter((r) => typeof r.amount === 'number').map((r) => r.amount);
	if (!nums.length) return { price_min: null, price_max: null, price_estimate: 0 };
	const lo = Math.min(...nums);
	const hi = Math.max(...nums);
	return { price_min: lo, price_max: hi > lo ? hi : null, price_estimate: rows.some((r) => r.estimate) ? 1 : 0 };
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
 * @param {{ today: string, requireFuture: boolean, clubIds?: Set<number> }} opts  clubIds: the clubs that exist, so a bad club is refused
 */
export function validateEvent(fd, { today, requireFuture, clubIds = new Set() }) {
	const get = (k) => (fd.get(k) ?? '').toString().trim();
	const errors = {};
	const title = get('title');
	const description = get('description');
	const location = get('location');
	const start = get('start_date');
	const end = get('end_date');
	const link = cleanLink(get('chat_link'));
	const decideBy = get('decide_by');
	const flag = (k) => ['1', 'on', 'true'].includes((fd.get(k) ?? '').toString());
	const priceTbd = flag('price_tbd');
	const anytime = flag('anytime');
	const dateTbd = !anytime && flag('date_tbd');
	const minRaw = get('min_people');
	const minPeople = parseCapacity(minRaw);
	// "price to be confirmed" and actual prices are mutually exclusive: TBC wins and the rows are dropped
	const priceRows = priceTbd ? [] : readPriceRows(fd, errors);
	const media = get('media_link');
	const cap = parseCapacity(get('capacity'));
	const clubRaw = get('club');
	const clubId = clubRaw ? Number(clubRaw) : null;

	if (!title) errors.title = 'Give it a title';
	else if (title.length > 80) errors.title = 'Keep the title under 80 characters';
	if (description.length > 1000) errors.description = 'Keep the description under 1000 characters';
	if (location.length > 120) errors.location = 'Keep the location under 120 characters';
	if (!anytime && !isValidDate(start)) errors.start_date = 'Pick a start date, or tick "No date yet"';
	if (!anytime && end && !isValidDate(end)) errors.end_date = 'That end date is not valid';
	if (!anytime && !errors.start_date && !errors.end_date && end && end < start)
		errors.end_date = 'End date is before the start date';
	if (!anytime && !errors.start_date && !errors.end_date && requireFuture && (end || start) < today)
		errors.start_date = 'That event has already finished';
	if (decideBy && !anytime) {
		if (!isValidDate(decideBy)) errors.decide_by = 'That date is not valid';
		else if (!errors.start_date && !errors.end_date && decideBy > (end || start)) errors.decide_by = 'Pick a date before the event ends';
		else if (requireFuture && decideBy < today) errors.decide_by = 'That date has already passed';
	}
	if (minPeople === undefined) errors.min_people = 'Enter a whole number from 1 to 500, or leave it empty';
	else if (minPeople !== null && cap !== undefined && cap !== null && minPeople > cap) errors.min_people = 'That is more than the number of spots';
	if (cap === undefined) errors.capacity = 'Enter a whole number from 1 to 500, or leave it empty';
	if (clubRaw && !(Number.isInteger(clubId) && clubIds.has(clubId))) errors.club = 'Pick one of the clubs in the list';
	if (media && !parseMedia(media)) errors.media_link = 'Use a YouTube or Spotify link';
	if (!link.ok) errors.chat_link = 'Enter a full http(s) link, e.g. a WhatsApp invite';

	const values = {
		title,
		description,
		location,
		tags: parseTags(get('tags')),
		start_date: anytime ? ANYTIME : start,
		anytime: anytime ? 1 : 0,
		min_people: minPeople === undefined ? minRaw : minPeople,
		end_date: !anytime && end && end !== start ? end : null,
		chat_link: link.ok ? link.value : null,
		decide_by: anytime ? null : decideBy || null,
		price_tbd: priceTbd ? 1 : 0,
		date_tbd: dateTbd ? 1 : 0,
		prices: priceRows,
		...priceSummary(priceRows),
		club_id: clubRaw && errors.club === undefined ? clubId : null,
		club: clubRaw,
		capacity: cap === undefined ? get('capacity') : cap,
		media_link: media ? (parseMedia(media)?.link ?? null) : null
	};
	return { ok: Object.keys(errors).length === 0, errors, values };
}
