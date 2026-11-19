// End-to-end smoke test against a running server.
//   INVITES_PASSWORD=... ORIGIN=http://localhost:3100 PORT=3100 node build &
//   BASE=http://localhost:3100 INVITES_PASSWORD=... node scripts/smoke.mjs
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
	async req(path, { method = 'GET', form, json, headers = {} } = {}) {
		const h = { origin: BASE, accept: 'text/html', 'cf-connecting-ip': this.ip, ...headers };
		if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
		let body;
		if (form) {
			body = new URLSearchParams(form);
			h['content-type'] = 'application/x-www-form-urlencoded';
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

// Creator deletes
const del = await alice.post(evPath + '?/delete', {});
ok(del.status === 303 && loc(del) === '/plans', 'creator can delete the event');
ok((await alice.req(evPath)).status === 404, 'deleted event is 404');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
