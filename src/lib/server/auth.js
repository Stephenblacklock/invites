import crypto from 'node:crypto';
import { getMeta, setMeta } from './db.js';

export const COOKIE = 'invites_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

const MIN_PASSWORD_LENGTH = 8;

const password = () => process.env.INVITES_PASSWORD ?? '';

/** The app refuses to serve anything (fails closed) until a usable password is set. */
export const passwordConfigured = () => password().length >= MIN_PASSWORD_LENGTH;

let _key;
/**
 * HMAC key = random secret (env or persisted in the DB) mixed with the password, so
 * changing INVITES_PASSWORD invalidates every existing session.
 */
function key() {
	if (_key) return _key;
	let secret = process.env.SESSION_SECRET || getMeta('session_secret');
	if (!secret) {
		secret = crypto.randomBytes(32).toString('hex');
		setMeta('session_secret', secret);
	}
	_key = crypto.createHash('sha256').update(`${secret}|${password()}`).digest();
	return _key;
}

const sign = (data) => crypto.createHmac('sha256', key()).update(data).digest('base64url');

/** pid = person id, or 0 when the password has been entered but no name chosen yet. */
export function makeSession(pid) {
	const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
	const body = `${pid}.${exp}`;
	return `${body}.${sign(body)}`;
}

export function readSession(token) {
	if (!token) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [pid, exp, sig] = parts;
	const expected = sign(`${pid}.${exp}`);
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
	if (!Number.isInteger(+exp) || +exp < Date.now() / 1000) return null;
	const id = Number(pid);
	if (!Number.isInteger(id) || id < 0) return null;
	return { pid: id || null };
}

export function checkPassword(input) {
	const h = (s) => crypto.createHash('sha256').update(s).digest();
	return crypto.timingSafeEqual(h(String(input ?? '')), h(password()));
}

// ------------------------------------------------------------ rate limiting
// In-memory is fine: one container, and a restart only resets the counters.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_GLOBAL = 40; // backstop in case the client IP header is spoofed
const failures = new Map();
let global = { count: 0, resetAt: 0 };

function bucket(map, k) {
	const now = Date.now();
	let b = map.get(k);
	if (!b || b.resetAt < now) {
		b = { count: 0, resetAt: now + WINDOW_MS };
		map.set(k, b);
	}
	return b;
}

export function loginBlocked(ip) {
	const now = Date.now();
	if (global.resetAt < now) global = { count: 0, resetAt: now + WINDOW_MS };
	if (global.count >= MAX_GLOBAL) return true;
	return bucket(failures, ip).count >= MAX_PER_IP;
}

export function recordLoginFailure(ip) {
	bucket(failures, ip).count++;
	global.count++;
	if (failures.size > 1000) {
		const now = Date.now();
		for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
	}
}

export function clearLoginFailures(ip) {
	failures.delete(ip);
}

export function clientIp(event) {
	const h = event.request.headers;
	const ip =
		h.get('cf-connecting-ip') || h.get('x-forwarded-for')?.split(',')[0].trim() || safeAddress(event);
	return ip || 'unknown';
}

function safeAddress(event) {
	try {
		return event.getClientAddress();
	} catch {
		return '';
	}
}

export function setSessionCookie(event, pid) {
	event.cookies.set(COOKIE, makeSession(pid), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: COOKIE_MAX_AGE
	});
}

export function clearSessionCookie(event) {
	event.cookies.delete(COOKIE, { path: '/' });
}
