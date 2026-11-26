import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
	// v1
	`
	CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

	CREATE TABLE person (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE event (
		id INTEGER PRIMARY KEY,
		title TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		location TEXT NOT NULL DEFAULT '',
		tags TEXT NOT NULL DEFAULT '',
		start_date TEXT NOT NULL,
		end_date TEXT,
		chat_link TEXT,
		created_by INTEGER NOT NULL REFERENCES person(id),
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX event_dates ON event (start_date, end_date);

	CREATE TABLE swipe (
		person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
		event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
		decision TEXT NOT NULL CHECK (decision IN ('interested', 'not_interested')),
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (person_id, event_id)
	);
	CREATE INDEX swipe_event ON swipe (event_id, decision);

	CREATE TABLE date_option (
		id INTEGER PRIMARY KEY,
		event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
		date TEXT NOT NULL,
		added_by INTEGER REFERENCES person(id),
		UNIQUE (event_id, date)
	);

	CREATE TABLE date_vote (
		option_id INTEGER NOT NULL REFERENCES date_option(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
		PRIMARY KEY (option_id, person_id)
	);

	CREATE TABLE comment (
		id INTEGER PRIMARY KEY,
		event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
		body TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX comment_event ON comment (event_id, id);
	`,
	// v2: optional banner image (stored filename in <data dir>/images)
	`ALTER TABLE event ADD COLUMN image TEXT;`,
	// v3: secret per-person token for the read-only calendar feed
	`ALTER TABLE person ADD COLUMN cal_token TEXT;
	CREATE UNIQUE INDEX person_cal_token ON person (cal_token) WHERE cal_token IS NOT NULL;`,
	// v4: decide-by date, watch/listen link, and who is booking tickets
	`ALTER TABLE event ADD COLUMN decide_by TEXT;
	ALTER TABLE event ADD COLUMN media_link TEXT;
	ALTER TABLE event ADD COLUMN booker_id INTEGER REFERENCES person(id) ON DELETE SET NULL;
	ALTER TABLE event ADD COLUMN booking_status TEXT;
	ALTER TABLE event ADD COLUMN booking_note TEXT;`,
	// v5: price per person in pence (price_max only for a range)
	`ALTER TABLE event ADD COLUMN price_min INTEGER;
	ALTER TABLE event ADD COLUMN price_max INTEGER;`,
	// v6: private home/work stations per person, geocoded venue, cached journey times
	`ALTER TABLE person ADD COLUMN home_station_id TEXT;
	ALTER TABLE person ADD COLUMN home_station_name TEXT;
	ALTER TABLE person ADD COLUMN work_station_id TEXT;
	ALTER TABLE person ADD COLUMN work_station_name TEXT;
	ALTER TABLE event ADD COLUMN geo_for TEXT;
	ALTER TABLE event ADD COLUMN geo_lat REAL;
	ALTER TABLE event ADD COLUMN geo_lon REAL;
	CREATE TABLE travel_cache (
		key TEXT PRIMARY KEY,
		minutes INTEGER NOT NULL,
		summary TEXT NOT NULL,
		fetched_at INTEGER NOT NULL
	);`,
	// v7: optional limit on how many people can go (the rest wait in order)
	`ALTER TABLE event ADD COLUMN capacity INTEGER;`,
	// v8: price rows (several venues or ticket types, each optionally an estimate).
	// event.price_min / price_max / price_estimate stay as a summary for the cards.
	`ALTER TABLE event ADD COLUMN price_estimate INTEGER NOT NULL DEFAULT 0;
	CREATE TABLE event_price (
		id INTEGER PRIMARY KEY,
		event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
		label TEXT NOT NULL DEFAULT '',
		amount INTEGER NOT NULL,
		estimate INTEGER NOT NULL DEFAULT 0,
		position INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX event_price_event ON event_price (event_id, position);
	INSERT INTO event_price (event_id, label, amount, position)
		SELECT id, CASE WHEN price_max IS NULL THEN '' ELSE 'From' END, price_min, 0 FROM event WHERE price_min IS NOT NULL;
	INSERT INTO event_price (event_id, label, amount, position)
		SELECT id, 'Up to', price_max, 1 FROM event WHERE price_max IS NOT NULL;`,
	// v9: clubs (open to everyone to join; events can belong to one)
	`CREATE TABLE club (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE,
		description TEXT NOT NULL DEFAULT '',
		created_by INTEGER REFERENCES person(id) ON DELETE SET NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE club_member (
		club_id INTEGER NOT NULL REFERENCES club(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (club_id, person_id)
	);
	CREATE INDEX club_member_person ON club_member (person_id);
	ALTER TABLE event ADD COLUMN club_id INTEGER REFERENCES club(id) ON DELETE SET NULL;`,
	// v10: how keen someone is (1 curious, 2 keen, 3 can't wait)
	`ALTER TABLE swipe ADD COLUMN interest INTEGER NOT NULL DEFAULT 2 CHECK (interest BETWEEN 1 AND 3);`,
	// v11: personal invite links, admin, pausing access, and a per-person session epoch (bumping it signs every device out)
	`ALTER TABLE person ADD COLUMN invite_token TEXT;
	ALTER TABLE person ADD COLUMN invite_used_at TEXT;
	ALTER TABLE person ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE person ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE person ADD COLUMN sess_epoch INTEGER NOT NULL DEFAULT 0;
	CREATE UNIQUE INDEX person_invite_token ON person (invite_token) WHERE invite_token IS NOT NULL;`,
	// v12: nameless one-time sign-up invites; the friend types their own name
	`CREATE TABLE invite (
		id INTEGER PRIMARY KEY,
		token TEXT NOT NULL UNIQUE,
		note TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		used_by INTEGER REFERENCES person(id) ON DELETE SET NULL,
		used_at TEXT,
		revoked INTEGER NOT NULL DEFAULT 0
	);`,
	// v13: price and date can be marked TBC. A TBC date keeps its start_date as a rough placeholder (sorting, spots), but is shown as TBC and kept out of calendar feeds.
	`ALTER TABLE event ADD COLUMN price_tbd INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE event ADD COLUMN date_tbd INTEGER NOT NULL DEFAULT 0;`,
	// v14: "anytime" events with no date (start_date holds a far-future sentinel) and an optional go-ahead number of keen people
	`ALTER TABLE event ADD COLUMN anytime INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE event ADD COLUMN min_people INTEGER;`,
	// v15: group invite links (several joins, tracked in invite_join) and a curated list of primary tags for the filter chips
	`ALTER TABLE invite ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1;
	ALTER TABLE invite ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
	CREATE TABLE invite_join (
		invite_id INTEGER NOT NULL REFERENCES invite(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
		joined_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (invite_id, person_id)
	);
	INSERT INTO invite_join (invite_id, person_id) SELECT id, used_by FROM invite WHERE used_by IS NOT NULL;
	UPDATE invite SET uses = 1 WHERE used_by IS NOT NULL;
	CREATE TABLE tag_primary (name TEXT PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0);
	INSERT INTO tag_primary (name, position) VALUES ('gig', 0), ('cinema', 1), ('sport', 2), ('food', 3), ('trip', 4), ('outdoors', 5);`,
	// v16: organiser controls: lock an event, and hold spots (unnamed, or for a named person on the app)
	`ALTER TABLE event ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE event ADD COLUMN lock_note TEXT;
	CREATE TABLE event_reservation (
		id INTEGER PRIMARY KEY,
		event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
		person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
		note TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX event_reservation_event ON event_reservation (event_id);`
];

let _db;

/** Lazily opened so that build-time analysis never touches the filesystem. */
export function db() {
	if (_db) return _db;
	const file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'invites.db');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const d = new Database(file);
	d.pragma('journal_mode = WAL');
	d.pragma('foreign_keys = ON');
	d.pragma('busy_timeout = 5000');
	const current = d.pragma('user_version', { simple: true });
	for (let v = current; v < MIGRATIONS.length; v++) {
		d.transaction(() => {
			d.exec(MIGRATIONS[v]);
			d.pragma(`user_version = ${v + 1}`);
		})();
	}
	_db = d;
	ensureAdmin();
	return d;
}

export function todayISO() {
	// en-CA formats as YYYY-MM-DD; TZ env decides which day it is (set TZ=Europe/London)
	return new Date().toLocaleDateString('en-CA');
}

// ---------------------------------------------------------------- meta
export function getMeta(key) {
	return db().prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
export function setMeta(key, value) {
	db()
		.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
		.run(key, value);
}

// ---------------------------------------------------------------- people
export function getPerson(id) {
	return db().prepare('SELECT id, name, is_admin, disabled, sess_epoch FROM person WHERE id = ?').get(id) ?? null;
}
export function listPeople() {
	return db().prepare('SELECT id, name FROM person ORDER BY name COLLATE NOCASE').all();
}
export function createPerson(name) {
	const info = db().prepare('INSERT INTO person (name) VALUES (?)').run(name);
	ensureAdmin();
	return Number(info.lastInsertRowid);
}
export function findPersonByName(name) {
	return db().prepare('SELECT id, name FROM person WHERE name = ?').get(name) ?? null;
}

// ---------------------------------------------------------------- invite links, admin, access
/** The first admin is the person named in ADMIN_NAME (default INVITES_API_PERSON, then Stephen), once they exist. */
export function ensureAdmin() {
	const d = _db;
	if (!d || d.prepare('SELECT 1 FROM person WHERE is_admin = 1').get()) return;
	const name = (process.env.ADMIN_NAME || process.env.INVITES_API_PERSON || 'Stephen').trim();
	d.prepare('UPDATE person SET is_admin = 1 WHERE name = ? COLLATE NOCASE').run(name);
}

/** A person's personal sign-in link secret; made the first time it is asked for and kept until reset. */
export function getInviteToken(personId) {
	const row = db().prepare('SELECT invite_token FROM person WHERE id = ?').get(personId);
	return row?.invite_token || resetInviteToken(personId, false);
}

/** New link secret. The old link stops working; with signOut every device of that person is signed out too. */
export function resetInviteToken(personId, signOut = true) {
	const token = crypto.randomBytes(24).toString('base64url');
	db()
		.prepare(`UPDATE person SET invite_token = ?, invite_used_at = NULL, sess_epoch = sess_epoch + ? WHERE id = ?`)
		.run(token, signOut ? 1 : 0, personId);
	return token;
}

/** Who a link belongs to, or null for an unknown link or a paused person. */
export function personByInviteToken(token) {
	if (!token || token.length < 16) return null;
	return (
		db().prepare('SELECT id, name, sess_epoch FROM person WHERE invite_token = ? AND disabled = 0').get(token) ?? null
	);
}

export function markInviteUsed(personId) {
	db().prepare(`UPDATE person SET invite_used_at = COALESCE(invite_used_at, datetime('now')) WHERE id = ?`).run(personId);
}

export function setDisabled(personId, disabled) {
	db().prepare('UPDATE person SET disabled = ?, sess_epoch = sess_epoch + 1 WHERE id = ?').run(disabled ? 1 : 0, personId);
}

/** Everyone, for the admin page. Links are made on demand for people who don't have one yet. */
export function listPeopleAdmin() {
	const rows = db()
		.prepare('SELECT id, name, is_admin, disabled, invite_used_at FROM person ORDER BY name COLLATE NOCASE')
		.all();
	return rows.map((r) => ({ ...r, token: getInviteToken(r.id) }));
}

/** maxUses 1 = a single person's invite; more = a group link (capped by the caller). */
export function createInvite(note = '', maxUses = 1) {
	const token = crypto.randomBytes(24).toString('base64url');
	db().prepare('INSERT INTO invite (token, note, max_uses) VALUES (?, ?, ?)').run(token, note.slice(0, 40), maxUses);
	return token;
}
const INVITE_LIVE = "revoked = 0 AND uses < max_uses AND created_at > datetime('now', '-14 days')";
/** An invite that can still be used (not revoked, not full, under 14 days old), or null. */
export function openInvite(token) {
	if (!token || token.length < 16) return null;
	return db().prepare(`SELECT id, token, note FROM invite WHERE token = ? AND ${INVITE_LIVE}`).get(token) ?? null;
}
export function listInvites() {
	return db()
		.prepare(`SELECT i.id, i.token, i.note, i.max_uses, i.uses, i.revoked, i.created_at,
			(i.uses < i.max_uses AND i.created_at <= datetime('now', '-14 days')) AS expired,
			(SELECT group_concat(p.name, ', ') FROM invite_join j JOIN person p ON p.id = j.person_id WHERE j.invite_id = i.id) AS joined
			FROM invite i ORDER BY i.id DESC LIMIT 50`)
		.all();
}
/** Stops further joins; people who already came in through it stay in. */
export function revokeInvite(id) {
	db().prepare('UPDATE invite SET revoked = 1 WHERE id = ?').run(id);
}
/** Make the person and use up one place on the invite in one step. */
export function redeemInvite(inviteId, name) {
	return db().transaction(() => {
		const personId = createPerson(name);
		const info = db().prepare(`UPDATE invite SET uses = uses + 1 WHERE id = ? AND ${INVITE_LIVE}`).run(inviteId);
		if (!info.changes) throw new Error('invite used');
		db().prepare('INSERT INTO invite_join (invite_id, person_id) VALUES (?, ?)').run(inviteId, personId);
		markInviteUsed(personId);
		return personId;
	})();
}

// ---------------------------------------------------------------- primary tags
export function listPrimaryTags() {
	return db().prepare('SELECT name FROM tag_primary ORDER BY position, name').all().map((r) => r.name);
}
export function setPrimaryTags(names) {
	const d = db();
	d.transaction(() => {
		d.prepare('DELETE FROM tag_primary').run();
		const ins = d.prepare('INSERT OR IGNORE INTO tag_primary (name, position) VALUES (?, ?)');
		names.forEach((n, i) => ins.run(n, i));
	})();
}
/** Every tag in use with how many events carry it, most used first. */
export function tagCounts() {
	const counts = new Map();
	for (const { tags } of db().prepare('SELECT tags FROM event').all())
		for (const t of String(tags).split(',')) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
	return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export const passwordLoginOn = () => getMeta('password_login') !== 'off';

// ---------------------------------------------------------------- stations & travel (private to each person)
export function getStations(personId) {
	const r = db()
		.prepare('SELECT home_station_id, home_station_name, work_station_id, work_station_name FROM person WHERE id = ?')
		.get(personId);
	return {
		home: r?.home_station_id ? { id: r.home_station_id, name: r.home_station_name } : null,
		work: r?.work_station_id ? { id: r.work_station_id, name: r.work_station_name } : null
	};
}
export function setStation(personId, kind, id, name) {
	const sql =
		kind === 'home'
			? 'UPDATE person SET home_station_id = ?, home_station_name = ? WHERE id = ?'
			: 'UPDATE person SET work_station_id = ?, work_station_name = ? WHERE id = ?';
	db().prepare(sql).run(id, name, personId);
}
export function setGeo(eventId, text, lat, lon) {
	db().prepare('UPDATE event SET geo_for = ?, geo_lat = ?, geo_lon = ? WHERE id = ?').run(text, lat, lon, eventId);
}
export function getTravel(key, maxAgeMs) {
	const r = db().prepare('SELECT minutes, summary, fetched_at FROM travel_cache WHERE key = ?').get(key);
	return r && Date.now() - r.fetched_at <= maxAgeMs ? { minutes: r.minutes, summary: r.summary } : null;
}
export function putTravel(key, minutes, summary) {
	db()
		.prepare(
			`INSERT INTO travel_cache (key, minutes, summary, fetched_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET minutes = excluded.minutes, summary = excluded.summary, fetched_at = excluded.fetched_at`
		)
		.run(key, minutes, summary, Date.now());
	// keep the cache from growing forever
	db().prepare('DELETE FROM travel_cache WHERE fetched_at < ?').run(Date.now() - 30 * 86_400_000);
}

// ---------------------------------------------------------------- calendar feed token
export function getCalToken(personId) {
	const row = db().prepare('SELECT cal_token FROM person WHERE id = ?').get(personId);
	if (row?.cal_token) return row.cal_token;
	return resetCalToken(personId);
}
export function resetCalToken(personId) {
	const token = crypto.randomBytes(24).toString('base64url');
	db().prepare('UPDATE person SET cal_token = ? WHERE id = ?').run(token, personId);
	return token;
}
export function personByCalToken(token) {
	return db().prepare('SELECT id, name FROM person WHERE cal_token = ?').get(token) ?? null;
}

// ---------------------------------------------------------------- events
const splitTags = (s) => (s ? s.split(',') : []);

function hydrate(rows) {
	if (!rows.length) return [];
	const ids = rows.map((r) => r.id);
	const marks = ids.map(() => '?').join(',');
	const people = db()
		.prepare(
			`SELECT s.event_id, p.id, p.name, s.interest FROM swipe s JOIN person p ON p.id = s.person_id
			 WHERE s.decision = 'interested' AND s.event_id IN (${marks}) ORDER BY s.created_at, p.id`
		)
		.all(...ids);
	const byEvent = new Map();
	for (const p of people) {
		if (!byEvent.has(p.event_id)) byEvent.set(p.event_id, []);
		byEvent.get(p.event_id).push({ id: p.id, name: p.name, interest: p.interest });
	}
	const bookerIds = [...new Set(rows.map((r) => r.booker_id).filter(Boolean))];
	const bookers = new Map();
	if (bookerIds.length) {
		const q = bookerIds.map(() => '?').join(',');
		for (const b of db().prepare(`SELECT id, name FROM person WHERE id IN (${q})`).all(...bookerIds)) bookers.set(b.id, b.name);
	}
	const clubNames = new Map();
	const clubIds = [...new Set(rows.map((r) => r.club_id).filter(Boolean))];
	if (clubIds.length) {
		const q = clubIds.map(() => '?').join(',');
		for (const c of db().prepare(`SELECT id, name FROM club WHERE id IN (${q})`).all(...clubIds)) clubNames.set(c.id, c.name);
	}
	const priceRows = new Map();
	for (const pr of db()
		.prepare(`SELECT event_id, label, amount, estimate FROM event_price WHERE event_id IN (${marks}) ORDER BY position, id`)
		.all(...ids)) {
		if (!priceRows.has(pr.event_id)) priceRows.set(pr.event_id, []);
		priceRows.get(pr.event_id).push({ label: pr.label, amount: pr.amount, estimate: !!pr.estimate });
	}
	const resByEvent = new Map();
	for (const rv of db()
		.prepare(
			`SELECT v.id, v.event_id, v.person_id, v.note, p.name AS person_name FROM event_reservation v
			 LEFT JOIN person p ON p.id = v.person_id WHERE v.event_id IN (${marks}) ORDER BY v.id`
		)
		.all(...ids)) {
		if (!resByEvent.has(rv.event_id)) resByEvent.set(rv.event_id, []);
		resByEvent.get(rv.event_id).push(rv);
	}
	return rows.map((r) => {
		// with a limit, the first people to say they're keen get the spots and the rest wait in order.
		// Held spots come off the top; someone a spot is held for goes straight in when they say they're keen.
		const all = byEvent.get(r.id) ?? [];
		const rsv = resByEvent.get(r.id) ?? [];
		const cap = r.capacity ?? Infinity;
		const heldFor = new Set(rsv.map((v) => v.person_id).filter(Boolean));
		const queueCap = Math.max(0, cap - rsv.length);
		let q = 0;
		const interested = all.map((p) => (heldFor.has(p.id) ? { ...p, waiting: false } : { ...p, waiting: q++ >= queueCap }));
		const takenIds = new Set(all.map((p) => p.id));
		const reservations = rsv.map((v) => ({ id: v.id, person_id: v.person_id, person: v.person_name ?? null, note: v.note, taken: !!v.person_id && takenIds.has(v.person_id) }));
		const going = interested.filter((p) => !p.waiting).length;
		return {
			...r,
			tags: splitTags(r.tags),
			interested,
			prices: priceRows.get(r.id) ?? [],
			club_name: clubNames.get(r.club_id) ?? null,
			going_count: going,
			waiting_count: interested.length - going,
			reservations,
			held_count: reservations.filter((v) => !v.taken).length,
			booker_name: bookers.get(r.booker_id) ?? null
		};
	});
}

export function getEvent(id) {
	const row = db()
		.prepare(
			`SELECT e.*, p.name AS creator_name FROM event e JOIN person p ON p.id = e.created_by WHERE e.id = ?`
		)
		.get(id);
	return row ? hydrate([row])[0] : null;
}

export function createEvent(v, personId) {
	const d = db();
	return d.transaction(() => {
		const info = d
			.prepare(
				`INSERT INTO event (title, description, location, tags, start_date, end_date, chat_link, decide_by, media_link, price_min, price_max, price_estimate, capacity, club_id, price_tbd, date_tbd, anytime, min_people, created_by)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(v.title, v.description, v.location, v.tags.join(','), v.start_date, v.end_date, v.chat_link, v.decide_by ?? null, v.media_link ?? null, v.price_min ?? null, v.price_max ?? null, v.price_estimate ?? 0, v.capacity ?? null, v.club_id ?? null, v.price_tbd ? 1 : 0, v.date_tbd ? 1 : 0, v.anytime ? 1 : 0, v.min_people ?? null, personId);
		const id = Number(info.lastInsertRowid);
		setPrices(id, v.prices);
		setSwipe(personId, id, 'interested');
		return id;
	})();
}

/** Replace an event's price rows (pence amounts, already validated). */
export function setPrices(eventId, rows = []) {
	const d = db();
	d.prepare('DELETE FROM event_price WHERE event_id = ?').run(eventId);
	const ins = d.prepare('INSERT INTO event_price (event_id, label, amount, estimate, position) VALUES (?, ?, ?, ?, ?)');
	rows.filter((r) => typeof r.amount === 'number').forEach((r, i) => ins.run(eventId, r.label ?? '', r.amount, r.estimate ? 1 : 0, i));
}

export function updateEvent(id, v) {
	db()
		.prepare(
			`UPDATE event SET title = ?, description = ?, location = ?, tags = ?, start_date = ?, end_date = ?, chat_link = ?,
			   decide_by = ?, media_link = ?, price_min = ?, price_max = ?, price_estimate = ?, capacity = ?, club_id = ?, price_tbd = ?, date_tbd = ?, anytime = ?, min_people = ?
			 WHERE id = ?`
		)
		.run(v.title, v.description, v.location, v.tags.join(','), v.start_date, v.end_date, v.chat_link, v.decide_by ?? null, v.media_link ?? null, v.price_min ?? null, v.price_max ?? null, v.price_estimate ?? 0, v.capacity ?? null, v.club_id ?? null, v.price_tbd ? 1 : 0, v.date_tbd ? 1 : 0, v.anytime ? 1 : 0, v.min_people ?? null, id);
	setPrices(id, v.prices);
	// Poll options that now fall outside the event's dates are no longer valid
	db()
		.prepare('DELETE FROM date_option WHERE event_id = ? AND (date < ? OR date > ?)')
		.run(id, v.start_date, v.end_date ?? v.start_date);
}

export function setImage(id, name) {
	db().prepare('UPDATE event SET image = ? WHERE id = ?').run(name, id);
}

export function setChatLink(id, link) {
	db().prepare('UPDATE event SET chat_link = ? WHERE id = ?').run(link, id);
}

// ---------------------------------------------------------------- clubs
const clubRow = (r, personId) => ({
	id: r.id,
	name: r.name,
	description: r.description,
	created_by: r.created_by,
	creator_name: r.creator_name ?? null,
	members: db()
		.prepare('SELECT p.id, p.name FROM club_member m JOIN person p ON p.id = m.person_id WHERE m.club_id = ? ORDER BY m.created_at, p.id')
		.all(r.id),
	upcoming: r.upcoming ?? 0
});

function withJoined(club, personId) {
	return { ...club, joined: club.members.some((m) => m.id === personId) };
}

/** All clubs, with members and the number of upcoming events. */
export function listClubs(personId, today = todayISO()) {
	const rows = db()
		.prepare(
			`SELECT c.*, p.name AS creator_name,
			   (SELECT COUNT(*) FROM event e WHERE e.club_id = c.id AND COALESCE(e.end_date, e.start_date) >= ?) AS upcoming
			 FROM club c LEFT JOIN person p ON p.id = c.created_by ORDER BY c.name COLLATE NOCASE`
		)
		.all(today);
	return rows.map((r) => withJoined(clubRow(r), personId));
}

export function getClub(id, personId, today = todayISO()) {
	const r = db()
		.prepare(
			`SELECT c.*, p.name AS creator_name,
			   (SELECT COUNT(*) FROM event e WHERE e.club_id = c.id AND COALESCE(e.end_date, e.start_date) >= ?) AS upcoming
			 FROM club c LEFT JOIN person p ON p.id = c.created_by WHERE c.id = ?`
		)
		.get(today, id);
	return r ? withJoined(clubRow(r), personId) : null;
}

export function clubIdSet() {
	return new Set(db().prepare('SELECT id FROM club').all().map((r) => r.id));
}

/** @returns {{id:number}|{error:string}} */
export function createClub(name, description, personId) {
	const d = db();
	if (d.prepare('SELECT 1 FROM club WHERE name = ? COLLATE NOCASE').get(name)) return { error: 'There is already a club with that name' };
	return d.transaction(() => {
		const id = Number(d.prepare('INSERT INTO club (name, description, created_by) VALUES (?, ?, ?)').run(name, description, personId).lastInsertRowid);
		d.prepare('INSERT INTO club_member (club_id, person_id) VALUES (?, ?)').run(id, personId);
		return { id };
	})();
}

/** @returns {{ok:true}|{error:string}} */
export function updateClub(id, name, description) {
	const d = db();
	const clash = d.prepare('SELECT id FROM club WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, id);
	if (clash) return { error: 'There is already a club with that name' };
	d.prepare('UPDATE club SET name = ?, description = ? WHERE id = ?').run(name, description, id);
	return { ok: true };
}

export function deleteClub(id) {
	db().prepare('DELETE FROM club WHERE id = ?').run(id);
}

export function joinClub(clubId, personId) {
	db().prepare('INSERT OR IGNORE INTO club_member (club_id, person_id) VALUES (?, ?)').run(clubId, personId);
}

export function leaveClub(clubId, personId) {
	db().prepare('DELETE FROM club_member WHERE club_id = ? AND person_id = ?').run(clubId, personId);
}

/** Upcoming events in a club, soonest first. */
export function eventsForClub(clubId, today) {
	const rows = db()
		.prepare(
			`SELECT e.*, p.name AS creator_name FROM event e JOIN person p ON p.id = e.created_by
			 WHERE e.club_id = ? AND COALESCE(e.end_date, e.start_date) >= ? ORDER BY e.start_date, e.id`
		)
		.all(clubId, today);
	return hydrate(rows);
}

// ---------------------------------------------------------------- ticket booking
/** Take on booking if nobody has. @returns {boolean} whether this person now holds it */
export function claimBooking(eventId, personId) {
	return (
		db()
			.prepare(`UPDATE event SET booker_id = ?, booking_status = 'booking', booking_note = NULL WHERE id = ? AND booker_id IS NULL`)
			.run(personId, eventId).changes === 1
	);
}
export function markBooked(eventId, personId, note) {
	return (
		db()
			.prepare(`UPDATE event SET booking_status = 'booked', booking_note = ? WHERE id = ? AND booker_id = ?`)
			.run(note || null, eventId, personId).changes === 1
	);
}
export function releaseBooking(eventId) {
	db().prepare(`UPDATE event SET booker_id = NULL, booking_status = NULL, booking_note = NULL WHERE id = ?`).run(eventId);
}

export function deleteEvent(id) {
	db().prepare('DELETE FROM event WHERE id = ?').run(id);
}

/** Events for the API: scope upcoming (default) | past | all, optional text filter. */
export function listEvents({ scope = 'upcoming', q = '', today, limit = 100 }) {
	const where = [];
	const args = [];
	if (scope === 'upcoming') {
		where.push('COALESCE(e.end_date, e.start_date) >= ?');
		args.push(today);
	} else if (scope === 'past') {
		where.push('COALESCE(e.end_date, e.start_date) < ?');
		args.push(today);
	}
	if (q) {
		const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
		where.push("(e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\' OR e.location LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\')");
		args.push(like, like, like, like);
	}
	const rows = db()
		.prepare(
			`SELECT e.*, p.name AS creator_name FROM event e JOIN person p ON p.id = e.created_by
			 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
			 ORDER BY e.start_date, e.id LIMIT ?`
		)
		.all(...args, limit);
	return hydrate(rows);
}

export function findDuplicateEvent(title, startDate) {
	return (
		db()
			.prepare('SELECT id FROM event WHERE title = ? COLLATE NOCASE AND start_date = ?')
			.get(title, startDate)?.id ?? null
	);
}

/** Events this person hasn't swiped on yet that haven't finished. */
export function deckFor(personId, today) {
	const rows = db()
		.prepare(
			`SELECT e.*, p.name AS creator_name FROM event e JOIN person p ON p.id = e.created_by
			 WHERE NOT EXISTS (SELECT 1 FROM swipe s WHERE s.event_id = e.id AND s.person_id = ?)
			   AND (e.locked = 0 OR EXISTS (SELECT 1 FROM event_reservation v WHERE v.event_id = e.id AND v.person_id = ?))
			   AND COALESCE(e.end_date, e.start_date) >= ?
			 ORDER BY CASE WHEN e.decide_by IS NOT NULL AND e.decide_by >= ? AND e.decide_by <= date(?, '+7 days') THEN 0 ELSE 1 END,
			          e.start_date, e.id`
		)
		.all(personId, personId, today, today, today);
	return hydrate(rows);
}

/** Events the person swiped a given way on, soonest first. */
export function eventsByDecision(personId, decision) {
	const rows = db()
		.prepare(
			`SELECT e.*, p.name AS creator_name FROM event e JOIN person p ON p.id = e.created_by
			 JOIN swipe s ON s.event_id = e.id AND s.person_id = ? AND s.decision = ?
			 ORDER BY e.start_date, e.id`
		)
		.all(personId, decision);
	return hydrate(rows);
}

// ---------------------------------------------------------------- swipes
/** interest (1-3) is only used for 'interested'; left null it keeps the earlier level (default 2). */
export function setSwipe(personId, eventId, decision, interest = null) {
	const level = Number.isInteger(interest) && interest >= 1 && interest <= 3 ? interest : null;
	db()
		.prepare(
			`INSERT INTO swipe (person_id, event_id, decision, interest) VALUES (?, ?, ?, ?)
			 ON CONFLICT(person_id, event_id) DO UPDATE SET decision = excluded.decision, created_at = datetime('now'),
			   interest = CASE WHEN ? IS NULL THEN swipe.interest ELSE excluded.interest END`
		)
		.run(personId, eventId, decision, level ?? 2, level);
	if (decision !== 'interested') {
		// leaving the group hands back any ticket booking they had taken on
		db()
			.prepare(`UPDATE event SET booker_id = NULL, booking_status = NULL, booking_note = NULL WHERE id = ? AND booker_id = ?`)
			.run(eventId, personId);
		// leaving the group also withdraws any date votes
		db()
			.prepare(
				`DELETE FROM date_vote WHERE person_id = ? AND option_id IN (SELECT id FROM date_option WHERE event_id = ?)`
			)
			.run(personId, eventId);
	}
}

export function clearSwipe(personId, eventId) {
	db().prepare('DELETE FROM swipe WHERE person_id = ? AND event_id = ?').run(personId, eventId);
}

export function setInterest(personId, eventId, interest) {
	db()
		.prepare(`UPDATE swipe SET interest = ? WHERE person_id = ? AND event_id = ? AND decision = 'interested'`)
		.run(interest, personId, eventId);
}

export function getSwipe(personId, eventId) {
	return (
		db().prepare('SELECT decision FROM swipe WHERE person_id = ? AND event_id = ?').get(personId, eventId)
			?.decision ?? null
	);
}

// ---------------------------------------------------------------- date poll
export function listOptions(eventId, personId) {
	const opts = db().prepare('SELECT id, date FROM date_option WHERE event_id = ? ORDER BY date').all(eventId);
	if (!opts.length) return [];
	const marks = opts.map(() => '?').join(',');
	const votes = db()
		.prepare(
			`SELECT v.option_id, p.id AS person_id, p.name FROM date_vote v JOIN person p ON p.id = v.person_id
			 WHERE v.option_id IN (${marks}) ORDER BY p.name COLLATE NOCASE`
		)
		.all(...opts.map((o) => o.id));
	return opts.map((o) => {
		const voters = votes.filter((v) => v.option_id === o.id);
		return {
			id: o.id,
			date: o.date,
			voters: voters.map((v) => v.name),
			mine: voters.some((v) => v.person_id === personId)
		};
	});
}

export function addOption(eventId, date, personId) {
	db()
		.prepare('INSERT OR IGNORE INTO date_option (event_id, date, added_by) VALUES (?, ?, ?)')
		.run(eventId, date, personId);
}

export function getOption(id) {
	return db().prepare('SELECT id, event_id, date FROM date_option WHERE id = ?').get(id) ?? null;
}

export function deleteOption(id) {
	db().prepare('DELETE FROM date_option WHERE id = ?').run(id);
}

export function toggleVote(optionId, personId) {
	const d = db();
	const has = d.prepare('SELECT 1 FROM date_vote WHERE option_id = ? AND person_id = ?').get(optionId, personId);
	if (has) d.prepare('DELETE FROM date_vote WHERE option_id = ? AND person_id = ?').run(optionId, personId);
	else d.prepare('INSERT INTO date_vote (option_id, person_id) VALUES (?, ?)').run(optionId, personId);
}

// ---------------------------------------------------------------- comments
export function listComments(eventId) {
	return db()
		.prepare(
			`SELECT c.id, c.person_id, p.name, c.body, c.created_at FROM comment c
			 JOIN person p ON p.id = c.person_id WHERE c.event_id = ? ORDER BY c.id`
		)
		.all(eventId);
}
export function addComment(eventId, personId, body) {
	db().prepare('INSERT INTO comment (event_id, person_id, body) VALUES (?, ?, ?)').run(eventId, personId, body);
}
export function deleteComment(id, personId) {
	db().prepare('DELETE FROM comment WHERE id = ? AND person_id = ?').run(id, personId);
}


// ---------------------------------------------------------------- organiser controls: lock and held spots
export function setLock(eventId, locked, note = null) {
	db().prepare('UPDATE event SET locked = ?, lock_note = ? WHERE id = ?').run(locked ? 1 : 0, locked ? (note ?? '').slice(0, 80) || null : null, eventId);
}

/** Can this person say they're keen? Not when the event is locked, unless they're already in or a spot is held for them. */
export function joinBlocked(personId, ev) {
	if (!ev.locked) return false;
	if (ev.interested.some((p) => p.id === personId)) return false;
	return !ev.reservations.some((v) => v.person_id === personId);
}

/**
 * Would these held spots bump anyone who is going now? rows = [{person_id, note}], goingIds = people with a spot today.
 * Returns an error message or null.
 */
export function reservationProblem(capacity, goingIds, rows) {
	if (!rows.length) return null;
	if (capacity == null) return 'Set the number of spots first, then you can hold some.';
	const held = new Set(rows.map((r) => r.person_id).filter(Boolean));
	const others = goingIds.filter((id) => !held.has(id)).length;
	if (rows.length + others > capacity) return `You can hold up to ${Math.max(0, capacity - others)} spots right now; the rest are taken by people already going.`;
	return null;
}

/** Replace all held spots on an event (caller has checked reservationProblem). */
export function setReservations(eventId, rows) {
	const d = db();
	d.transaction(() => {
		d.prepare('DELETE FROM event_reservation WHERE event_id = ?').run(eventId);
		const ins = d.prepare('INSERT INTO event_reservation (event_id, person_id, note) VALUES (?, ?, ?)');
		for (const r of rows) ins.run(eventId, r.person_id ?? null, (r.note ?? '').slice(0, 40));
	})();
}

/** Organiser-only tallies: people who passed or left, and active people who have not swiped on it yet. */
export function responseCounts(eventId) {
	const d = db();
	const passed = d.prepare("SELECT COUNT(*) AS n FROM swipe WHERE event_id = ? AND decision = 'not_interested'").get(eventId).n;
	const unseen = d
		.prepare('SELECT COUNT(*) AS n FROM person p WHERE p.disabled = 0 AND NOT EXISTS (SELECT 1 FROM swipe s WHERE s.event_id = ? AND s.person_id = p.id)')
		.get(eventId).n;
	return { passed, unseen };
}
