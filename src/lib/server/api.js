// Token-authenticated JSON API (/api/v1) for automation, e.g. an MCP gateway.
// Disabled (404) unless INVITES_API_TOKEN is set. Acts as one fixed person (INVITES_API_PERSON).
import crypto from 'node:crypto';
import { clientIp, loginBlocked, recordLoginFailure, clearLoginFailures } from './auth.js';
import { createPerson, findPersonByName, getPerson, listComments, listOptions } from './db.js';
import { validateEvent } from '../validate.js';

const MIN_TOKEN_LENGTH = 24;
const token = () => (process.env.INVITES_API_TOKEN ?? '').trim();
export const apiEnabled = () => token().length >= MIN_TOKEN_LENGTH;
const personName = () => (process.env.INVITES_API_PERSON ?? 'Stephen').trim() || 'Stephen';

const hash = (s) => crypto.createHash('sha256').update(s).digest();

export const json = (body, status = 200) =>
	Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const apiError = (status, error, details) => json(details ? { error, details } : { error }, status);

/** Returns a Response to short-circuit with, or { person } when the bearer token is valid. */
export function authenticate(event) {
	if (!apiEnabled()) return { response: apiError(404, 'API is not enabled') };
	const ip = 'api:' + clientIp(event);
	if (loginBlocked(ip)) return { response: apiError(429, 'Too many failed attempts, try later') };
	const m = /^Bearer\s+(.+)$/i.exec(event.request.headers.get('authorization') ?? '');
	if (!m || !crypto.timingSafeEqual(hash(m[1].trim()), hash(token()))) {
		recordLoginFailure(ip);
		return { response: apiError(401, 'Missing or invalid bearer token') };
	}
	clearLoginFailures(ip);
	const name = personName();
	const person = findPersonByName(name) ?? getPerson(createPerson(name));
	return { person };
}

const origin = (url) => (process.env.ORIGIN || url.origin).replace(/\/$/, '');

export function shapeEvent(e, url) {
	return {
		id: e.id,
		title: e.title,
		description: e.description,
		location: e.location,
		tags: e.tags,
		start_date: e.start_date,
		end_date: e.end_date,
		chat_link: e.chat_link,
		price_min: e.price_min == null ? null : e.price_min / 100,
		price_max: e.price_max == null ? null : e.price_max / 100,
		decide_by: e.decide_by ?? null,
		capacity: e.capacity ?? null,
		media_link: e.media_link ?? null,
		booking: e.booking_status ? { status: e.booking_status, by: e.booker_name, note: e.booking_note } : null,
		created_by: e.creator_name,
		image: e.image ? `${origin(url)}/img/${e.image}` : null,
		interested: e.interested.filter((p) => !p.waiting).map((p) => p.name),
		interested_count: e.going_count,
		waiting_list: e.interested.filter((p) => p.waiting).map((p) => p.name),
		url: `${origin(url)}/events/${e.id}`
	};
}

export function shapeDetail(e, url, personId) {
	return {
		...shapeEvent(e, url),
		date_options: listOptions(e.id, personId).map((o) => ({ date: o.date, voters: o.voters })),
		comments: listComments(e.id).map((c) => ({ by: c.name, body: c.body, at: c.created_at }))
	};
}

/**
 * Turn a JSON body into the FormData validateEvent expects. Missing keys fall back to `base`.
 * Unknown/mistyped fields produce an error list instead of being silently dropped.
 */
export function bodyToForm(body, base = {}) {
	const errors = {};
	if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: { body: 'Expected a JSON object' } };
	const allowed = ['title', 'description', 'location', 'tags', 'start_date', 'end_date', 'chat_link', 'decide_by', 'media_link', 'price_min', 'price_max', 'capacity'];
	for (const k of Object.keys(body)) if (!allowed.includes(k) && k !== 'image_url') errors[k] = 'Unknown field';
	if ('image_url' in body && body.image_url !== null && typeof body.image_url !== 'string') errors.image_url = 'Must be a string or null';
	const fd = new FormData();
	for (const k of allowed) {
		let v = k in body ? body[k] : base[k];
		if (k === 'price_min' || k === 'price_max') {
			// the API speaks pounds (numbers); the database holds pence
			if (!(k in body) && typeof v === 'number') v = v / 100;
			if (typeof v === 'number') v = Number.isFinite(v) ? String(v) : 'x';
		}
		if (k === 'capacity' && typeof v === 'number') v = Number.isInteger(v) ? String(v) : 'x';
		if (v === null || v === undefined) v = '';
		if (k === 'tags' && Array.isArray(v)) {
			if (!v.every((t) => typeof t === 'string')) errors.tags = 'Tags must be strings';
			v = v.join(',');
		}
		if (typeof v !== 'string') {
			errors[k] = 'Must be a string';
			v = '';
		}
		fd.set(k, v);
	}
	return { fd, errors };
}

export function validateBody(body, { base, today, requireFuture }) {
	const { fd, errors: shape } = bodyToForm(body, base);
	if (!fd) return { ok: false, errors: shape };
	const r = validateEvent(fd, { today, requireFuture });
	const errors = { ...shape, ...r.errors };
	return { ok: Object.keys(errors).length === 0, errors, values: r.values };
}
