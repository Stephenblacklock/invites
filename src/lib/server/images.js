// Event banner images: stored as random-named files next to the database, served by /img/[name].
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';

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

// ------------------------------------------------------------ remote fetch (SSRF-guarded)

function privateV4(a, b) {
	return (
		a === 0 || a === 10 || a === 127 || a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && (b === 168 || b === 0)) ||
		(a === 198 && (b === 18 || b === 19))
	);
}

/** True for anything that is not a plain public internet address. Exported for tests. */
export function isPrivateIp(ip) {
	if (net.isIPv4(ip)) {
		const [a, b] = ip.split('.').map(Number);
		return privateV4(a, b);
	}
	if (net.isIPv6(ip)) {
		const lower = ip.toLowerCase();
		const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
		if (mapped) return isPrivateIp(mapped[1]);
		const first = parseInt(lower.split(':')[0] || '0', 16);
		// only global unicast 2000::/3, minus teredo, documentation and 6to4 ranges
		if (!(first >= 0x2000 && first <= 0x3fff)) return true;
		if (lower.startsWith('2001:0:') || lower.startsWith('2001:db8') || lower.startsWith('2001:0db8') || lower.startsWith('2002:')) return true;
		return false;
	}
	return true;
}

async function vetUrl(raw) {
	let u;
	try {
		u = new URL(raw);
	} catch {
		return { error: 'That image link is not a valid URL' };
	}
	if (u.protocol !== 'https:') return { error: 'Image links must start with https://' };
	if (u.username || u.password) return { error: 'That image link is not allowed' };
	if (u.port && u.port !== '443') return { error: 'That image link is not allowed' };
	let addrs;
	try {
		addrs = net.isIP(u.hostname) ? [{ address: u.hostname.replace(/^\[|\]$/g, '') }] : await dns.lookup(u.hostname, { all: true });
	} catch {
		return { error: "Couldn't reach that image link" };
	}
	if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return { error: 'That image link is not allowed' };
	const a = addrs[0];
	return { url: u, address: a.address, family: net.isIPv6(a.address) ? 6 : 4 };
}

function getOnce(url, address, family) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			url,
			{
				method: 'GET',
				timeout: 8000,
				headers: { 'user-agent': 'Invites/1.0 (+image fetch)', accept: 'image/*' },
				// connect to the address we already vetted, so DNS can't change between check and use
				lookup: (_host, opts, cb) =>
					opts && opts.all ? cb(null, [{ address, family }]) : cb(null, address, family)
			},
			(res) => {
				const status = res.statusCode ?? 0;
				if (status >= 300 && status < 400 && res.headers.location) {
					res.resume();
					return resolve({ redirect: new URL(res.headers.location, url).toString() });
				}
				if (status !== 200) {
					res.resume();
					return resolve({ error: `The image link answered with an error (${status})` });
				}
				const declared = Number(res.headers['content-length'] ?? 0);
				if (declared > MAX_BYTES) {
					res.destroy();
					return resolve({ error: `Image is too big (max ${MAX_BYTES / 1024 / 1024} MB)` });
				}
				const chunks = [];
				let size = 0;
				res.on('data', (c) => {
					size += c.length;
					if (size > MAX_BYTES) {
						res.destroy();
						resolve({ error: `Image is too big (max ${MAX_BYTES / 1024 / 1024} MB)` });
					} else chunks.push(c);
				});
				res.on('end', () => resolve({ buf: Buffer.concat(chunks) }));
				res.on('error', reject);
			}
		);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', reject);
		req.end();
	});
}

/** Download an image from a public https link and store our own copy. @returns {Promise<{name:string}|{error:string}>} */
export async function fetchRemote(raw) {
	let current = String(raw).trim();
	for (let hop = 0; hop < 4; hop++) {
		const v = await vetUrl(current);
		if (v.error) return v;
		let r;
		try {
			r = await getOnce(v.url, v.address, v.family);
		} catch {
			return { error: "Couldn't download that image link" };
		}
		if (r.redirect) {
			current = r.redirect;
			continue;
		}
		if (r.error) return r;
		const saved = saveBuffer(r.buf);
		return saved.error
			? { error: saved.error === 'Use a JPEG, PNG, WebP or GIF image' ? "That link isn't a direct image or GIF (try the image address ending in .jpg, .png, .gif or .webp)" : saved.error }
			: saved;
	}
	return { error: 'That image link redirects too many times' };
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
