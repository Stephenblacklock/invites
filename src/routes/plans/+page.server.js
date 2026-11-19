import { eventsByDecision, todayISO } from '#lib/server/db.js';

export function load({ locals }) {
	const today = todayISO();
	const all = eventsByDecision(locals.person.id, 'interested');
	const upcoming = all.filter((e) => (e.end_date || e.start_date) >= today);
	const past = all
		.filter((e) => (e.end_date || e.start_date) < today)
		.reverse()
		.slice(0, 10);
	return { upcoming, past };
}
