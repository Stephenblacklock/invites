// Dates are stored and passed around as 'YYYY-MM-DD' strings and formatted in UTC so
// server and client always agree on the output.
const MS_DAY = 86_400_000;

export function parseISO(iso) {
	return new Date(iso + 'T00:00:00Z');
}

export function dayDiff(fromISO, toISO) {
	return Math.round((parseISO(toISO) - parseISO(fromISO)) / MS_DAY);
}

export function fmtDate(iso, today) {
	const d = parseISO(iso);
	const sameYear = today ? iso.slice(0, 4) === today.slice(0, 4) : false;
	return new Intl.DateTimeFormat('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		...(sameYear ? {} : { year: 'numeric' }),
		timeZone: 'UTC'
	}).format(d);
}

export function fmtRange(start, end, today) {
	if (!end || end === start) return fmtDate(start, today);
	return `${fmtDate(start, today)} – ${fmtDate(end, today)}`;
}

/** 'Today', 'Tomorrow', 'In 5 days', 'On now', 'Ended' */
export function countdown(start, end, today) {
	const last = end || start;
	if (last < today) return 'Ended';
	if (start <= today) return start === last && start === today ? 'Today' : 'On now';
	const n = dayDiff(today, start);
	if (n === 1) return 'Tomorrow';
	if (n < 14) return `In ${n} days`;
	if (n < 60) return `In ${Math.round(n / 7)} weeks`;
	return `In ${Math.round(n / 30)} months`;
}

export function isRange(ev) {
	return !!ev.end_date && ev.end_date > ev.start_date;
}

/** Stable hue (0-359) from a string, used to colour event cards */
export function hue(str) {
	let h = 0;
	for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

export function namesLabel(names, max = 3) {
	if (!names.length) return 'Nobody yet';
	if (names.length <= max) return names.join(', ');
	return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

/** CSS background for an event banner: the picture under a dark wash so text stays readable (undefined = keep the colour gradient). */
export function bg(image) {
	return image ? `linear-gradient(rgb(0 0 0 / 0.12), rgb(0 0 0 / 0.58)), url(/img/${image})` : undefined;
}

const pounds = (pence) => '£' + (pence % 100 ? (pence / 100).toFixed(2) : String(pence / 100));
/** '£45', '£30–£60', '~£45' (estimate), 'Free' or null when no price is set. Prices are pence. */
export function priceLabel(ev) {
	if (ev.price_min == null) return null;
	if (ev.price_min === 0 && ev.price_max == null) return 'Free';
	const tilde = ev.price_estimate ? '~' : '';
	return ev.price_max != null ? `${tilde}${pounds(ev.price_min)}–${pounds(ev.price_max)}` : tilde + pounds(ev.price_min);
}

/** One price row for the event page: '£18', '~£12.99' or 'Free'. */
export function rowAmount(r) {
	return r.amount === 0 ? 'Free' : (r.estimate ? '~' : '') + pounds(r.amount);
}

/** Small status flags shown on cards and rows: decide-by date and ticket booking. */
export function flags(ev, today) {
	const out = [];
	if (ev.club_name) out.push({ text: ev.club_name, club: true });
	const price = priceLabel(ev);
	if (price) out.push({ text: price, price: true });
	if (ev.travel?.length) {
		out.push({ text: ev.travel.map((t) => `${t.kind === 'home' ? 'Home' : 'Work'} ${t.minutes} min`).join(' · '), travel: true });
	}
	if (ev.capacity != null) {
		const left = ev.capacity - (ev.going_count ?? 0);
		if (left > 0) out.push({ text: left === 1 ? '1 spot left' : `${left} spots left`, urgent: left === 1 });
		else out.push({ text: ev.waiting_count ? `Full · ${ev.waiting_count} waiting` : 'Full', urgent: true });
	}
	if (ev.decide_by && ev.decide_by >= today) {
		const n = dayDiff(today, ev.decide_by);
		out.push({
			text: n === 0 ? 'Decide today' : n === 1 ? 'Decide by tomorrow' : `Decide by ${fmtDate(ev.decide_by, today)}`,
			urgent: n <= 3
		});
	}
	if (ev.booking_status === 'booked') out.push({ text: 'Booked ✓', good: true });
	else if (ev.booking_status === 'booking' && ev.booker_name) out.push({ text: `${ev.booker_name} is booking` });
	return out;
}
