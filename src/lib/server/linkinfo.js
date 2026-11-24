// Link preview: read a public event page and pull out title, description, venue, dates and picture.
// Looks at schema.org Event JSON-LD first (ticket sites publish it), then Open Graph / meta tags.
import { safeGet } from './safefetch.js';

const MAX_PAGE = 1.5 * 1024 * 1024;

const ENT = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€',
	ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”'
};

function decode(s) {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
		if (e[0] === '#') {
			const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			try {
				return String.fromCodePoint(n);
			} catch {
				return '';
			}
		}
		return ENT[e.toLowerCase()] ?? m;
	});
}

const stripTags = (s) => s.replace(/<[^>]*>/g, ' ');
const clean = (s, max) =>
	stripTags(decode(stripTags(String(s ?? '')))).replace(/\s+/g, ' ').trim().slice(0, max);

function decodeBody(buf, type) {
	let cs = /charset=([\w-]+)/i.exec(type)?.[1];
	if (!cs) cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'))?.[1];
	try {
		return new TextDecoder(cs || 'utf-8').decode(buf);
	} catch {
		return buf.toString('utf8');
	}
}

function readMetas(html) {
	const out = {};
	for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
		const tag = m[0];
		const attr = (n) => {
			const r = new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
			return r ? (r[2] ?? r[3] ?? r[4]) : undefined;
		};
		const key = (attr('property') || attr('name') || '').toLowerCase();
		const content = attr('content');
		if (key && content !== undefined && !(key in out)) out[key] = decode(content);
	}
	return out;
}

function collectEvents(node, out, depth = 0) {
	if (!node || typeof node !== 'object' || depth > 6) return;
	if (Array.isArray(node)) return node.forEach((n) => collectEvents(n, out, depth + 1));
	const types = [].concat(node['@type'] ?? []);
	if (types.some((t) => typeof t === 'string' && /Event$/.test(t))) out.push(node);
	if (node['@graph']) collectEvents(node['@graph'], out, depth + 1);
	if (node.itemListElement) collectEvents(node.itemListElement, out, depth + 1);
	if (node.item) collectEvents(node.item, out, depth + 1);
}

function readEvents(html) {
	const found = [];
	for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
		try {
			collectEvents(JSON.parse(m[1].trim()), found);
		} catch {
			/* ignore malformed blocks */
		}
	}
	return found;
}

/** ISO date/time string → YYYY-MM-DD in the app's timezone (a bare date or local time keeps its own date). */
function toDay(v) {
	if (typeof v !== 'string') return null;
	const s = v.trim();
	if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && s.length > 10) {
		const d = new Date(s);
		return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA');
	}
	return /^(\d{4}-\d{2}-\d{2})/.exec(s)?.[1] ?? null;
}

function firstString(v) {
	if (typeof v === 'string') return v;
	if (Array.isArray(v)) return v.map(firstString).find(Boolean) ?? null;
	if (v && typeof v === 'object') return firstString(v.url ?? v.contentUrl);
	return null;
}

function placeText(loc) {
	const l = Array.isArray(loc) ? loc[0] : loc;
	if (!l) return '';
	if (typeof l === 'string') return l;
	const a = l.address;
	const where = typeof a === 'string' ? a : (a?.addressLocality ?? a?.streetAddress ?? '');
	return [l.name, where].filter(Boolean).join(', ');
}

/**
 * Pure extraction from page HTML. @returns {{title?:string, description?:string, location?:string, start_date?:string, end_date?:string, image_url?:string}}
 */
export function extractInfo(html, baseUrl) {
	const meta = readMetas(html);
	const pageTitle = clean(meta['og:title'] || meta['twitter:title'] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '', 200);
	const shortTitle = pageTitle.split(' | ')[0].trim();

	const events = readEvents(html);
	const lower = pageTitle.toLowerCase();
	const ev =
		events.find((e) => typeof e.name === 'string' && e.name.length > 2 && lower.includes(clean(e.name, 200).toLowerCase())) ??
		(events.length === 1 ? events[0] : null);

	const out = {};
	const title = clean(ev?.name, 80) || shortTitle.slice(0, 80);
	if (title) out.title = title;
	const description = clean(ev?.description, 1000) || clean(meta['og:description'] || meta.description || meta['twitter:description'], 1000);
	if (description) out.description = description;
	const location = clean(placeText(ev?.location), 120);
	if (location) out.location = location;
	const start = toDay(ev?.startDate);
	if (start) {
		out.start_date = start;
		const end = toDay(ev?.endDate);
		if (end && end > start) out.end_date = end;
	}
	const rawImage = firstString(ev?.image) || meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'];
	if (rawImage) {
		try {
			const u = new URL(decode(rawImage), baseUrl);
			if (u.protocol === 'http:') u.protocol = 'https:';
			if (u.protocol === 'https:') out.image_url = u.toString();
		} catch {
			/* skip unusable image */
		}
	}
	return out;
}

/** Fetch a public page and extract event details. @returns {Promise<{info:object, source:string}|{error:string}>} */
export async function previewLink(raw) {
	const r = await safeGet(raw, {
		noun: 'link',
		accept: 'text/html,application/xhtml+xml',
		userAgent: 'Mozilla/5.0 (compatible; InvitesBot/1.0; +https://invites.blacklocks.uk)',
		maxBytes: MAX_PAGE,
		truncate: true,
		tooBig: 'That page is too big to read',
		typeRe: /text\/html|application\/xhtml/i,
		typeError: "That link isn't a web page"
	});
	if (r.error) {
		return /\((401|403|429|503)\)/.test(r.error)
			? { error: "That site wouldn't let us read the page. Fill it in by hand instead." }
			: r;
	}
	const info = extractInfo(decodeBody(r.buf, r.type), r.url);
	if (!info.title) return { error: "Couldn't find any event details on that page." };
	return { info, source: new URL(r.url).hostname.replace(/^www\./, '') };
}

// Small per-person limit so a signed-in friend (or the API token) can't turn this into a page-fetching proxy.
const hits = new Map();
export function previewAllowed(key) {
	const now = Date.now();
	const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
	if (recent.length >= 12) return false;
	recent.push(now);
	hits.set(key, recent);
	return true;
}
