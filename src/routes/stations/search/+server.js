import { json } from '@sveltejs/kit';
import { searchStations, stationSearchAllowed } from '#lib/server/travel.js';

export async function GET({ url, locals }) {
	if (!stationSearchAllowed(locals.person.id)) return json({ error: 'Slow down a little.' }, { status: 429 });
	try {
		return json({ stations: await searchStations(url.searchParams.get('q')) });
	} catch {
		return json({ error: "Couldn't reach the station list right now." }, { status: 502 });
	}
}
