import { eventsByDecision, getCalToken, resetCalToken, todayISO } from '#lib/server/db.js';

export function load({ locals, url }) {
	const today = todayISO();
	const all = eventsByDecision(locals.person.id, 'interested');
	const upcoming = all.filter((e) => (e.end_date || e.start_date) >= today);
	const past = all
		.filter((e) => (e.end_date || e.start_date) < today)
		.reverse()
		.slice(0, 10);
	const feed = `${url.origin}/calendar/${getCalToken(locals.person.id)}.ics`;
	return { upcoming, past, feed };
}

export const actions = {
	resetCalendar: ({ locals }) => {
		resetCalToken(locals.person.id);
	}
};
