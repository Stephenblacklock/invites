// SSRF-guarded HTTPS GET shared by image downloads and link previews.
// The hostname is resolved once, every address must be public, and the connection is made to that vetted address.
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

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

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function vetUrl(raw, noun) {
	let u;
	try {
		u = new URL(raw);
	} catch {
		return { error: `That ${noun} is not a valid URL` };
	}
	if (u.protocol !== 'https:') return { error: `${cap(noun)}s must start with https://` };
	if (u.username || u.password) return { error: `That ${noun} is not allowed` };
	if (u.port && u.port !== '443') return { error: `That ${noun} is not allowed` };
	let addrs;
	try {
		addrs = net.isIP(u.hostname) ? [{ address: u.hostname.replace(/^\[|\]$/g, '') }] : await dns.lookup(u.hostname, { all: true });
	} catch {
		return { error: `Couldn't reach that ${noun}` };
	}
	if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return { error: `That ${noun} is not allowed` };
	const a = addrs[0];
	return { url: u, address: a.address, family: net.isIPv6(a.address) ? 6 : 4 };
}

function getOnce(url, address, family, o) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			url,
			{
				method: 'GET',
				timeout: 8000,
				headers: { 'user-agent': o.userAgent, accept: o.accept, 'accept-language': 'en-GB,en;q=0.8' },
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
					return resolve({ error: `The ${o.noun} answered with an error (${status})` });
				}
				const type = String(res.headers['content-type'] ?? '');
				if (o.typeRe && !o.typeRe.test(type)) {
					res.resume();
					return resolve({ error: o.typeError });
				}
				const declared = Number(res.headers['content-length'] ?? 0);
				if (declared > o.maxBytes && !o.truncate) {
					res.destroy();
					return resolve({ error: o.tooBig });
				}
				const chunks = [];
				let size = 0;
				res.on('data', (c) => {
					size += c.length;
					if (size > o.maxBytes) {
						res.destroy();
						if (o.truncate) resolve({ buf: Buffer.concat(chunks), type });
						else resolve({ error: o.tooBig });
					} else chunks.push(c);
				});
				res.on('end', () => resolve({ buf: Buffer.concat(chunks), type }));
				res.on('error', reject);
			}
		);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', reject);
		req.end();
	});
}

/**
 * Fetch a public https URL (following up to 4 redirects, re-vetting each hop).
 * @param {string} raw
 * @param {{noun:string, accept:string, userAgent:string, maxBytes:number, tooBig:string, typeRe?:RegExp, typeError?:string, truncate?:boolean}} o
 * @returns {Promise<{buf:Buffer,type:string,url:string}|{error:string}>}
 */
export async function safeGet(raw, o) {
	let current = String(raw).trim();
	for (let hop = 0; hop < 4; hop++) {
		const v = await vetUrl(current, o.noun);
		if (v.error) return v;
		let r;
		try {
			r = await getOnce(v.url, v.address, v.family, o);
		} catch {
			return { error: `Couldn't download that ${o.noun}` };
		}
		if (r.redirect) {
			current = r.redirect;
			continue;
		}
		if (r.error) return r;
		return { buf: r.buf, type: r.type, url: v.url.toString() };
	}
	return { error: `That ${o.noun} redirects too many times` };
}
