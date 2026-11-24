// Event banner images: stored as random-named files next to the database, served by /img/[name].
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeGet } from './safefetch.js';

export const MAX_BYTES = 8 * 1024 * 1024;
const NAME_RE = /^[a-f0-9]{32}\.(jpg|png|gif|webp)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

export function imagesDir() {
	const file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'invites.db');
	return path.join(path.dirname(file), 'images');
}

/** Identify the real file type from its first bytes; never trust the extension or Content-Type. */
export function sniff(buf) {
	if (buf.length < 12) return null;
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
	if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
	const head = buf.subarray(0, 6).toString('latin1');
	if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
	if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
	return null;
}

export const mimeFor = (name) => MIME[name.split('.').pop()] ?? 'application/octet-stream';
export const validName = (name) => typeof name === 'string' && NAME_RE.test(name);

/** @returns {{ name: string } | { error: string }} */
export function saveBuffer(buf) {
	if (!buf.length) return { error: 'That file is empty' };
	if (buf.length > MAX_BYTES) return { error: `Image is too big (max ${MAX_BYTES / 1024 / 1024} MB)` };
	const ext = sniff(buf);
	if (!ext) return { error: 'Use a JPEG, PNG, WebP or GIF image' };
	const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
	fs.mkdirSync(imagesDir(), { recursive: true });
	fs.writeFileSync(path.join(imagesDir(), name), buf, { flag: 'wx' });
	return { name };
}

export function removeImage(name) {
	if (!validName(name)) return;
	try {
		fs.unlinkSync(path.join(imagesDir(), name));
	} catch {
		/* already gone */
	}
}

export function readImage(name) {
	if (!validName(name)) return null;
	try {
		return fs.readFileSync(path.join(imagesDir(), name));
	} catch {
		return null;
	}
}

// ------------------------------------------------------------ remote fetch (SSRF-guarded, see safefetch.js)

export { isPrivateIp } from './safefetch.js';

const TOO_BIG = `Image is too big (max ${MAX_BYTES / 1024 / 1024} MB)`;

/** Download an image from a public https link and store our own copy. @returns {Promise<{name:string}|{error:string}>} */
export async function fetchRemote(raw) {
	const r = await safeGet(raw, {
		noun: 'image link',
		accept: 'image/*',
		userAgent: 'Invites/1.0 (+image fetch)',
		maxBytes: MAX_BYTES,
		tooBig: TOO_BIG
	});
	if (r.error) return r;
	const saved = saveBuffer(r.buf);
	return saved.error === 'Use a JPEG, PNG, WebP or GIF image'
		? { error: "That link isn't a direct image or GIF (try the image address ending in .jpg, .png, .gif or .webp)" }
		: saved;
}

/**
 * Apply a banner chosen on the form or via the API.
 * Pass whichever of file/url was supplied; file wins. @returns {Promise<{name:string}|{error:string}|null>}
 */
export async function resolveImage({ file, url }) {
	if (file && typeof file === 'object' && file.size > 0) {
		if (file.size > MAX_BYTES) return { error: `Image is too big (max ${MAX_BYTES / 1024 / 1024} MB)` };
		return saveBuffer(Buffer.from(await file.arrayBuffer()));
	}
	if (typeof url === 'string' && url.trim()) return fetchRemote(url);
	return null;
}
