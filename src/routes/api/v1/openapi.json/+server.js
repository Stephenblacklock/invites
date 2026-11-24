// OpenAPI description for the token API, served publicly so a gateway can import it.
const event = {
	type: 'object',
	properties: {
		id: { type: 'integer' },
		title: { type: 'string' },
		description: { type: 'string' },
		location: { type: 'string' },
		tags: { type: 'array', items: { type: 'string' } },
		start_date: { type: 'string', format: 'date' },
		end_date: { type: 'string', format: 'date', nullable: true },
		chat_link: { type: 'string', nullable: true },
		price_min: { type: 'number', nullable: true, description: 'Price per person in GBP (0 = free), or the lowest price of a range' },
		price_max: { type: 'number', nullable: true, description: 'Highest price per person in GBP, only for a range' },
		decide_by: { type: 'string', format: 'date', nullable: true, description: 'Date by which the group should decide (e.g. tickets sell out)' },
		media_link: { type: 'string', nullable: true, description: 'YouTube or Spotify link shown as a player on the event page' },
		booking: { type: 'object', nullable: true, description: 'Who is sorting tickets (read-only, set in the app)', properties: { status: { type: 'string', enum: ['booking', 'booked'] }, by: { type: 'string' }, note: { type: 'string', nullable: true } } },
		created_by: { type: 'string' },
		image: { type: 'string', nullable: true, description: 'Banner picture URL (needs the friends\' session to view)' },
		interested: { type: 'array', items: { type: 'string' }, description: 'Names of friends who are interested' },
		interested_count: { type: 'integer' },
		url: { type: 'string' }
	}
};
const input = {
	title: { type: 'string', maxLength: 80 },
	description: { type: 'string', maxLength: 1000 },
	location: { type: 'string', maxLength: 120 },
	tags: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Short lowercase labels' },
	start_date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
	end_date: { type: 'string', format: 'date', nullable: true, description: 'YYYY-MM-DD, omit for single-day events' },
	chat_link: { type: 'string', nullable: true, description: 'Optional http(s) link, e.g. a WhatsApp group invite' },
	price_min: { type: 'number', nullable: true, description: 'Price per person in GBP, e.g. 45 or 45.5 (0 = free). For a range this is the lowest price. null clears.' },
	price_max: { type: 'number', nullable: true, description: 'Top of a price range in GBP; needs price_min and must not be lower. null clears.' },
	decide_by: { type: 'string', format: 'date', nullable: true, description: 'YYYY-MM-DD, must be before the event ends. null clears it.' },
	media_link: { type: 'string', nullable: true, description: 'A YouTube video/playlist or Spotify track/album/playlist/artist link (e.g. a trailer for a film, a playlist for a gig). null clears it.' },
	image_url: { type: 'string', nullable: true, description: 'Direct https link to a JPEG, PNG, WebP or GIF (max 8 MB). The server downloads and keeps its own copy as the event banner. On update, null removes the banner.' }
};
const err = { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' }, details: { type: 'object' } } } } } };
const ok = (schema, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };

export function GET({ url }) {
	const server = (process.env.ORIGIN || url.origin).replace(/\/$/, '');
	return Response.json({
		openapi: '3.0.3',
		info: {
			title: 'Invites API',
			version: '1.0.0',
			description:
				'Private API for the Invites friends-events app. Reads upcoming events and who is interested, and creates or edits events. It cannot swipe, join, comment or delete.'
		},
		servers: [{ url: server }],
		security: [{ bearer: [] }],
		components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
		paths: {
			'/api/v1/events': {
				get: {
					operationId: 'list_events',
					summary: 'List events (soonest first)',
					parameters: [
						{ name: 'scope', in: 'query', schema: { type: 'string', enum: ['upcoming', 'past', 'all'], default: 'upcoming' } },
						{ name: 'q', in: 'query', description: 'Text to match in title, description, location or tags', schema: { type: 'string' } }
					],
					responses: {
						200: ok({ type: 'object', properties: { today: { type: 'string' }, count: { type: 'integer' }, events: { type: 'array', items: event } } }),
						401: err
					}
				},
				post: {
					operationId: 'create_event',
					summary: 'Create an event (the API user is marked interested). Rejects finished events and duplicates (same title and start date).',
					requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'start_date'], properties: input, additionalProperties: false } } } },
					responses: { 201: ok({ type: 'object', properties: { event: event } }, 'Created'), 400: err, 401: err, 409: err }
				}
			},
			'/api/v1/events/{id}': {
				get: {
					operationId: 'get_event',
					summary: 'Get one event with its date poll and comments',
					parameters: [idParam],
					responses: { 200: ok({ type: 'object', properties: { event: event } }), 404: err, 401: err }
				},
				patch: {
					operationId: 'update_event',
					summary: 'Update fields of an event the API user created. Send only the fields to change; null clears end_date or chat_link.',
					parameters: [idParam],
					requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: input, additionalProperties: false } } } },
					responses: { 200: ok({ type: 'object', properties: { event: event } }), 400: err, 401: err, 403: err, 404: err }
				}
			},
			'/api/v1/link-preview': {
				get: {
					operationId: 'preview_link',
					summary: 'Read a public https event or ticket page and suggest event fields (title, description, location, start_date, end_date, image_url). Nothing is saved. Suggestions can be wrong or incomplete, especially dates, so check them before create_event. Some ticket sites block this and return an error.',
					parameters: [{ name: 'url', in: 'query', required: true, description: 'Full https link to the event page', schema: { type: 'string' } }],
					responses: {
						200: ok({ type: 'object', properties: { source: { type: 'string' }, suggestion: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' }, price_min: { type: 'number' }, price_max: { type: 'number' }, image_url: { type: 'string' } } }, note: { type: 'string' } } }),
						400: err, 401: err, 422: err, 429: err
					}
				}
			},
			'/api/v1/plans': {
				get: {
					operationId: 'my_plans',
					summary: 'Events the API user is interested in',
					responses: { 200: ok({ type: 'object', properties: { person: { type: 'string' }, count: { type: 'integer' }, events: { type: 'array', items: event } } }), 401: err }
				}
			}
		}
	});
}
