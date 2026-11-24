// Minimal RFC 5545 writer: all-day events only, which is all Invites has.

const esc = (s) =>
	String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold long lines at 75 octets, never splitting a character. */
function fold(line) {
	const out = [];
	let cur = '';
	let bytes = 0;
	for (const ch of line) {
		const b = Buffer.byteLength(ch);
		if (bytes + b > 74) {
			out.push(cur);
			cur = ' ' + ch;
			bytes = 1 + b;
		} else {
			cur += ch;
			bytes += b;
		}
	}
	out.push(cur);
	return out.join('\r\n');
}

const ymd = (d) => d.replace(/-/g, '');
function nextDay(d) {
	const t = new Date(d + 'T00:00:00Z');
	t.setUTCDate(t.getUTCDate() + 1);
	return t.toISOString().slice(0, 10);
}

/** The date the group picked, if any: the most-voted poll date (ties go to the earlier date). */
export function chosenDate(options) {
	let best = null;
	for (const o of options ?? []) {
		if (o.voters.length && (!best || o.voters.length > best.voters.length)) best = o;
	}
	return best?.date ?? null;
}

function vevent(ev, { origin, host, stamp, chosen }) {
	const start = chosen ?? ev.start_date;
	const end = chosen ?? ev.end_date ?? ev.start_date;
	const link = `${origin}/events/${ev.id}`;
	const names = ev.interested?.map((p) => p.name) ?? [];
	const desc = [ev.description, names.length ? `Keen: ${names.join(', ')}` : '', ev.chat_link ? `Chat: ${ev.chat_link}` : '', link]
		.filter(Boolean)
		.join('\n\n');
	const lines = [
		'BEGIN:VEVENT',
		`UID:invites-${ev.id}@${host}`,
		`DTSTAMP:${stamp}`,
		`DTSTART;VALUE=DATE:${ymd(start)}`,
		`DTEND;VALUE=DATE:${ymd(nextDay(end))}`,
		`SUMMARY:${esc(ev.title)}`
	];
	if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
	lines.push(`DESCRIPTION:${esc(desc)}`, `URL:${link}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
	return lines.map(fold).join('\r\n');
}

/**
 * @param {Array<{event:object, chosen?:string|null}>} items
 * @param {{origin:string, name?:string}} o
 */
export function buildCalendar(items, { origin, name = 'Invites' }) {
	const host = new URL(origin).hostname;
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	const head = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Invites//Events//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${esc(name)}`,
		'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
		'X-PUBLISHED-TTL:PT6H'
	].map(fold);
	const body = items.map(({ event, chosen }) => vevent(event, { origin, host, stamp, chosen }));
	return [...head, ...body, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
