// End-to-end smoke test against a running server.
//   INVITES_PASSWORD=... ORIGIN=http://localhost:3100 PORT=3100 node build &
//   BASE=http://localhost:3100 INVITES_PASSWORD=... node scripts/smoke.mjs
// Travel-time checks use a fake TfL/geocoder on :3199. Start the server with
//   TFL_BASE=http://127.0.0.1:3199 GEOCODE_BASE=http://127.0.0.1:3199
// and run this script with TRAVEL_TESTS=1 (without it those checks are skipped).
const BASE = process.env.BASE ?? 'http://localhost:3100';
const PASSWORD = process.env.INVITES_PASSWORD ?? 'test-password-123';

let failed = 0;
const ok = (cond, msg) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
	if (!cond) failed++;
};

class Client {
	jar = new Map();
	constructor(ip) {
		this.ip = ip;
	}
	async req(path, { method = 'GET', form, json, multipart, headers = {} } = {}) {
		const h = { origin: BASE, accept: 'text/html', 'cf-connecting-ip': this.ip, ...headers };
		if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
		let body;
		if (form) {
			body = new URLSearchParams(form);
			h['content-type'] = 'application/x-www-form-urlencoded';
		} else if (multipart) {
			body = multipart;
		} else if (json) {
			body = JSON.stringify(json);
			h['content-type'] = 'application/json';
		}
		const res = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
		for (const c of res.headers.getSetCookie()) {
			const [kv] = c.split(';');
			const i = kv.indexOf('=');
			const k = kv.slice(0, i);
			const v = kv.slice(i + 1);
			if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || v === '') this.jar.delete(k);
			else this.jar.set(k, v);
		}
		return res;
	}
	// SvelteKit form actions answer plain form posts with 303 (redirect) or a 200/4xx page
	post(path, form) {
		return this.req(path, { method: 'POST', form });
	}
}

const loc = (r) => r.headers.get('location');
const addDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------ health & gate
{
	const c = new Client('10.0.0.1');
	ok((await c.req('/healthz')).status === 200, 'healthz is public');
	const r = await c.req('/');
	ok(r.status === 303 && loc(r) === '/login', 'unauthenticated / redirects to /login');
	const api = await c.req('/api/swipe', { method: 'POST', json: { eventId: 1, decision: 'interested' } });
	ok(api.status === 401, 'unauthenticated API call is 401');
	const m = await c.req('/manifest.webmanifest');
	ok(m.status === 200, 'manifest is public');
	const login = await c.req('/login');
	ok(login.status === 200, 'login page renders');
	ok((login.headers.get('x-robots-tag') ?? '').includes('noindex'), 'noindex header set');
}

// ------------------------------------------------------------ password + rate limit
{
	const c = new Client('10.0.0.2');
	for (let i = 0; i < 5; i++) {
		const r = await c.post('/login', { password: 'wrong-' + i });
		ok(r.status === 401, `wrong password #${i + 1} rejected (401)`);
	}
	const blocked = await c.post('/login', { password: PASSWORD });
	ok(blocked.status === 429, 'even the right password is blocked after 5 failures from one IP');

	// a different IP is unaffected, and success clears its counter
	const d = new Client('10.0.0.3');
	await d.post('/login', { password: 'nope' });
	const good = await d.post('/login', { password: PASSWORD });
	ok(good.status === 303 && loc(good) === '/who', 'correct password -> /who');
}

// ------------------------------------------------------------ two friends
const alice = new Client('10.0.1.1');
const bob = new Client('10.0.1.2');
for (const [c, name] of [
	[alice, 'Alice'],
	[bob, 'Bob']
]) {
	await c.post('/login', { password: PASSWORD });
	const w = await c.req('/');
	ok(loc(w) === '/who', `${name}: no name yet -> /who`);
	const made = await c.post('/who?/create', { name });
	ok(made.status === 303 && loc(made) === '/', `${name}: name created`);
}
{
	const dup = await new Client('10.0.1.3');
	await dup.post('/login', { password: PASSWORD });
	const r = await dup.post('/who?/create', { name: 'alice' });
	ok(r.status === 400, 'duplicate name (case-insensitive) rejected');
}

// ------------------------------------------------------------ events
const bad = await alice.post('/events/new', { title: '', start_date: 'nope' });
ok(bad.status === 400, 'invalid event rejected');
const badLink = await alice.post('/events/new', { title: 'X', start_date: addDays(3), chat_link: 'javascript:alert(1)' });
ok(badLink.status === 400, 'javascript: chat link rejected');
const past = await alice.post('/events/new', { title: 'Old', start_date: '2020-01-01' });
ok(past.status === 400, 'finished event rejected');

const created = await alice.post('/events/new', {
	title: 'Winter Wonderland',
	description: 'Rides and mulled wine',
	location: 'Hyde Park',
	start_date: addDays(5),
	end_date: addDays(12),
	tags: 'Festive, outdoors, festive'
});
ok(created.status === 303 && /^\/events\/\d+$/.test(loc(created) ?? ''), 'event created');
const evPath = loc(created);
const evId = Number(evPath.split('/').pop());

const single = await alice.post('/events/new', { title: 'Panto', start_date: addDays(2), tags: 'theatre' });
const singleId = Number(loc(single).split('/').pop());

// Bob's deck has both; Alice's deck has neither (she is auto-interested in her own)
const deckHtml = async (c) => (await (await c.req('/')).text());
const bobDeck = await deckHtml(bob);
ok(bobDeck.includes('Winter Wonderland') && bobDeck.includes('Panto'), "Bob's deck shows both events");
ok(!(await deckHtml(alice)).includes('Winter Wonderland'), "Alice's deck excludes her own event");

// Swipes
ok((await bob.req('/api/swipe', { method: 'POST', json: { eventId: evId, decision: 'interested' } })).status === 200, 'Bob swipes interested');
ok((await bob.req('/api/swipe', { method: 'POST', json: { eventId: singleId, decision: 'not_interested' } })).status === 200, 'Bob passes on Panto');
ok(!(await deckHtml(bob)).includes('Winter Wonderland'), 'swiped events leave the deck');
ok((await bob.req('/api/swipe', { method: 'POST', json: { eventId: singleId, decision: 'undo' } })).status === 200, 'Bob undoes the pass');
ok((await deckHtml(bob)).includes('Panto'), 'undo puts it back in the deck');
ok((await bob.req('/api/swipe', { method: 'POST', json: { eventId: 99999, decision: 'interested' } })).status === 404, 'swiping on a missing event is 404');
ok((await bob.req('/api/swipe', { method: 'POST', json: { eventId: evId, decision: 'maybe' } })).status === 400, 'bad decision is 400');

// Event page shows both members
const page = await (await bob.req(evPath)).text();
ok(page.includes('Alice') && page.includes('Bob'), 'event page lists both interested people');

// Date poll
const opt = addDays(8);
const added = await bob.post(evPath + '?/addOption', { date: opt });
ok(added.status === 200, 'Bob adds a date option');
let pageAfter = await (await bob.req(evPath)).text();
ok(pageAfter.includes('Pick a day'), 'range events show the poll');
ok(new RegExp(new Date(opt + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })).test(pageAfter), 'the new date option is listed');
const optId = Number(pageAfter.match(/name="option" value="(\d+)"/)?.[1]);
ok(Number.isInteger(optId), 'poll option has an id');
ok((await bob.post(evPath + '?/vote', { option: optId })).status === 200, 'Bob votes for it');
ok(/class="vote-count">1</.test(await (await alice.req(evPath)).text()), 'Alice sees 1 vote');
ok((await bob.post(evPath + '?/vote', { option: optId })).status === 200, 'Bob toggles his vote off');
ok(/class="vote-count">0</.test(await (await alice.req(evPath)).text()), 'vote count back to 0');
const outside = await bob.post(evPath + '?/addOption', { date: addDays(30) });
ok(outside.status === 400, 'date outside the event range rejected');
const nonMember = new Client('10.0.1.9');
await nonMember.post('/login', { password: PASSWORD });
await nonMember.post('/who?/create', { name: 'Carol' });
const sneaky = await nonMember.post(evPath + '?/comment', { body: 'hi' });
ok(sneaky.status === 403, 'non-members cannot comment');
const c1 = await bob.post(evPath + '?/comment', { body: 'Meet at 6 by the entrance?' });
ok(c1.status === 200 || c1.status === 303, 'member comment accepted');
ok((await (await alice.req(evPath)).text()).includes('Meet at 6'), 'Alice sees Bob\'s comment');

// Only creator can edit/delete
const bobEdit = await bob.req(evPath + '/edit');
ok(bobEdit.status === 403, 'non-creator cannot open edit page');
const bobDelete = await bob.post(evPath + '?/delete', {});
ok(bobDelete.status === 403, 'non-creator cannot delete');
const aliceEdit = await alice.req(evPath + '/edit');
ok(aliceEdit.status === 200, 'creator can open edit page');

// Plans
const plans = await (await bob.req('/plans')).text();
ok(plans.includes('Winter Wonderland'), 'Bob sees it in his plans');

// CSRF: cross-origin form post is rejected
const csrf = await bob.req(evPath + '?/leave', { method: 'POST', form: {}, headers: { origin: 'https://evil.example' } });
ok(csrf.status === 403, 'cross-origin form POST is rejected (CSRF)');

// Logout
await bob.post('/logout', {});
const after = await bob.req('/');
ok(after.status === 303 && loc(after) === '/login', 'logout clears the session');

// ------------------------------------------------------------ token API
{
	const API_TOKEN = 'api-token-for-smoke-tests-0123456789';
	const call = (path, { method = 'GET', body, token = API_TOKEN } = {}) =>
		fetch(BASE + path, {
			method,
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '10.0.9.9',
				...(token ? { authorization: `Bearer ${token}` } : {})
			},
			body: body ? JSON.stringify(body) : undefined
		});
	const spec = await fetch(BASE + '/api/v1/openapi.json');
	ok(spec.status === 200 && (await spec.json()).openapi === '3.0.3', 'OpenAPI spec is public');
	ok((await call('/api/v1/events', { token: null })).status === 401, 'API without a token is 401');
	ok((await call('/api/v1/events', { token: 'wrong' })).status === 401, 'API with a wrong token is 401');
	const cookieOnly = await alice.req('/api/v1/events', { headers: { accept: 'application/json' } });
	ok(cookieOnly.status === 401, 'a friend session cookie does not open the API');

	const noFields = await call('/api/v1/events', { method: 'POST', body: { title: 'X' } });
	ok(noFields.status === 400, 'API create without a start date is 400');
	const unknown = await call('/api/v1/events', { method: 'POST', body: { title: 'X', start_date: addDays(4), colour: 'red' } });
	ok(unknown.status === 400, 'API create with an unknown field is 400');
	const pastApi = await call('/api/v1/events', { method: 'POST', body: { title: 'Old', start_date: '2020-01-01' } });
	ok(pastApi.status === 400, 'API create of a finished event is 400');

	const mk = await call('/api/v1/events', {
		method: 'POST',
		body: { title: 'Ice Bar', description: 'Cold drinks', location: 'Shoreditch', tags: ['Drinks', 'winter'], start_date: addDays(9) }
	});
	const made = await mk.json();
	ok(mk.status === 201 && made.event.created_by === 'Stephen' && made.event.interested.includes('Stephen'), 'API creates an event as Stephen');
	const dupe = await call('/api/v1/events', { method: 'POST', body: { title: 'ice bar', start_date: addDays(9) } });
	ok(dupe.status === 409, 'API refuses a duplicate title + start date');

	const list = await (await call('/api/v1/events?q=ice')).json();
	ok(list.events.some((e) => e.id === made.event.id), 'API list finds the event by text');
	const detail = await (await call(`/api/v1/events/${made.event.id}`)).json();
	ok(Array.isArray(detail.event.comments) && Array.isArray(detail.event.date_options), 'API get returns poll and comments');
	ok((await call('/api/v1/events/999999')).status === 404, 'API get of a missing event is 404');

	const patch = await call(`/api/v1/events/${made.event.id}`, { method: 'PATCH', body: { location: 'Bow' } });
	const patched = await patch.json();
	ok(patch.status === 200 && patched.event.location === 'Bow' && patched.event.title === 'Ice Bar', 'API patch changes only the given field');
	const aliceEvent = await call(`/api/v1/events/${evId}`, { method: 'PATCH', body: { location: 'Nope' } });
	ok(aliceEvent.status === 403, "API cannot edit someone else's event");

	const plansApi = await (await call('/api/v1/plans')).json();
	ok(plansApi.events.some((e) => e.id === made.event.id), 'API plans lists the event');
	ok((await call(`/api/v1/events/${made.event.id}`, { method: 'DELETE' })).status === 405, 'API has no delete');
}

const API_TOKEN_SHARED = 'api-token-for-smoke-tests-0123456789';
const call = (path, { method = 'GET', body, token = API_TOKEN_SHARED } = {}) =>
	fetch(BASE + path, {
		method,
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.9.8', ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: body ? JSON.stringify(body) : undefined
	});

// ------------------------------------------------------------ banner images
{
	// 1x1 PNG
	const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
	const form = (extra = {}, file) => {
		const fd = new FormData();
		const base = { title: 'Pictured', start_date: addDays(6), ...extra };
		for (const [k, v] of Object.entries(base)) fd.set(k, v);
		if (file) fd.set('image', file, file.name);
		return fd;
	};
	const imgRe = /\/img\/([a-f0-9]{32}\.(?:png|jpg|gif|webp))/;

	const withPic = await alice.req('/events/new', { method: 'POST', multipart: form({}, new File([PNG], 'banner.png', { type: 'image/png' })) });
	ok(withPic.status === 303, 'event with an uploaded banner is created');
	const picPath = loc(withPic);
	const picHtml = await (await alice.req(picPath)).text();
	const picName = imgRe.exec(picHtml)?.[1];
	ok(!!picName, 'event page references the banner image');
	const served = await alice.req(`/img/${picName}`);
	ok(served.status === 200 && served.headers.get('content-type') === 'image/png', 'banner is served as image/png');
	ok((served.headers.get('content-security-policy') ?? '').includes('sandbox'), 'banner response carries a sandbox CSP');
	const anon = await new Client('10.0.2.2').req(`/img/${picName}`);
	ok(anon.status === 303 && loc(anon) === '/login', 'banner is not served without a session');
	ok((await alice.req('/img/../../etc/passwd')).status !== 200, 'path traversal in /img is refused');
	ok((await alice.req('/img/not-a-valid-name.png')).status === 404, 'invalid image name is 404');

	const fake = await alice.req('/events/new', { method: 'POST', multipart: form({ title: 'Fake' }, new File([Buffer.from('<script>alert(1)</script> this is not an image')], 'x.png', { type: 'image/png' })) });
	ok(fake.status === 400, 'a non-image file named .png is rejected');
	const svg = await alice.req('/events/new', { method: 'POST', multipart: form({ title: 'Svg' }, new File([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')], 'x.svg', { type: 'image/svg+xml' })) });
	ok(svg.status === 400, 'SVG upload is rejected');
	const big = await alice.req('/events/new', { method: 'POST', multipart: form({ title: 'Big' }, new File([Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)])], 'big.png', { type: 'image/png' })) });
	ok(big.status === 400 || big.status === 413, 'an oversize image is rejected');

	for (const [label, url] of [
		['plain http link', 'http://example.com/a.png'],
		['loopback address', 'https://127.0.0.1/a.png'],
		['private LAN address', 'https://192.168.1.1/a.png'],
		['cloud metadata address', 'https://169.254.169.254/latest/meta-data/'],
		['IPv6 loopback', 'https://[::1]/a.png'],
		['link with credentials', 'https://user:pw@example.com/a.png'],
		['non-standard port', 'https://example.com:8443/a.png']
	]) {
		const r = await alice.req('/events/new', { method: 'POST', multipart: form({ title: 'Link ' + label, image_url: url }) });
		ok(r.status === 400, `image link refused: ${label}`);
	}

	// edit: remove the banner, file goes away
	const rm = await alice.req(picPath + '/edit', { method: 'POST', multipart: form({ remove_image: 'on' }) });
	ok(rm.status === 303, 'edit with "remove banner" saves');
	ok(!imgRe.test(await (await alice.req(picPath)).text()), 'event page no longer shows a banner');
	ok((await alice.req(`/img/${picName}`)).status === 404, 'removed banner file is gone');

	// API image_url guards
	const apiBlocked = await call('/api/v1/events', { method: 'POST', body: { title: 'Api pic', start_date: addDays(8), image_url: 'https://10.0.0.5/a.png' } });
	ok(apiBlocked.status === 400, 'API refuses an image_url pointing at a private address');
	const apiBadType = await call('/api/v1/events', { method: 'POST', body: { title: 'Api pic2', start_date: addDays(8), image_url: 5 } });
	ok(apiBadType.status === 400, 'API refuses a non-string image_url');
	const apiOk = await call('/api/v1/events', { method: 'POST', body: { title: 'Api no pic', start_date: addDays(8) } });
	ok(apiOk.status === 201 && (await apiOk.json()).event.image === null, 'API events report image: null when there is no banner');

	// deleting an event deletes its banner
	const delPic = await alice.req('/events/new', { method: 'POST', multipart: form({ title: 'To delete' }, new File([PNG], 'b.png', { type: 'image/png' })) });
	const delPath = loc(delPic);
	const delName = imgRe.exec(await (await alice.req(delPath)).text())?.[1];
	await alice.post(delPath + '?/delete', {});
	ok(!!delName && (await alice.req(`/img/${delName}`)).status === 404, 'deleting an event removes its banner file');
}

// ------------------------------------------------------------ link prefill
{
	const { extractInfo } = await import('../src/lib/server/linkinfo.js');
	const ld = extractInfo(
		`<html><head><title>Bleachers Tickets | Eventim Apollo</title>
		<meta property="og:title" content="Bleachers Tickets | Eventim Apollo">
		<meta property="og:image" content="/img/hero.jpg">
		<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","name":"Bleachers &amp; Friends","description":"<p>Big night, loud.</p>","startDate":"2026-12-03T19:30:00","endDate":"2026-12-03","location":{"@type":"Place","name":"Eventim Apollo","address":{"addressLocality":"London"}},"image":["https://cdn.example.com/b.jpg"]}</script></head></html>`,
		'https://tickets.example.com/e/1'
	);
	ok(ld.title === 'Bleachers & Friends', 'prefill: title comes from the Event JSON-LD and entities are decoded');
	ok(ld.description === 'Big night, loud.', 'prefill: description has tags stripped');
	ok(ld.location === 'Eventim Apollo, London', 'prefill: venue and town combined');
	ok(ld.start_date === '2026-12-03' && ld.end_date === undefined, 'prefill: start date read, same-day end date dropped');
	ok(ld.image_url === 'https://cdn.example.com/b.jpg', 'prefill: JSON-LD image used');

	const og = extractInfo(
		`<title>x</title><meta property="og:title" content="Winter Wonderland | Hyde Park"><meta name="description" content="Rides &amp; mulled wine"><meta property="og:image" content="http://example.com/x.png">`,
		'https://example.com/a'
	);
	ok(og.title === 'Winter Wonderland' && og.description === 'Rides & mulled wine', 'prefill: falls back to Open Graph tags');
	ok(og.image_url === 'https://example.com/x.png' && og.start_date === undefined, 'prefill: http image upgraded to https, no invented date');

	const list = extractInfo(
		`<title>Upcoming shows</title><script type="application/ld+json">[{"@type":"Event","name":"Alpha show","startDate":"2026-01-01"},{"@type":"Event","name":"Beta show","startDate":"2026-02-02"}]</script>`,
		'https://example.com/'
	);
	ok(list.title === 'Upcoming shows' && list.start_date === undefined, 'prefill: a listing page with several events does not guess one');

	const graph = extractInfo(
		`<title>Hamilton</title><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Event","TheaterEvent"],"name":"Hamilton","startDate":"2026-12-10","endDate":"2026-12-20"}]}</script>`,
		'https://example.com/'
	);
	ok(graph.start_date === '2026-12-10' && graph.end_date === '2026-12-20', 'prefill: finds events inside @graph and keeps multi-day ranges');

	const anon = new Client('10.0.2.1');
	const anonRes = await anon.req('/events/prefill', { method: 'POST', json: { url: 'https://example.com' } });
	ok(anonRes.status === 303 && loc(anonRes) === '/login', 'prefill needs a login');
	const post = (url) => alice.req('/events/prefill', { method: 'POST', json: url === undefined ? {} : { url } });
	ok((await post('http://example.com')).status === 422, 'prefill refuses http links');
	ok((await post('https://127.0.0.1/')).status === 422, 'prefill refuses loopback addresses');
	ok((await post('https://169.254.169.254/latest/meta-data')).status === 422, 'prefill refuses the cloud metadata address');
	ok((await post('https://192.168.1.1/')).status === 422, 'prefill refuses LAN addresses');
	ok((await post()).status === 400, 'prefill needs a link');
	let limited = false;
	for (let i = 0; i < 15 && !limited; i++) limited = (await post('http://example.com')).status === 429;
	ok(limited, 'prefill is rate limited per person');
}

// API link preview
{
	const noAuth = await fetch(BASE + '/api/v1/link-preview?url=https://example.com');
	ok(noAuth.status === 401, 'API link-preview needs the token');
	const r1 = await call('/api/v1/link-preview?url=' + encodeURIComponent('https://10.0.0.5/x'));
	ok(r1.status === 422, 'API link-preview refuses private addresses');
	const r2 = await call('/api/v1/link-preview');
	ok(r2.status === 400, 'API link-preview needs a url');
	const spec = await (await fetch(BASE + '/api/v1/openapi.json')).json();
	ok(!!spec.paths['/api/v1/link-preview']?.get?.operationId, 'OpenAPI lists preview_link');
}

// ------------------------------------------------------------ calendar export
{
	const { chosenDate, buildCalendar } = await import('../src/lib/server/ics.js');
	ok(chosenDate([{ date: '2026-12-01', voters: ['a'] }, { date: '2026-12-02', voters: ['a', 'b'] }]) === '2026-12-02', 'ics: most-voted date wins');
	ok(chosenDate([{ date: '2026-12-01', voters: [] }]) === null, 'ics: no votes means no chosen date');
	const long = buildCalendar(
		[{ event: { id: 1, title: 'Ünïcode ' + 'x'.repeat(200), description: 'y'.repeat(300), start_date: '2026-12-01', end_date: null, location: null, interested: [] }, chosen: null }],
		{ origin: 'https://invites.example.com' }
	);
	ok(long.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'ics: long lines are folded to 75 bytes');

	const start = addDays(9);
	const created = await alice.post('/events/new', { title: 'Fish, chips; & more', description: 'line one\nline two', start_date: start });
	const evPath2 = loc(created);
	ok(created.status === 303 && !!evPath2, 'calendar: created a test event');
	const ics = await alice.req(evPath2 + '/calendar.ics');
	const body = await ics.text();
	ok(ics.status === 200 && (ics.headers.get('content-type') ?? '').startsWith('text/calendar'), 'event .ics is served as text/calendar');
	ok(body.includes('BEGIN:VEVENT') && body.includes('SUMMARY:Fish\\, chips\; & more'), 'ics: commas and semicolons are escaped');
	ok(body.includes('line one\\nline two'), 'ics: newlines are escaped');
	ok(body.includes(`DTSTART;VALUE=DATE:${start.replaceAll('-', '')}`) && body.includes(`DTEND;VALUE=DATE:${addDays(10).replaceAll('-', '')}`), 'ics: all-day event ends the day after (exclusive end)');
	ok((await new Client('10.0.2.2').req(evPath2 + '/calendar.ics')).status === 303, 'event .ics needs a login');
	ok((await alice.req('/events/999999/calendar.ics')).status === 404, 'event .ics for a missing event is 404');

	// subscription feed
	const plans = await (await alice.req('/settings')).text();
	const token = /\/calendar\/([A-Za-z0-9_-]{32})\.ics/.exec(plans)?.[1];
	ok(!!token, 'settings page shows the personal feed link');
	const anon = new Client('10.0.2.3');
	const feed = await anon.req(`/calendar/${token}.ics`);
	const feedBody = await feed.text();
	ok(feed.status === 200 && (feed.headers.get('content-type') ?? '').startsWith('text/calendar'), 'feed works without a cookie');
	ok(feedBody.includes('BEGIN:VCALENDAR') && feedBody.includes('SUMMARY:Fish\\, chips\; & more'), 'feed lists events the person is interested in');
	ok((await anon.req('/calendar/' + 'a'.repeat(32) + '.ics')).status === 404, 'feed with a wrong token is 404');
	ok((await anon.req('/calendar/short.ics')).status === 404, 'feed with a malformed token is 404');
	const other = new Client('10.0.2.4');
	await other.post('/login', { password: PASSWORD });
	await other.post('/who?/create', { name: 'Calendar Bob' });
	const otherPlans = await (await other.req('/settings')).text();
	const otherToken = /\/calendar\/([A-Za-z0-9_-]{32})\.ics/.exec(otherPlans)?.[1];
	const otherFeed = await (await anon.req(`/calendar/${otherToken}.ics`)).text();
	ok(!!otherToken && otherToken !== token && !otherFeed.includes('Fish\\, chips'), "someone else's feed doesn't include events they haven't joined");
	await alice.post('/settings?/resetCalendar', {});
	const newToken = /\/calendar\/([A-Za-z0-9_-]{32})\.ics/.exec(await (await alice.req('/settings')).text())?.[1];
	ok(!!newToken && newToken !== token, 'resetting makes a new feed link');
	ok((await anon.req(`/calendar/${token}.ics`)).status === 404 && (await anon.req(`/calendar/${newToken}.ics`)).status === 200, 'old feed link stops working, new one works');
	await alice.post(evPath2 + '?/delete', {});
}

// ------------------------------------------------------------ media link, decide-by, ticket booking, share target
{
	const { parseMedia } = await import('../src/lib/media.js');
	ok(parseMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s')?.embed === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'media: youtube watch link becomes a no-cookie embed');
	ok(parseMedia('https://youtu.be/dQw4w9WgXcQ?si=abc')?.link === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'media: youtu.be short link recognised');
	ok(parseMedia('https://www.youtube.com/playlist?list=PLabcdefghij1234')?.embed.includes('videoseries?list='), 'media: youtube playlist recognised');
	ok(parseMedia('https://open.spotify.com/intl-gb/track/4uLU6hMCjMI75M1A2tKUQC?si=x')?.embed === 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', 'media: spotify track link recognised');
	ok(parseMedia('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.height === 352, 'media: spotify playlist gets the tall player');
	ok(parseMedia('https://evil.example.com/watch?v=dQw4w9WgXcQ') === null && parseMedia('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ') === null, 'media: look-alike hosts are refused');
	ok(parseMedia('https://www.youtube.com/watch?v="><script>') === null && parseMedia('javascript:alert(1)') === null, 'media: junk and script links are refused');

	const mk = async (name) => {
		const c = new Client('10.0.3.' + (10 + Math.floor(Math.random() * 200)));
		await c.post('/login', { password: PASSWORD });
		await c.post('/who?/create', { name });
		return c;
	};
	const bob = await mk('Booker Bob');

	const bad = await alice.post('/events/new', { title: 'Bad media', start_date: addDays(20), media_link: 'https://example.com/video' });
	ok(bad.status === 400, 'form refuses a non-YouTube/Spotify media link');
	const late = await alice.post('/events/new', { title: 'Bad decide', start_date: addDays(20), decide_by: addDays(25) });
	ok(late.status === 400, 'form refuses a decide-by date after the event');

	const made = await alice.post('/events/new', { title: 'Film night', start_date: addDays(40), decide_by: addDays(1), media_link: 'https://youtu.be/dQw4w9WgXcQ' });
	const filmPath = loc(made);
	ok(made.status === 303 && !!filmPath, 'event with decide-by and trailer is created');
	let page = await (await alice.req(filmPath)).text();
	ok(page.includes('Watch') && page.includes('Decide by'), 'event page shows the trailer section and decide-by date');
	ok(page.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'the YouTube player is embedded on the page');

	// the urgent decide-by event jumps the swipe deck
	const fresh = await mk('Deck Dana');
	const home = await (await fresh.req('/')).text();
	ok(/class="card top[^"]*"[\s\S]*?<h2>Film night<\/h2>/.test(home), 'an event with a near decide-by date is first in the deck');
	ok(home.includes('Decide by tomorrow'), 'deck card shows the decide-by flag');

	// ticket booking
	await bob.post(filmPath + '?/join', {});
	ok((await bob.post(filmPath + '?/claimBooking', {})).status < 400, 'a member can take on booking');
	page = await (await alice.req(filmPath)).text();
	ok(page.includes('Booker Bob') && page.includes('sorting the tickets'), "others see who is booking");
	const dup = await alice.post(filmPath + '?/claimBooking', {});
	ok(dup.status === 409, 'a second person cannot take the booking');
	const carol = await mk('Booker Carol');
	ok((await carol.post(filmPath + '?/claimBooking', {})).status === 403, 'a non-member cannot take the booking');
	ok((await alice.post(filmPath + '?/markBooked', { note: 'nope' })).status === 403, "someone else can't mark it booked");
	await bob.post(filmPath + '?/markBooked', { note: '4 tickets, £48 each' });
	page = await (await alice.req(filmPath)).text();
	ok(page.includes('has booked') && page.includes('4 tickets'), 'booked status and note are shown');
	ok((await (await alice.req('/plans')).text()).includes('Booked ✓'), 'plans list shows the booked flag');
	ok((await carol.post(filmPath + '?/releaseBooking', {})).status === 403, 'only the booker or creator can clear a booking');
	await alice.post(filmPath + '?/releaseBooking', {});
	ok((await (await alice.req(filmPath)).text()).includes('Nobody&#39;s sorting tickets yet') || (await (await alice.req(filmPath)).text()).includes("Nobody's sorting tickets yet"), 'creator can clear a booking');
	await bob.post(filmPath + '?/claimBooking', {});
	await bob.post(filmPath + '?/leave', {});
	ok(!(await (await alice.req(filmPath)).text()).includes('Booker Bob is sorting'), 'leaving the event hands back their booking');

	// API
	const apiMake = await call('/api/v1/events', { method: 'POST', body: { title: 'Api trailer', start_date: addDays(30), decide_by: addDays(10), media_link: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy' } });
	const apiEv = (await apiMake.json()).event;
	ok(apiMake.status === 201 && apiEv.decide_by === addDays(10) && apiEv.media_link?.includes('open.spotify.com/album/') && apiEv.booking === null, 'API creates events with decide_by and media_link');
	const apiBad = await call('/api/v1/events', { method: 'POST', body: { title: 'Api bad media', start_date: addDays(30), media_link: 'https://example.com/x' } });
	ok(apiBad.status === 400, 'API refuses an unsupported media_link');
	const apiClear = await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { media_link: null, decide_by: null } });
	const cleared = (await apiClear.json()).event;
	ok(apiClear.status === 200 && cleared.media_link === null && cleared.decide_by === null, 'API can clear media_link and decide_by with null');

	// share target + service worker
	const manifest = await (await fetch(BASE + '/manifest.webmanifest')).json();
	ok(manifest.share_target?.action === '/events/new' && manifest.share_target.params.text === 'text', 'manifest declares a share target');
	const sw = await fetch(BASE + '/service-worker.js', { redirect: 'manual' });
	ok(sw.status === 200 && /javascript/.test(sw.headers.get('content-type') ?? ''), 'service worker is public');
}

// ------------------------------------------------------------ price
{
	const { parsePrice } = await import('../src/lib/validate.js');
	ok(parsePrice('45') === 4500 && parsePrice('£45.50') === 4550 && parsePrice('1,200') === 120000, 'price: pounds are parsed to pence');
	ok(parsePrice('free') === 0 && parsePrice('0') === 0 && parsePrice('') === null, 'price: free, zero and blank');
	ok(parsePrice('abc') === undefined && parsePrice('45.555') === undefined && parsePrice('-5') === undefined, 'price: junk is rejected');

	const { extractInfo } = await import('../src/lib/server/linkinfo.js');
	const offers = (o) => extractInfo(`<title>Show</title><script type="application/ld+json">{"@type":"Event","name":"Some show","startDate":"2026-12-01","offers":${o}}</script>`, 'https://example.com/');
	const agg = offers('{"@type":"AggregateOffer","priceCurrency":"GBP","lowPrice":"30","highPrice":"60.5"}');
	ok(agg.price_min === 30 && agg.price_max === 60.5, 'prefill: price range read from an AggregateOffer');
	const one = offers('[{"@type":"Offer","priceCurrency":"GBP","price":"45.00"}]');
	ok(one.price_min === 45 && one.price_max === undefined, 'prefill: single offer price read');
	const usd = offers('{"@type":"Offer","priceCurrency":"USD","price":"45"}');
	ok(usd.price_min === undefined, 'prefill: non-GBP prices are ignored');

	const mk = (extra) => alice.post('/events/new', { title: 'Priced ' + Math.random().toString(36).slice(2, 6), start_date: addDays(50), ...extra });
	const range = await mk({ price_amount_0: '45', price_amount_1: '60' });
	const rangePath = loc(range);
	ok(range.status === 303 && !!rangePath, 'event with two prices is created');
	const rangePage = await (await alice.req(rangePath)).text();
	ok(rangePage.includes('£45–£60') && rangePage.includes('per person'), 'event page shows the price range');
	ok((await (await alice.req('/plans')).text()).includes('£45–£60'), 'plans list shows the price flag');
	const tiers = await mk({ price_label_0: 'Curzon', price_amount_0: '18', price_label_1: 'Vue', price_amount_1: '12.99', price_estimate_1: '1' });
	const tiersPage = await (await alice.req(loc(tiers))).text();
	ok(tiersPage.includes('Curzon') && tiersPage.includes('Vue') && tiersPage.includes('~£12.99') && tiersPage.includes('£18') && tiersPage.includes('estimate'), 'labelled price rows are listed, estimates marked with ~');
	ok((await (await alice.req('/plans')).text()).includes('~£12.99–£18'), 'cards show the range with ~ when any price is an estimate');
	const free = await mk({ price_amount_0: 'free' });
	ok(!!loc(free) && (await (await alice.req(loc(free))).text()).includes('Free'), '"free" is accepted and shown as Free');
	const noAmount = await mk({ price_label_0: 'Only a label' });
	ok(noAmount.status === 400 && (await noAmount.text()).includes('Add an amount'), 'a price row with a label but no amount is refused');
	const junk = await mk({ price_amount_0: 'abc' });
	ok(junk.status === 400 && (await junk.text()).includes('value="abc"'), 'a bad price is refused and what was typed is shown again');
	const many = {};
	for (let i = 0; i < 9; i++) many['price_amount_' + i] = String(10 + i);
	ok((await mk(many)).status === 400, 'more than eight prices are refused');
	const edit = await alice.post(rangePath + '/edit', { title: 'Priced renamed', start_date: addDays(50), price_amount_0: '45.5' });
	ok(edit.status === 303 && (await (await alice.req(rangePath)).text()).includes('£45.50'), 'editing the price works and keeps pence');
	ok(!(await (await alice.req(rangePath + '/edit')).text()).includes('value="60"'), 'the removed row is gone from the edit form');
	const editForm = await (await alice.req(loc(tiers) + '/edit')).text();
	ok(editForm.includes('value="Curzon"') && editForm.includes('value="12.99"') && /name="price_estimate_1"[^>]*checked/.test(editForm), 'the edit form shows the rows and the estimate tick');

	const apiMake = await call('/api/v1/events', { method: 'POST', body: { title: 'Api priced', start_date: addDays(30), price_min: 45.5, price_max: 60 } });
	const apiEv = (await apiMake.json()).event;
	ok(apiMake.status === 201 && apiEv.price_min === 45.5 && apiEv.price_max === 60 && apiEv.prices.length === 2, 'API creates events with a price range (pounds)');
	const rename = await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { title: 'Api priced renamed' } });
	const renamed = (await rename.json()).event;
	ok(renamed.price_min === 45.5 && renamed.price_max === 60 && renamed.prices.length === 2, 'API update keeps the price when it is not sent');
	ok((await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { price_max: 40 } })).status === 400, 'API refuses a top price below the lowest');
	ok((await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { price_min: 'abc' } })).status === 400, 'API refuses a non-numeric price');
	const tiered = await call('/api/v1/events/' + apiEv.id, {
		method: 'PATCH',
		body: { prices: [{ label: 'Curzon Mayfair', amount: 18 }, { label: 'Vue West End', amount: 12.99, estimate: true }, { amount: 0 }] }
	});
	const t = (await tiered.json()).event;
	ok(tiered.status === 200 && t.prices.length === 3 && t.prices[1].estimate === true && t.price_min === 0 && t.price_max === 18 && t.price_estimate === true, 'API sets tiered prices with estimates; the summary follows');
	ok((await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { title: 'Api tiered' } }).then((r) => r.json())).event.prices.length === 3, 'API update keeps the rows when prices is not sent');
	ok((await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { prices: [{ label: 'x' }] } })).status === 400, 'API refuses a price row without an amount');
	ok((await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { prices: 'cheap' } })).status === 400, 'API refuses prices that is not a list');
	const clear = await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { prices: null } });
	const cleared = (await clear.json()).event;
	ok(clear.status === 200 && cleared.price_min === null && cleared.price_max === null && cleared.prices.length === 0, 'API can clear the prices with null');
	const clear2 = await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { price_min: 20 } });
	ok((await clear2.json()).event.prices.length === 1, 'the old price_min shortcut still works');
	const clear3 = await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { price_min: null, price_max: null } });
	ok((await clear3.json()).event.price_min === null, 'price_min null clears');
}

// ------------------------------------------------------------ settings + spots limit
{
	const settings = await (await alice.req('/settings')).text();
	ok(settings.includes('Calendar') && settings.includes('Travel times') && settings.includes('Switch name'), 'settings page has calendar, travel times and account');
	const plansHtml = await (await alice.req('/plans')).text();
	ok(!plansHtml.includes('Subscribe') && !plansHtml.includes('Your stations'), 'plans page no longer carries the calendar and travel panels');

	const mk = async (name) => {
		const c = new Client('10.0.5.' + (10 + Math.floor(Math.random() * 200)));
		await c.post('/login', { password: PASSWORD });
		await c.post('/who?/create', { name });
		return c;
	};
	const cat = await mk('Cat Spots');
	const dan = await mk('Dan Spots');
	const made = await alice.post('/events/new', { title: 'Darts night', start_date: addDays(60), capacity: '2' });
	const darts = loc(made);
	ok(made.status === 303 && !!darts, 'event with a spots limit is created');
	ok((await alice.post('/events/new', { title: 'Bad spots', start_date: addDays(60), capacity: '0' })).status === 400, 'zero spots is refused');
	ok((await alice.post('/events/new', { title: 'Bad spots', start_date: addDays(60), capacity: 'lots' })).status === 400, 'non-numeric spots is refused');
	let page = await (await alice.req(darts)).text();
	ok(page.includes('1 of 2'), 'event page shows spots taken');
	await cat.post(darts + '?/join', {});
	page = await (await alice.req(darts)).text();
	ok(page.includes('2 of 2') && !page.includes('Waiting list'), 'two people fill both spots');
	const danPage = await (await dan.req(darts)).text();
	ok(danPage.includes('Join the waiting list'), 'a full event offers the waiting list');
	await dan.post(darts + '?/join', {});
	page = await (await alice.req(darts)).text();
	ok(page.includes('Waiting list') && page.includes('Dan Spots') && page.includes('#1'), 'the third person is on the waiting list');
	const api = (await (await call('/api/v1/events?q=Darts%20night')).json()).events[0];
	ok(api.capacity === 2 && api.interested.length === 2 && api.waiting_list.length === 1 && api.waiting_list[0] === 'Dan Spots', 'API reports spots and the waiting list');
	await cat.post(darts + '?/leave', {});
	page = await (await alice.req(darts)).text();
	ok(page.includes('2 of 2') && !page.includes('Waiting list'), 'when someone leaves the next person gets their spot');
	const edit = await alice.post(darts + '/edit', { title: 'Darts night', start_date: addDays(60), capacity: '' });
	ok(edit.status === 303 && !(await (await alice.req(darts)).text()).includes('of 2'), 'clearing the limit removes it');
	const mine = (await (await call('/api/v1/events', { method: 'POST', body: { title: 'Api spots', start_date: addDays(61), capacity: 4 } })).json()).event;
	ok(mine.capacity === 4, 'API creates an event with a limit');
	const patch = await call('/api/v1/events/' + mine.id, { method: 'PATCH', body: { capacity: 3 } });
	ok(patch.status === 200 && (await patch.json()).event.capacity === 3, 'API can change the limit');
	ok((await call('/api/v1/events/' + mine.id, { method: 'PATCH', body: { capacity: 'x' } })).status === 400, 'API refuses a bad limit');
	const clr = await call('/api/v1/events/' + mine.id, { method: 'PATCH', body: { capacity: null } });
	ok((await clr.json()).event.capacity === null, 'API can clear the limit with null');
}

// ------------------------------------------------------------ clubs
{
	const mk = async (name) => {
		const c = new Client('10.0.6.' + (10 + Math.floor(Math.random() * 200)));
		await c.post('/login', { password: PASSWORD });
		await c.post('/who?/create', { name });
		return c;
	};
	const eve = await mk('Eve Club');
	const finn = await mk('Finn Club');
	const gus = await mk('Gus Club');
	ok((await alice.post('/clubs?/create', { name: 'x' })).status === 400, 'a one-letter club name is refused');
	const created = await alice.post('/clubs?/create', { name: 'Movie club', description: 'New releases and the odd classic' });
	const clubPath = loc(created);
	ok(created.status === 303 && /^\/clubs\/\d+$/.test(clubPath ?? ''), 'a club can be started');
	const clubId = clubPath.split('/').pop();
	const dupe = await gus.post('/clubs?/create', { name: 'movie CLUB' });
	ok(dupe.status === 400 && (await dupe.text()).includes('already a club'), 'club names are unique, ignoring case');
	let list = await (await eve.req('/clubs')).text();
	ok(list.includes('Movie club') && list.includes('1 member'), 'the club list shows the club and its members');
	await eve.post('/clubs?/join', { club: clubId });
	let page = await (await gus.req(clubPath)).text();
	ok(page.includes('Alice') && page.includes('Eve Club'), 'members are visible on the club page');
	ok((await gus.req(clubPath)).status === 200 && page.includes('Join this club'), 'someone not in the club is offered Join');

	const made = await alice.post('/events/new', { title: 'Club film', start_date: addDays(70), club: clubId });
	const filmPath = loc(made);
	ok(made.status === 303 && !!filmPath, 'an event can be put in a club');
	ok((await (await alice.req(filmPath)).text()).includes('Movie club'), 'the event page names the club');
	ok((await (await alice.req(clubPath)).text()).includes('Club film'), 'the club page lists its upcoming events');
	ok((await alice.post('/events/new', { title: 'Bad club', start_date: addDays(70), club: '99999' })).status === 400, 'an unknown club is refused');
	ok((await finn.req('/')).status === 200 && (await deckHtml(finn)).includes('Club film'), 'club events are still open to people who are not in the club');
	ok((await (await alice.req(filmPath + '/edit')).text()).includes('selected'), 'the edit form preselects the club');

	const api = await (await call('/api/v1/clubs')).json();
	ok(api.clubs.some((c) => c.name === 'Movie club' && c.members.includes('Alice') && c.members.includes('Eve Club')), 'API lists clubs with their members');
	const apiMake = await call('/api/v1/events', { method: 'POST', body: { title: 'Api club film', start_date: addDays(71), club: 'movie club' } });
	const apiEv = (await apiMake.json()).event;
	ok(apiMake.status === 201 && apiEv.club === 'Movie club', 'API puts an event in a club by name');
	ok((await call('/api/v1/events', { method: 'POST', body: { title: 'Nope', start_date: addDays(71), club: 'No such club' } })).status === 400, 'API refuses an unknown club');
	const keep = await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { title: 'Api club film 2' } });
	ok((await keep.json()).event.club === 'Movie club', 'API update keeps the club when it is not sent');
	const out = await call('/api/v1/events/' + apiEv.id, { method: 'PATCH', body: { club: null } });
	ok((await out.json()).event.club === null, 'API can take an event out of its club with null');

	ok((await gus.post(clubPath + '?/delete', {})).status === 403, 'only the person who started a club can delete it');
	ok((await gus.post(clubPath + '?/save', { name: 'Hijacked' })).status === 403, 'only the person who started a club can edit it');
	const saved = await alice.post(clubPath + '?/save', { name: 'Film club', description: 'Cinema nights' });
	ok(saved.status === 200 && (await (await alice.req(clubPath)).text()).includes('Film club'), 'the creator can rename the club');
	await eve.post(clubPath + '?/leave', {});
	ok(!(await (await alice.req(clubPath)).text()).includes('Eve Club'), 'leaving a club removes you from the members');
	const del = await alice.post(clubPath + '?/delete', {});
	ok(del.status === 303 && loc(del) === '/clubs', 'the creator can delete the club');
	const after = await (await alice.req(filmPath)).text();
	ok(after.includes('Club film') && !after.includes('Film club'), 'deleting a club keeps its events');
}

// ------------------------------------------------------------ interest level + in-app browser posts
{
	const mk = async (name) => {
		const c = new Client('10.0.7.' + (10 + Math.floor(Math.random() * 200)));
		await c.post('/login', { password: PASSWORD });
		await c.post('/who?/create', { name });
		return c;
	};
	const ivy = await mk('Ivy Meter');
	const jon = await mk('Jon Meter');
	const made = await alice.post('/events/new', { title: 'Meter night', start_date: addDays(80) });
	const path = loc(made);
	const id = Number(path.split('/').pop());
	const swipe = (c, body) => c.req('/api/swipe', { method: 'POST', json: { eventId: id, ...body } });
	ok((await swipe(ivy, { decision: 'interested' })).status === 200, 'swiping right saves straight away');
	ok((await (await ivy.req(path)).text()).includes('title="Keen"'), 'the default level is Keen');
	ok((await swipe(ivy, { decision: 'interest', interest: 3 })).status === 200, 'the level can be raised afterwards');
	ok((await (await jon.req(path)).text()).includes("title=\"Can't wait\""), 'others see the level next to the name');
	ok((await swipe(ivy, { decision: 'interest', interest: 4 })).status === 400, 'a level outside 1 to 3 is refused');
	ok((await swipe(jon, { decision: 'interest', interest: 1 })).status === 200 && !(await (await jon.req(path)).text()).includes('title="Curious"'), 'you cannot set a level before you are in');
	const form = await ivy.post(path + '?/interest', { level: '1' });
	ok(form.status < 400 && (await (await ivy.req(path)).text()).includes('title="Curious"'), 'the event page can change your own level');
	ok((await jon.post(path + '?/interest', { level: '2' })).status === 403, 'non-members cannot set a level on the event page');
	await swipe(ivy, { decision: 'not_interested' });
	await swipe(ivy, { decision: 'interested' });
	ok((await (await ivy.req(path)).text()).includes('title="Keen"'), 'coming back in resets to Keen');

	// the CSRF check lets in-app browsers (missing or "null" Origin) through but still blocks cross-site posts
	const post = (headers) =>
		fetch(BASE + '/login', {
			method: 'POST',
			redirect: 'manual',
			headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '10.0.8.' + Math.floor(Math.random() * 250), ...headers },
			body: new URLSearchParams({ password: 'wrong' })
		});
	ok((await post({})).status === 401, 'a form post with no Origin is allowed (in-app browsers)');
	ok((await post({ origin: 'null' })).status === 401, 'a form post with a "null" Origin is allowed');
	ok((await post({ origin: BASE })).status === 401, 'a form post from our own origin is allowed');
	ok((await post({ origin: 'https://evil.example' })).status === 403, 'a form post from another site is blocked');
	ok((await post({ 'sec-fetch-site': 'cross-site' })).status === 403, 'a post the browser marks cross-site is blocked');
}

// ------------------------------------------------------------ travel times (fake TfL + geocoder)
if (process.env.TRAVEL_TESTS !== '1') {
	console.log('SKIP  travel-time checks (set TRAVEL_TESTS=1 and start the server with TFL_BASE/GEOCODE_BASE)');
} else {
	const http = await import('node:http');
	const calls = { search: 0, journey: 0, geocode: 0 };
	const fake = http.createServer((req, res) => {
		const u = new URL(req.url, 'http://x');
		const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
		if (u.pathname === '/StopPoint/Search') {
			calls.search++;
			return send({ matches: [
				{ id: '940GZZLUBWR', name: 'Bow Road Underground Station', modes: ['tube'] },
				{ id: 'HUBBOW', name: 'Bow Road Underground Station', modes: ['tube'] },
				{ id: '940GZZLUBBB', name: 'Bow Church DLR Station', modes: ['dlr'] },
				{ id: '../evil', name: 'Bad id', modes: [] }
			] });
		}
		if (u.pathname.startsWith('/Journey/JourneyResults/')) {
			calls.journey++;
			const from = decodeURIComponent(u.pathname.split('/')[3]);
			if (from === 'BROKEN') { res.statusCode = 500; return res.end('no'); }
			const mins = from === 'HUBBOW' ? 25 : 40;
			return send({ journeys: [
				{ duration: mins + 6, legs: [{ mode: { id: 'bus' }, routeOptions: [{ name: '8' }] }] },
				{ duration: mins, legs: [{ mode: { id: 'walking' } }, { mode: { id: 'tube' }, routeOptions: [{ name: 'District' }] }, { mode: { id: 'tube' }, routeOptions: [{ name: 'District' }] }, { mode: { id: 'tube' }, routeOptions: [{ name: 'Central' }] }] }
			] });
		}
		if (u.pathname === '/search') {
			calls.geocode++;
			return send(/apollo/i.test(u.searchParams.get('q') ?? '') ? [{ lat: '51.4906', lon: '-0.2243' }] : []);
		}
		res.statusCode = 404; res.end();
	});
	await new Promise((r) => fake.listen(3199, '127.0.0.1', r));

	const anon = new Client('10.0.4.1');
	ok((await anon.req('/stations')).status === 303, 'stations page needs a login');
	ok((await anon.req('/stations/search?q=bow')).status === 303, 'station search needs a login');

	const search = await alice.req('/stations/search?q=bow', { headers: { accept: 'application/json' } });
	const found = (await search.json()).stations;
	ok(search.status === 200 && found.length === 2 && found[0].id === 'HUBBOW', 'station search dedupes by name, prefers the interchange id, drops bad ids');
	ok((await (await alice.req('/stations/search?q=b')).json()).stations.length === 0, 'station search needs at least 2 letters');

	const bobT = new Client('10.0.4.2');
	await bobT.post('/login', { password: PASSWORD });
	await bobT.post('/who?/create', { name: 'Travel Bob' });

	ok((await alice.post('/stations?/save', { kind: 'home', id: '../x', name: 'Nope' })).status === 400, 'saving a station with a bad id is refused');
	ok((await alice.post('/stations?/save', { kind: 'club', id: 'HUBBOW', name: 'Nope' })).status === 400, 'saving a station with a bad kind is refused');
	await alice.post('/stations?/save', { kind: 'home', id: 'HUBBOW', name: 'Bow Road' });
	ok((await (await alice.req('/stations')).text()).includes('Bow Road'), 'home station is saved and shown');

	const made = await alice.post('/events/new', { title: 'Gig at the Apollo', location: 'Eventim Apollo, London', start_date: addDays(10) });
	const gigPath = loc(made);
	const gigId = gigPath.split('/').pop();
	const t1 = await (await alice.req(`/events/${gigId}/travel`)).json();
	ok(t1.rows.length === 1 && t1.rows[0].minutes === 25 && t1.rows[0].station === 'Bow Road' && t1.rows[0].summary === 'District → Central', 'journey time uses the fastest option and a tidy line summary');
	const before = { ...calls };
	const t2 = await (await alice.req(`/events/${gigId}/travel`)).json();
	ok(t2.rows[0].minutes === 25 && calls.journey === before.journey && calls.geocode === before.geocode, 'second request is served from cache (no TfL or geocoder calls)');

	await alice.post('/stations?/save', { kind: 'work', id: 'HUBLIV', name: 'Liverpool Street' });
	const t3 = await (await alice.req(`/events/${gigId}/travel`)).json();
	ok(t3.rows.length === 2 && t3.rows.some((r) => r.kind === 'work' && r.minutes === 40), 'work station adds a second journey time');
	ok(calls.geocode === before.geocode, 'the venue is only geocoded once');

	ok((await (await alice.req('/plans')).text()).includes('Home 25 min'), 'plans list shows the cached journey time');
	const deck = await (await bobT.req(`/events/${gigId}`)).text();
	ok(!deck.includes('Bow Road') && !deck.includes('25 min'), "other people can't see someone's station or times");
	const bt = await (await bobT.req(`/events/${gigId}/travel`)).json();
	ok(bt.hasStations === false && bt.rows.length === 0, 'someone with no stations gets no times (and is nudged to set them)');

	const nowhere = await alice.post('/events/new', { title: 'Mystery', location: 'Nowhere Special, London', start_date: addDays(11) });
	const nw = await (await alice.req(`/events/${loc(nowhere).split('/').pop()}/travel`)).json();
	ok(nw.rows.length === 0, 'an unknown or non-London venue gets no journey time');
	const calls2 = calls.geocode;
	await alice.req(`/events/${loc(nowhere).split('/').pop()}/travel`);
	ok(calls.geocode === calls2, 'a venue that could not be found is not looked up again');

	const geoBefore = calls.geocode;
	const edin = await alice.post('/events/new', { title: 'Hogmanay', location: 'Edinburgh, UK', start_date: addDays(12) });
	const ed = await (await alice.req(`/events/${loc(edin).split('/').pop()}/travel`)).json();
	ok(ed.rows.length === 0 && calls.geocode === geoBefore, 'a venue that does not say London gets no journey time and is not looked up');

	await alice.post('/stations?/save', { kind: 'work', id: 'BROKEN', name: 'Broken' });
	const broken = await (await alice.req(`/events/${gigId}/travel`)).json();
	ok(broken.rows.length === 1 && broken.rows[0].kind === 'home', 'a TfL failure for one station does not break the others');
	await alice.post('/stations?/clear', { kind: 'work' });
	ok(!(await (await alice.req('/stations')).text()).includes('Liverpool Street'), 'a station can be removed');

	const { travelDate } = await import('../src/lib/server/travel.js');
	ok(travelDate({ start_date: addDays(5) }, addDays(0)) === addDays(5), 'travel date: soon events use their own day');
	ok(new Date(travelDate({ start_date: addDays(90) }, addDays(0)) + 'T00:00:00Z').getUTCDay() === 2, 'travel date: far-off events use a typical Tuesday');
	ok(travelDate({ start_date: addDays(-3) }, addDays(0)) === addDays(1), 'travel date: events already started use tomorrow');
	fake.close();
}

// Creator deletes
const del = await alice.post(evPath + '?/delete', {});
ok(del.status === 303 && loc(del) === '/plans', 'creator can delete the event');
ok((await alice.req(evPath)).status === 404, 'deleted event is 404');

// ------------------------------------------------------------ personal invite links, admin
{
	const tokenOf = async (c) => (await (await c.req('/settings')).text()).match(/\/join\/([A-Za-z0-9_-]{20,})/)?.[1];
	const mk = async (name, ip) => {
		const c = new Client(ip);
		await c.post('/login', { password: PASSWORD });
		await c.post('/who?/create', { name });
		return c;
	};
	const dora = await mk('Dora', '10.0.7.1');
	const tokD = await tokenOf(dora);
	ok(!!tokD, 'settings shows a personal sign-in link');
	ok((await tokenOf(dora)) === tokD, 'the link stays the same between visits');

	const anon = new Client('10.0.7.2');
	const landing = await anon.req('/join/' + tokD);
	ok(landing.status === 200 && (await landing.text()).includes('Continue as Dora'), 'join page names the person and needs a tap');
	ok((await anon.req('/')).status === 303, 'opening the link alone does not sign in');
	const go = await anon.post('/join/' + tokD, {});
	ok(go.status === 303 && loc(go) === '/', 'tapping continue signs in');
	ok((await anon.req('/')).status === 200, 'signed in as Dora via link');
	ok((await (await anon.req('/settings')).text()).includes(tokD), 'same person, same link');
	ok((await new Client('10.0.7.3').req('/join/not-a-real-token-at-all-0000')).status === 200, 'unknown link shows a friendly page');
	ok((await new Client('10.0.7.3').post('/join/not-a-real-token-at-all-0000', {})).status === 404, 'unknown link cannot sign in');

	// admin gate
	ok((await dora.req('/admin')).status === 403, 'non-admin cannot open /admin');
	ok((await dora.post('/admin?/pause', { id: 1 })).status === 403, 'non-admin cannot pause people');
	const adminPage = await alice.req('/admin');
	const ah = await adminPage.text();
	ok(adminPage.status === 200 && ah.includes('Dora') && ah.includes(tokD), 'admin sees everyone and their links');

	// reset: old link dead, devices signed out
	const reset = await alice.post('/admin?/reset', { id: await idOf('Dora') });
	ok(reset.status !== 403 && reset.status < 400, 'admin can make a new link');
	ok((await dora.req('/')).status === 303, 'old devices are signed out after a new link');
	ok((await anon.req('/')).status === 303, 'the link device is signed out too');
	ok((await new Client('10.0.7.4').post('/join/' + tokD, {})).status === 404, 'old link no longer works');

	const adminAfter = await (await alice.req('/admin')).text();
	ok(!adminAfter.includes(tokD) && /\/join\/|token/.test(adminAfter), 'admin page shows the new link only');

	async function idOf(name) {
		const h = await (await alice.req('/admin')).text();
		const m = h.match(new RegExp(`id:(\\d+),name:"${name}"`));
		return m?.[1];
	}

	// pause / resume
	const eve = await mk('Eve', '10.0.7.6');
	const tokE = await tokenOf(eve);
	const eveId = await idOf('Eve');
	await alice.post('/admin?/pause', { id: eveId });
	ok((await eve.req('/')).status === 303, 'a paused person is signed out');
	ok((await new Client('10.0.7.7').post('/join/' + tokE, {})).status === 404, "a paused person's link is off");
	const who = await new Client('10.0.7.8');
	await who.post('/login', { password: PASSWORD });
	const pickEve = await who.post('/who?/pick', { id: eveId });
	ok(pickEve.status === 400, 'a paused person cannot be picked with the password');
	await alice.post('/admin?/resume', { id: eveId });
	ok((await new Client('10.0.7.9').post('/join/' + tokE, {})).status === 303, 'resumed link works again');

	// admin cannot pause themselves
	const aliceId = await idOf('Alice');
	ok((await alice.post('/admin?/pause', { id: aliceId })).status === 400, 'admin cannot pause themselves');

	// password fallback toggle
	await alice.post('/admin?/passwordLogin', { on: '0' });
	const noPw = new Client('10.0.7.10');
	ok((await noPw.post('/login', { password: PASSWORD })).status === 403, 'password sign-in can be switched off');
	ok(!(await (await noPw.req('/login')).text()).includes('name="password"'), 'login page hides the password box');
	ok((await new Client('10.0.7.11').post('/join/' + tokE, {})).status === 303, 'links still work with password off');
	await alice.post('/admin?/passwordLogin', { on: '1' });
	ok((await new Client('10.0.7.12').post('/login', { password: PASSWORD })).status === 303, 'password sign-in can be switched back on');
}

// ------------------------------------------------------------ nameless sign-up invites
{
	const html = async (r) => await r.text();
	await alice.post('/admin?/invite', { note: 'Fran' });
	const page = await html(await alice.req('/admin'));
	const tok = page.match(/token:"([A-Za-z0-9_-]{20,})",note:"Fran"/)?.[1];
	ok(!!tok, 'admin can make a nameless invite');
	const f = new Client('10.0.8.1');
	const land = await f.req('/join/' + tok);
	ok((await html(land)).includes('Your name'), 'invite page asks for a name');
	ok((await f.post('/join/' + tok, { name: '' })).status === 400, 'a name is required');
	ok((await f.post('/join/' + tok, { name: 'alice' })).status === 400, 'a taken name is refused');
	const made = await f.post('/join/' + tok, { name: 'Fran' });
	ok(made.status === 303 && loc(made) === '/', 'typing a name creates the account');
	ok((await f.req('/')).status === 200, 'new person is signed in');
	const again = new Client('10.0.8.2');
	ok((await again.post('/join/' + tok, { name: 'Fran2' })).status === 404, 'an invite only works once');
	ok((await html(await alice.req('/admin'))).includes('Fran'), 'admin sees who joined');
	await alice.post('/admin?/invite', { note: 'Gone' });
	const p2 = await html(await alice.req('/admin'));
	const t2 = p2.match(/token:"([A-Za-z0-9_-]{20,})",note:"Gone"/)?.[1];
	const iid = p2.match(/id:(\d+),token:"[^"]+",note:"Gone"/)?.[1];
	await alice.post('/admin?/revokeInvite', { id: iid });
	ok((await new Client('10.0.8.3').post('/join/' + t2, { name: 'Ghost' })).status === 404, 'a revoked invite does not work');
	ok((await f.post('/admin?/invite', { note: 'x' })).status === 403, 'non-admin cannot make invites');
}

// ------------------------------------------------------------ invite expiry, welcome panel
{
	const { default: Database } = await import('better-sqlite3');
	await alice.post('/admin?/invite', { note: 'Stale' });
	const h = await (await alice.req('/admin')).text();
	const t = h.match(/token:"([A-Za-z0-9_-]{20,})",note:"Stale"/)?.[1];
	const sdb = new Database(process.env.DB_PATH ?? '/tmp/smokedata/invites.db');
	sdb.prepare(`UPDATE invite SET created_at = datetime('now','-15 days') WHERE token = ?`).run(t);
	sdb.close();
	ok((await new Client('10.0.9.1').post('/join/' + t, { name: 'Late' })).status === 404, 'an invite older than 14 days is refused');
	ok((await (await alice.req('/admin')).text()).includes('(expired)'), 'admin shows expired invites');
	const deck = await (await alice.req('/')).text();
	ok(deck.includes('Keep your link') || deck.includes('/join/'), 'deck carries the welcome panel data');
}

// ------------------------------------------------------------ price / date TBC
{
	const api = (path, method = 'GET', body) =>
		fetch(BASE + '/api/v1' + path, { method, headers: { authorization: 'Bearer api-token-for-smoke-tests-0123456789', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	const start = addDays(60);
	const mkEv = await api('/events', 'POST', { title: 'TBC Test Gig', start_date: start, price_tbd: true, date_tbd: true, prices: [{ amount: 20 }] });
	const ev = (await mkEv.json()).event;
	ok(mkEv.status === 201 && ev.price_tbd === true && ev.date_tbd === true, 'API can mark price and date TBC');
	ok(ev.prices.length === 0 && ev.price_min === null, 'a TBC price drops any price rows');
	const page = await (await alice.req('/events/' + ev.id)).text();
	ok(page.includes('To be confirmed') && page.includes('Date TBC'), 'event page shows price and date as TBC');
	await alice.req('/api/swipe', { method: 'POST', json: { eventId: ev.id, decision: 'interested' } });
	const plans = await (await alice.req('/plans')).text();
	ok(plans.includes('Price TBC') && plans.includes('Date TBC'), 'cards and rows show TBC flags');
	const feed = await (await alice.req('/settings')).text();
	const cal = feed.match(/\/calendar\/([A-Za-z0-9_-]{32})\.ics/)?.[1];
	const ics = await (await new Client('10.0.10.1').req('/calendar/' + cal + '.ics')).text();
	ok(!ics.includes('TBC Test Gig'), 'a TBC-date event stays out of the calendar feed');
	const fix = await api('/events/' + ev.id, 'PATCH', { price_tbd: false, date_tbd: false, prices: [{ label: 'Standing', amount: 25 }] });
	const fixed = (await fix.json()).event;
	ok(fix.status === 200 && !fixed.price_tbd && !fixed.date_tbd && fixed.prices.length === 1, 'API can clear the TBC flags and set a price');
	ok((await api('/events/' + ev.id, 'PATCH', { date_tbd: 'yes' })).status === 400, 'TBC flags must be booleans');
	// form: the checkbox wins over typed amounts, and the edit form remembers it
	const made = await alice.post('/events/new', { title: 'Form TBC Gig', start_date: start, date_tbd: '1', price_tbd: '1', price_label_0: 'x', price_amount_0: '10' });
	ok(made.status === 303, 'form accepts the TBC checkboxes');
	const formEvId = loc(made).match(/\/events\/(\d+)/)?.[1];
	const formEv = (await (await api('/events/' + formEvId)).json()).event;
	ok(formEv.price_tbd && formEv.date_tbd && formEv.prices.length === 0, 'form TBC price drops the typed amount');
	const editPage = await (await alice.req(`/events/${formEvId}/edit`)).text();
	ok(/name="price_tbd"[^>]*checked|checked[^>]*name="price_tbd"/.test(editPage), 'edit form shows the price TBC box ticked');
}

// ------------------------------------------------------------ anytime events, go-ahead number
{
	const api = (path, method = 'GET', body) =>
		fetch(BASE + '/api/v1' + path, { method, headers: { authorization: 'Bearer api-token-for-smoke-tests-0123456789', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	const bare = await api('/events', 'POST', { title: 'Dateless fail' });
	ok(bare.status === 400, 'a dated event still needs a start date');
	const r = await api('/events', 'POST', { title: 'Museum Trip', anytime: true, min_people: 3, location: 'British Museum, London' });
	const ev = (await r.json()).event;
	ok(r.status === 201 && ev.anytime === true && ev.start_date === null && ev.min_people === 3, 'API creates an anytime event with a go-ahead number');
	ok((await api('/events', 'POST', { title: 'Museum Trip', anytime: true })).status === 409, 'duplicate anytime titles are refused');
	const list = (await (await api('/events')).json()).events;
	ok(list.some((e) => e.id === ev.id && e.start_date === null), 'anytime events are in the upcoming list');
	const page = await (await alice.req('/events/' + ev.id)).text();
	ok(page.includes('No date yet') && !page.includes('Add to calendar'), 'event page shows no date and no calendar link');
	ok((await alice.req('/events/' + ev.id + '/calendar.ics')).status === 404, 'an anytime event has no .ics');
	await alice.req('/api/swipe', { method: 'POST', json: { eventId: ev.id, decision: 'interested' } });
	const plans = await (await alice.req('/plans')).text();
	ok(plans.includes('Anytime') && plans.includes('of 3 keen'), 'plans show Anytime and progress to the go-ahead number');
	const feed = (await (await alice.req('/settings')).text()).match(/\/calendar\/([A-Za-z0-9_-]{32})\.ics/)?.[1];
	ok(!(await (await new Client('10.0.11.1').req('/calendar/' + feed + '.ics')).text()).includes('Museum Trip'), 'anytime events stay out of the calendar feed');
	ok((await api('/events/' + ev.id, 'PATCH', { anytime: false })).status === 400, 'giving it a date needs a start date');
	const dated = await api('/events/' + ev.id, 'PATCH', { anytime: false, start_date: addDays(40) });
	const d = (await dated.json()).event;
	ok(dated.status === 200 && d.anytime === false && d.start_date === addDays(40) && d.min_people === 3, 'setting a date turns it into a normal dated event');
	ok((await api('/events/' + ev.id, 'PATCH', { min_people: 'lots' })).status === 400, 'min_people must be a number');
	// form: no date needed when ticked, and over-capacity go-ahead is refused
	const f = await alice.post('/events/new', { title: 'Form Anytime', anytime: '1', min_people: '4' });
	ok(f.status === 303, 'form creates an anytime event without dates');
	const bad = await alice.post('/events/new', { title: 'Too many', anytime: '1', capacity: '2', min_people: '5' });
	ok(bad.status === 400, 'go-ahead number cannot exceed the spots');
}

// ------------------------------------------------------------ group invites, primary tags
{
	const html = async (r) => await r.text();
	const api = (path, method = 'GET', body) =>
		fetch(BASE + '/api/v1' + path, { method, headers: { authorization: 'Bearer api-token-for-smoke-tests-0123456789', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	await alice.post('/admin?/invite', { kind: 'group', max: '2', note: 'Darts chat' });
	const page = await html(await alice.req('/admin'));
	const tok = page.match(/token:"([A-Za-z0-9_-]{20,})",note:"Darts chat"/)?.[1];
	const iid = page.match(/id:(\d+),token:"[^"]+",note:"Darts chat"/)?.[1];
	ok(!!tok, 'admin can make a group invite');
	const one = new Client('10.0.12.1');
	ok((await one.post('/join/' + tok, { name: 'Gwen' })).status === 303, 'first person joins through the group link');
	const two = new Client('10.0.12.2');
	ok((await two.post('/join/' + tok, { name: 'Hal' })).status === 303, 'second person joins through the same link');
	ok((await new Client('10.0.12.3').post('/join/' + tok, { name: 'Ivy' })).status === 404, 'the link stops when it is full');
	const after = await html(await alice.req('/admin'));
	ok(after.includes('Gwen, Hal') || after.includes('Hal, Gwen'), 'admin sees who joined through the group link');
	ok(after.includes('2 of 2 joined'), 'admin sees how full the group link is');
	// revoke keeps people in, blocks new joins
	await alice.post('/admin?/invite', { kind: 'group', max: '5', note: 'Revoked chat' });
	const p2 = await html(await alice.req('/admin'));
	const t2 = p2.match(/token:"([A-Za-z0-9_-]{20,})",note:"Revoked chat"/)?.[1];
	const i2 = p2.match(/id:(\d+),token:"[^"]+",note:"Revoked chat"/)?.[1];
	const early = new Client('10.0.12.4');
	await early.post('/join/' + t2, { name: 'Jon' });
	await alice.post('/admin?/revokeInvite', { id: i2 });
	ok((await new Client('10.0.12.5').post('/join/' + t2, { name: 'Kit' })).status === 404, 'a revoked group link stops working');
	ok((await early.req('/')).status === 200, 'people who already joined stay in after a revoke');
	// primary tags
	const tagsPage = await html(await alice.req('/admin'));
	ok(tagsPage.includes('Main tags') && tagsPage.includes('gig'), 'admin shows the main tag list');
	await alice.post('/admin?/primaryTags', { tags: 'Gig, #Film , sport' });
	const t = await (await api('/tags')).json();
	ok(JSON.stringify(t.primary) === JSON.stringify(['gig', 'film', 'sport']), 'main tags are saved cleaned and in order');
	ok(Array.isArray(t.other) && !t.other.some((o) => o.tag === 'gig'), 'list_tags separates other tags from main ones');
	ok((await one.post('/admin?/primaryTags', { tags: 'x' })).status === 403, 'non-admin cannot change main tags');
	const eform = await html(await alice.req('/events/new'));
	ok(eform.includes('aria-label="Main tags"') && eform.includes('>film<'), 'event form offers the main tags as quick picks');
}

// ------------------------------------------------------------ lock + held spots
{
	const html = async (r) => await r.text();
	const join = async (ip, name) => {
		await alice.post('/admin?/invite', { kind: 'one', note: 'lock ' + name });
		const pg = await html(await alice.req('/admin'));
		const tk = pg.match(new RegExp('token:"([A-Za-z0-9_-]{20,})",note:"lock ' + name + '"'))?.[1];
		const c = new Client(ip);
		await c.post('/join/' + tk, { name });
		return c;
	};
	const mia = await join('10.0.13.1', 'Mia'), ned = await join('10.0.13.2', 'Ned'), ola = await join('10.0.13.3', 'Ola');
	const mk = await alice.post('/events/new', { title: 'Lockable Dinner', start_date: addDays(9), capacity: '4' });
	const eid = loc(mk)?.split('/').pop();
	ok(!!eid, 'organiser creates an event with 4 spots');
	// hold one spot for Ned and one generic
	const people = await html(await alice.req('/events/' + eid));
	const nedId = people.match(/<option value="(\d+)"[^>]*>Ned</)?.[1];
	ok(!!nedId, 'organiser panel lists people to hold a spot for');
	const rs = await alice.post('/events/' + eid + '?/reserve', [['rv_person', nedId], ['rv_note', 'Ned'], ['rv_person', ''], ['rv_note', 'plus one']]);
	ok(rs && rs.status < 400, 'organiser can hold spots');
	// Mia (not held) takes the only free spot, Ola waits
	await mia.req('/api/swipe', { method: 'POST', json: { eventId: Number(eid), decision: 'interested' } });
	await ola.req('/api/swipe', { method: 'POST', json: { eventId: Number(eid), decision: 'interested' } });
	let page = await html(await ola.req('/events/' + eid));
	ok(page.includes('(held)') && page.includes('plus one'), 'held spots show in the keen list');
	ok(page.includes('Waiting list') && page.includes('Ola'), 'held spots push people to the waiting list');
	await ned.req('/api/swipe', { method: 'POST', json: { eventId: Number(eid), decision: 'interested' } });
	page = await html(await mia.req('/events/' + eid));
	ok(page.includes('4 of 4'), 'held spots count towards the keen total');
	// lock
	ok((await mia.post('/events/' + eid + '?/lock', { note: 'x' })).status === 403, 'only the organiser can lock');
	await alice.post('/events/' + eid + '?/lock', { note: 'Booked for 3' });
	const deckNew = await html(await (await join('10.0.13.4', 'Pat')).req('/'));
	ok(!deckNew.includes('Lockable Dinner'), 'locked events are hidden from the deck for people who have not swiped');
	const blocked = await (await join('10.0.13.5', 'Quin')).req('/api/swipe', { method: 'POST', json: { eventId: Number(eid), decision: 'interested' } });
	ok(blocked.status === 409, 'swiping interested on a locked event is refused');
	const plans = await html(await mia.req('/plans'));
	ok(plans.includes('Lockable Dinner') && plans.includes('Locked'), 'people already in still see a locked event with a Locked flag');
	// API
	const api = (path, method = 'GET', body) =>
		fetch(BASE + '/api/v1' + path, { method, headers: { authorization: 'Bearer api-token-for-smoke-tests-0123456789', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	const ce = await (await api('/events', 'POST', { title: 'API lock', start_date: addDays(11), capacity: 2 })).json();
	const aid = ce.event.id;
	const up = await api('/events/' + aid, 'PATCH', { locked: true, lock_note: 'Full house', reserved: [{ note: 'Boss' }] });
	const uj = await up.json();
	if (up.status !== 200) console.log(JSON.stringify(uj));
	ok(up.status === 200 && uj.event.locked && uj.event.lock_note === 'Full house' && uj.event.held_spots.length === 1, 'API can lock and hold spots');
	const bad = await api('/events/' + aid, 'PATCH', { reserved: [{ person: 'Nobody Here' }] });
	ok(bad.status === 400, 'API rejects a held spot for an unknown person');
	const over = await api('/events/' + aid, 'PATCH', { reserved: [{}, {}, {}] });
	ok(over.status === 400, 'API rejects holding more spots than exist');
	const clear = await (await api('/events/' + aid, 'PATCH', { locked: false, reserved: [] })).json();
	ok(!clear.event.locked && clear.event.held_spots.length === 0, 'API can unlock and release held spots');
	// unlock restores deck
	await alice.post('/events/' + eid + '?/unlock', {});
	const quinDeck = await html(await (await join('10.0.13.6', 'Rae')).req('/'));
	ok(quinDeck.includes('Lockable Dinner'), 'unlocking brings the event back to the deck');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
