import Database from 'better-sqlite3';
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
	`ALTER TABLE event ADD COLUMN image TEXT;`
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
	return db().prepare('SELECT id, name FROM person WHERE id = ?').get(id) ?? null;
}
export function listPeople() {
	return db().prepare('SELECT id, name FROM person ORDER BY name COLLATE NOCASE').all();
}
export function createPerson(name) {
	const info = db().prepare('INSERT INTO person (name) VALUES (?)').run(name);
	return Number(info.lastInsertRowid);
}
export function findPersonByName(name) {
	return db().prepare('SELECT id, name FROM person WHERE name = ?').get(name) ?? null;
}

// ---------------------------------------------------------------- events
const splitTags = (s) => (s ? s.split(',') : []);

function hydrate(rows) {
	if (!rows.length) return [];
	const ids = rows.map((r) => r.id);
	const marks = ids.map(() => '?').join(',');
	const people = db()
		.prepare(
			`SELECT s.event_id, p.id, p.name FROM swipe s JOIN person p ON p.id = s.person_id
			 WHERE s.decision = 'interested' AND s.event_id IN (${marks}) ORDER BY s.created_at, p.id`
		)
		.all(...ids);
	const byEvent = new Map();
	for (const p of people) {
		if (!byEvent.has(p.event_id)) byEvent.set(p.event_id, []);
		byEvent.get(p.event_id).push({ id: p.id, name: p.name });
	}
	return rows.map((r) => ({ ...r, tags: splitTags(r.tags), interested: byEvent.get(r.id) ?? [] }));
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
				`INSERT INTO event (title, description, location, tags, start_date, end_date, chat_link, created_by)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(v.title, v.description, v.location, v.tags.join(','), v.start_date, v.end_date, v.chat_link, personId);
		const id = Number(info.lastInsertRowid);
		setSwipe(personId, id, 'interested');
		return id;
	})();
}

export function updateEvent(id, v) {
	db()
		.prepare(
			`UPDATE event SET title = ?, description = ?, location = ?, tags = ?, start_date = ?, end_date = ?, chat_link = ?
			 WHERE id = ?`
		)
		.run(v.title, v.description, v.location, v.tags.join(','), v.start_date, v.end_date, v.chat_link, id);
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
			   AND COALESCE(e.end_date, e.start_date) >= ?
			 ORDER BY e.start_date, e.id`
		)
		.all(personId, today);
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
export function setSwipe(personId, eventId, decision) {
	db()
		.prepare(
			`INSERT INTO swipe (person_id, event_id, decision) VALUES (?, ?, ?)
			 ON CONFLICT(person_id, event_id) DO UPDATE SET decision = excluded.decision, created_at = datetime('now')`
		)
		.run(personId, eventId, decision);
	if (decision !== 'interested') {
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
