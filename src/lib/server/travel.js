// Journey times from a person's home/work station to an event's venue.
// Venue → coordinates via OpenStreetMap Nominatim; journey via TfL's Journey Planner. Both are optional extras:
// any failure just means "no time shown". Nothing here is ever sent to the browser except minutes and line names.
import { dayDiff } from '../format.js';
import { getStations, getTravel, putTravel, setGeo, todayISO } from './db.js';
import { limiter } from './limit.js';

const TFL = () => (process.env.TFL_BASE || 'https://api.tfl.gov.uk').replace(/\/$/, '');
const GEO = () => (process.env.GEOCODE_BASE || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const UA = 'Invites/1.0 (+https://invites.blacklocks.uk)';
const TTL = 3 * 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
	const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
	if (!res.ok) throw new Error(`http ${res.status}`);
	return res.json();
}

function tflUrl(path, params = {}) {
	const u = new URL(TFL() + path);
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	if (process.env.TFL_APP_KEY) u.searchParams.set('app_key', process.env.TFL_APP_KEY);
	return u;
}

// ------------------------------------------------------------ station search (settings page autocomplete)
const searchCache = new Map();
export const stationSearchAllowed = limiter(40);

export async function searchStations(q) {
	const query = String(q ?? '').trim().slice(0, 40);
	if (query.length < 2) return [];
	const key = query.toLowerCase();
	if (searchCache.has(key)) return searchCache.get(key);
	const data = await getJson(
		tflUrl('/StopPoint/Search', { query, modes: 'tube,dlr,overground,elizabeth-line,national-rail', maxResults: '15', includeHubs: 'true' })
	);
	const byName = new Map();
	for (const m of data.matches ?? []) {
		if (!m?.id || !m?.name || !/^[A-Za-z0-9]{3,24}$/.test(m.id)) continue;
		const prev = byName.get(m.name);
		// an interchange "hub" id covers every line at the station, so prefer it
		if (!prev || (m.id.startsWith('HUB') && !prev.id.startsWith('HUB'))) byName.set(m.name, { id: m.id, name: String(m.name).slice(0, 60), modes: m.modes ?? [] });
	}
	const out = [...byName.values()].slice(0, 8);
	if (searchCache.size > 500) searchCache.clear();
	searchCache.set(key, out);
	return out;
}

// ------------------------------------------------------------ venue → coordinates (Nominatim allows 1 request/second)
let geoChain = Promise.resolve();
let lastGeo = 0;
function geocode(text) {
	const run = async () => {
		const wait = lastGeo + 1100 - Date.now();
		if (wait > 0) await sleep(wait);
		lastGeo = Date.now();
		const u = new URL(GEO() + '/search');
		u.searchParams.set('q', text);
		u.searchParams.set('format', 'jsonv2');
		u.searchParams.set('limit', '1');
		u.searchParams.set('countrycodes', 'gb');
		// Greater London only; a venue elsewhere simply gets no journey time
		u.searchParams.set('viewbox', '-0.51,51.70,0.33,51.28');
		u.searchParams.set('bounded', '1');
		const arr = await getJson(u);
		const r = Array.isArray(arr) ? arr[0] : null;
		const lat = Number(r?.lat);
		const lon = Number(r?.lon);
		return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
	};
	const p = geoChain.then(run, run);
	geoChain = p.catch(() => {});
	return p;
}

/** Journey times only make sense for London venues, so the location text has to say so (name or postcode). */
export function inLondon(text) {
	return /\blondon\b/i.test(text ?? '') || /\b(?:EC|WC|NW|SE|SW|[ENW])\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(text ?? '');
}

const inflight = new Map();
/** Coordinates for an event's location text (cached on the event). Returns null when unknown or outside London. */
async function ensureGeo(event) {
	const text = (event.location ?? '').trim();
	if (!text || !inLondon(text)) return null;
	if (event.geo_for === text) return event.geo_lat == null ? null : { lat: event.geo_lat, lon: event.geo_lon };
	const k = `${event.id}|${text}`;
	if (!inflight.has(k)) {
		inflight.set(
			k,
			geocode(text)
				.then((g) => {
					setGeo(event.id, text, g?.lat ?? null, g?.lon ?? null);
					return g;
				})
				.catch(() => null) // not stored, so it is tried again next time
				.finally(() => inflight.delete(k))
		);
	}
	return inflight.get(k);
}

// ------------------------------------------------------------ journey
function nextTuesday(today) {
	const d = new Date(today + 'T00:00:00Z');
	do d.setUTCDate(d.getUTCDate() + 1);
	while (d.getUTCDay() !== 2);
	return d.toISOString().slice(0, 10);
}

/** The day to plan for: the event day if it is soon, otherwise a typical weekday. */
export function travelDate(event, today) {
	const tomorrow = new Date(today + 'T00:00:00Z');
	tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
	const t = tomorrow.toISOString().slice(0, 10);
	const base = event.start_date > t ? event.start_date : t;
	return dayDiff(today, base) <= 30 ? base : nextTuesday(today);
}

async function journey(fromId, lat, lon, date) {
	const u = tflUrl(`/Journey/JourneyResults/${encodeURIComponent(fromId)}/to/${lat.toFixed(5)},${lon.toFixed(5)}`, {
		date: date.replaceAll('-', ''),
		time: '1830',
		timeIs: 'Departing',
		journeyPreference: 'LeastTime'
	});
	const data = await getJson(u);
	const all = (data.journeys ?? []).filter((j) => Number.isFinite(j?.duration));
	if (!all.length) return null;
	const best = all.reduce((a, b) => (b.duration < a.duration ? b : a));
	const names = [];
	for (const leg of best.legs ?? []) {
		if (leg.mode?.id === 'walking') continue;
		const n = String(leg.routeOptions?.[0]?.name || leg.mode?.name || '').trim();
		if (n && names[names.length - 1] !== n) names.push(n);
	}
	return { minutes: Math.round(best.duration), summary: names.slice(0, 4).join(' → ') || 'Walk' };
}

const keyFor = (stationId, g, date) => `${stationId}|${g.lat.toFixed(4)},${g.lon.toFixed(4)}|${date}`;
const picks = (personId) => {
	const st = getStations(personId);
	return [['home', st.home], ['work', st.work]].filter(([, s]) => s);
};

/** Journey times from this person's stations. [] when they have no stations, the venue is unknown, or TfL is unreachable. */
export async function travelFor(personId, event) {
	const mine = picks(personId);
	if (!mine.length) return [];
	const g = await ensureGeo(event);
	if (!g) return [];
	const date = travelDate(event, todayISO());
	const rows = await Promise.all(
		mine.map(async ([kind, s]) => {
			const key = keyFor(s.id, g, date);
			let t = getTravel(key, TTL);
			if (!t) {
				try {
					t = await journey(s.id, g.lat, g.lon, date);
					if (t) putTravel(key, t.minutes, t.summary);
				} catch {
					t = null;
				}
			}
			return t ? { kind, station: s.name, minutes: t.minutes, summary: t.summary } : null;
		})
	);
	return rows.filter(Boolean);
}

/** Add already-known journey times to events (no network). Used by the swipe deck and Plans. */
export function withTravel(personId, events) {
	const mine = picks(personId);
	if (!mine.length) return events;
	const today = todayISO();
	return events.map((e) => {
		if (!e.location || !inLondon(e.location) || e.geo_for !== e.location.trim() || e.geo_lat == null) return e;
		const g = { lat: e.geo_lat, lon: e.geo_lon };
		const date = travelDate(e, today);
		const travel = mine
			.map(([kind, s]) => {
				const t = getTravel(keyFor(s.id, g, date), TTL);
				return t ? { kind, station: s.name, minutes: t.minutes } : null;
			})
			.filter(Boolean);
		return travel.length ? { ...e, travel } : e;
	});
}

/** Quietly work out journey times for the next few events so they are ready when the person swipes. */
export function warm(personId, events, max = 4) {
	if (!picks(personId).length) return;
	let n = 0;
	for (const e of events) {
		if (n >= max) break;
		if (!e.location || !inLondon(e.location) || e.travel) continue;
		n++;
		travelFor(personId, e).catch(() => {});
	}
}
