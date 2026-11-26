// OpenAPI description for the token API, served publicly so a gateway can import it.
const priceRow = {
	type: 'object',
	properties: {
		label: { type: 'string', maxLength: 40, description: 'What the price is for, e.g. a venue or ticket type' },
		amount: { type: 'number', description: 'Price per person in GBP (0 = free)' },
		estimate: { type: 'boolean', description: 'True when the price is only an estimate' }
	},
	required: ['amount']
};
const event = {
	type: 'object',
	properties: {
		id: { type: 'integer' },
		title: { type: 'string' },
		description: { type: 'string' },
		location: { type: 'string' },
		tags: { type: 'array', items: { type: 'string' } },
		start_date: { type: 'string', format: 'date', nullable: true, description: 'null for an anytime event' },
		end_date: { type: 'string', format: 'date', nullable: true },
		chat_link: { type: 'string', nullable: true },
		price_min: { type: 'number', nullable: true, description: 'Price per person in GBP (0 = free), or the lowest price of a range' },
		price_max: { type: 'number', nullable: true, description: 'Highest price per person in GBP, only for a range' },
		price_estimate: { type: 'boolean', description: 'True when any of the prices is only an estimate' },
		anytime: { type: 'boolean', description: 'True when the event has no date yet (start_date is then null)' },
		min_people: { type: 'integer', nullable: true, description: 'Go-ahead number of keen people, or null' },
		locked: { type: 'boolean', description: 'Organiser has locked the event: hidden from the deck for people who have not joined; only people a spot is held for can still join' },
		lock_note: { type: 'string', nullable: true },
		held_spots: { type: 'array', items: { type: 'object', properties: { person: { type: 'string', nullable: true }, note: { type: 'string', nullable: true }, taken: { type: 'boolean' } } }, description: 'Spots the organiser is holding; person is set when held for someone on the app' },
		price_tbd: { type: 'boolean', description: 'True when the price is still to be confirmed (there are no price rows then)' },
		date_tbd: { type: 'boolean', description: 'True when the date is still to be confirmed; start_date is then only a rough placeholder' },
		prices: { type: 'array', items: priceRow, description: 'Price rows, e.g. one per venue or ticket type. price_min / price_max summarise them.' },
		decide_by: { type: 'string', format: 'date', nullable: true, description: 'Date by which the group should decide (e.g. tickets sell out)' },
		capacity: { type: 'integer', nullable: true, description: 'Maximum number of people (spots), or null for no limit' },
		media_link: { type: 'string', nullable: true, description: 'YouTube or Spotify link shown as a player on the event page' },
		club: { type: 'string', nullable: true, description: 'Name of the club this event belongs to, if any' },
		booking: { type: 'object', nullable: true, description: 'Who is sorting tickets (read-only, set in the app)', properties: { status: { type: 'string', enum: ['booking', 'booked'] }, by: { type: 'string' }, note: { type: 'string', nullable: true } } },
		created_by: { type: 'string' },
		image: { type: 'string', nullable: true, description: 'Banner picture URL (needs the friends\' session to view)' },
		interested: { type: 'array', items: { type: 'string' }, description: 'Names of friends who are interested and have a spot (the first people to say so, up to capacity)' },
		interested_count: { type: 'integer' },
		waiting_list: { type: 'array', items: { type: 'string' }, description: 'Names waiting for a spot, in order (only when capacity is set and full)' },
		url: { type: 'string' }
	}
};
const input = {
	title: { type: 'string', maxLength: 80 },
	description: { type: 'string', maxLength: 1000 },
	location: { type: 'string', maxLength: 120 },
	tags: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Short lowercase labels' },
	start_date: { type: 'string', format: 'date', description: 'YYYY-MM-DD. Required unless anytime is true.' },
	anytime: { type: 'boolean', description: 'No date yet (e.g. a museum visit): the event stays open until the creator sets a date. start_date and end_date are ignored while true; set anytime false with a start_date to give it a date.' },
	locked: { type: 'boolean', description: 'Update only. true locks the event (hidden from the deck for people who have not joined), false unlocks.' },
	lock_note: { type: 'string', nullable: true, maxLength: 80, description: 'Update only. Short reason shown while locked.' },
	reserved: { type: 'array', maxItems: 20, items: { type: 'object', properties: { person: { type: 'string', description: 'Name of someone on the app to hold the spot for; omit for a generic hold' }, note: { type: 'string', maxLength: 40 } } }, description: 'Update only; needs capacity set. Replaces all held spots; [] clears. Cannot bump people already going.' },
	min_people: { type: 'integer', nullable: true, minimum: 1, maximum: 500, description: 'Go-ahead number: the card shows "N of M keen" and "Enough keen" once reached. null clears.' },
	end_date: { type: 'string', format: 'date', nullable: true, description: 'YYYY-MM-DD, omit for single-day events' },
	chat_link: { type: 'string', nullable: true, description: 'Optional http(s) link, e.g. a WhatsApp group invite' },
	prices: { type: 'array', nullable: true, maxItems: 8, items: priceRow, description: 'Price rows (venue or ticket type, amount in GBP, estimate flag). The cards show their range. Replaces all existing rows; null clears them. Preferred over price_min / price_max.' },
	price_min: { type: 'number', nullable: true, description: 'Shortcut for a single price per person in GBP, e.g. 45 or 45.5 (0 = free). With price_max it makes a range. Ignored if prices is sent. null clears.' },
	price_max: { type: 'number', nullable: true, description: 'Top of a price range in GBP; needs price_min and must not be lower. null clears.' },
	capacity: { type: 'integer', nullable: true, minimum: 1, maximum: 500, description: 'Spots: how many people can go (e.g. 3 tickets). Others can still say they are keen and wait in order. null clears.' },
	decide_by: { type: 'string', format: 'date', nullable: true, description: 'YYYY-MM-DD, must be before the event ends. null clears it.' },
	price_tbd: { type: 'boolean', description: 'Price still to be confirmed. true clears any price rows; false (or sending prices) turns it off.' },
	date_tbd: { type: 'boolean', description: 'Date still to be confirmed. start_date is still required as a rough placeholder (e.g. the middle of the likely month); the app shows it as TBC and keeps it out of calendar feeds.' },
	club: { type: 'string', nullable: true, description: 'Name of an existing club to put the event in (see list_clubs), e.g. "Movie club". null removes it from its club.' },
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
					requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: input, additionalProperties: false } } } },
					responses: { 201: ok({ type: 'object', properties: { event: event } }, 'Created'), 400: err, 401: err, 409: err }
				}
			},
			'/api/v1/tags': {
				get: {
					operationId: 'list_tags',
					summary: 'The main tags (shown as filter chips) and every other tag in use with its count. Reuse these on events instead of inventing near-duplicates.',
					responses: {
						200: ok({ type: 'object', properties: { primary: { type: 'array', items: { type: 'string' } }, other: { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, count: { type: 'integer' } } } } } }),
						401: err
					}
				}
			},
			'/api/v1/clubs': {
				get: {
					operationId: 'list_clubs',
					summary: 'List clubs with their members. Events can be put in a club by name.',
					responses: {
						200: ok({ type: 'object', properties: { count: { type: 'integer' }, clubs: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, members: { type: 'array', items: { type: 'string' } }, upcoming_events: { type: 'integer' } } } } } }),
						401: err
					}
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
