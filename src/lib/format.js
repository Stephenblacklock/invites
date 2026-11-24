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
