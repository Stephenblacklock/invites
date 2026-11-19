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
		created_by: { type: 'string' },
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
	chat_link: { type: 'string', nullable: true, description: 'Optional http(s) link, e.g. a WhatsApp group invite' }
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
