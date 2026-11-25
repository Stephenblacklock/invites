import { getCalToken, getInviteToken, getStations, resetCalToken } from '#lib/server/db.js';

export function load({ locals, url }) {
	const stations = getStations(locals.person.id);
	return {
		joinLink: locals.person.id ? `${url.origin}/join/${getInviteToken(locals.person.id)}` : null,
		feed: `${url.origin}/calendar/${getCalToken(locals.person.id)}.ics`,
		stations: { home: stations.home?.name ?? null, work: stations.work?.name ?? null }
	};
}

export const actions = {
	resetCalendar: ({ locals }) => {
		resetCalToken(locals.person.id);
	}
};
