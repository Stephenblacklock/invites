import { mimeFor, readImage, validName } from '#lib/server/images.js';

export function GET({ params }) {
	if (!validName(params.name)) return new Response('Not found', { status: 404 });
	const buf = readImage(params.name);
	if (!buf) return new Response('Not found', { status: 404 });
	return new Response(buf, {
		headers: {
			'Content-Type': mimeFor(params.name),
			'Content-Length': String(buf.length),
			// filenames are random and never reused, so they can be cached for good
			'Cache-Control': 'private, max-age=31536000, immutable',
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Content-Type-Options': 'nosniff'
		}
	});
}
