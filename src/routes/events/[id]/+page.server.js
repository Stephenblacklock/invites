import { error, fail, redirect } from '@sveltejs/kit';
import { removeImage } from '#lib/server/images.js';
import { cleanLink, isValidDate } from '#lib/validate.js';
import { isRange } from '#lib/format.js';
import {
	addComment,
	addOption,
	claimBooking,
	deleteComment,
	deleteEvent,
	deleteOption,
	getEvent,
	getOption,
	getSwipe,
	joinBlocked,
	listPeople,
	responseCounts,
	reservationProblem,
	setReservations,
	setLock,
	listComments,
	listOptions,
	markBooked,
	releaseBooking,
	setChatLink,
	setInterest,
	setSwipe,
	toggleVote,
	todayISO
} from '#lib/server/db.js';

function load_event(params) {
	const id = Number(params.id);
	const ev = Number.isInteger(id) ? getEvent(id) : null;
	if (!ev) error(404, 'Event not found');
	return ev;
}

export function load({ params, locals }) {
	const event = load_event(params);
	const me = locals.person.id;
	return {
		event,
		mine: getSwipe(me, event.id),
		myInterest: event.interested.find((p) => p.id === me)?.interest ?? null,
		options: listOptions(event.id, me),
		comments: listComments(event.id),
		canEdit: event.created_by === me,
		people: event.created_by === me ? listPeople() : [],
		counts: event.created_by === me ? responseCounts(event.id) : null,
		blocked: joinBlocked(me, event),
		me
	};
}

/** Actions that only group members (people marked interested) may use. */
function memberOnly(params, locals) {
	const event = load_event(params);
	const isMember = getSwipe(locals.person.id, event.id) === 'interested';
	return { event, isMember };
}

export const actions = {
	join: ({ params, locals }) => {
		const event = load_event(params);
		if (joinBlocked(locals.person.id, event)) return fail(409, { where: 'join', error: 'This event is locked.' });
		setSwipe(locals.person.id, event.id, 'interested');
	},
	lock: async ({ params, locals, request }) => {
		const event = load_event(params);
		if (event.created_by !== locals.person.id) return fail(403, { where: 'lock', error: 'Only the organiser can do that.' });
		const fd = await request.formData();
		setLock(event.id, true, (fd.get('note') ?? '').toString().trim());
	},
	reserve: async ({ params, locals, request }) => {
		const event = load_event(params);
		if (event.created_by !== locals.person.id) return fail(403, { where: 'reserve', error: 'Only the organiser can do that.' });
		const fd = await request.formData();
		const pids = fd.getAll('rv_person'), notes = fd.getAll('rv_note');
		const rows = [];
		for (let i = 0; i < pids.length; i++) {
			const pid = Number(pids[i]) || null;
			const note = (notes[i] ?? '').toString().trim();
			if (pid || note) rows.push({ person_id: pid, note });
		}
		const going = event.interested.filter((p) => !p.waiting).map((p) => p.id);
		const problem = reservationProblem(event.capacity, going, rows);
		if (problem) return fail(400, { where: 'reserve', error: problem });
		setReservations(event.id, rows);
	},
	unlock: ({ params, locals }) => {
		const event = load_event(params);
		if (event.created_by !== locals.person.id) return fail(403, { where: 'lock', error: 'Only the organiser can do that.' });
		setLock(event.id, false);
	},
	interest: async ({ params, locals, request }) => {
		const { event, isMember } = memberOnly(params, locals);
		if (!isMember) return fail(403, { where: 'interest', error: 'Say you are interested first.' });
		const level = Number((await request.formData()).get('level'));
		if (!Number.isInteger(level) || level < 1 || level > 3) return fail(400, { where: 'interest', error: 'Pick 1, 2 or 3.' });
		setInterest(locals.person.id, event.id, level);
	},
	leave: ({ params, locals }) => {
		const event = load_event(params);
		setSwipe(locals.person.id, event.id, 'not_interested');
	},
	addOption: async ({ params, locals, request }) => {
		const { event, isMember } = memberOnly(params, locals);
		if (!isMember) return fail(403, { where: 'poll', error: 'Say you are interested first.' });
		const fd = await request.formData();
		const date = (fd.get('date') ?? '').toString();
		if (!isRange(event)) return fail(400, { where: 'poll', error: 'This event is on a single day.' });
		if (!isValidDate(date) || date < event.start_date || date > event.end_date)
			return fail(400, { where: 'poll', error: 'Pick a date within the event dates.' });
		addOption(event.id, date, locals.person.id);
	},
	vote: async ({ params, locals, request }) => {
		const { event, isMember } = memberOnly(params, locals);
		if (!isMember) return fail(403, { where: 'poll', error: 'Say you are interested first.' });
		const fd = await request.formData();
		const opt = getOption(Number(fd.get('option')));
		if (!opt || opt.event_id !== event.id) return fail(400, { where: 'poll', error: 'Unknown date.' });
		toggleVote(opt.id, locals.person.id);
	},
	removeOption: async ({ params, locals, request }) => {
		const event = load_event(params);
		if (event.created_by !== locals.person.id) return fail(403, { where: 'poll', error: 'Only the creator can remove dates.' });
		const fd = await request.formData();
		const opt = getOption(Number(fd.get('option')));
		if (opt && opt.event_id === event.id) deleteOption(opt.id);
	},
	link: async ({ params, locals, request }) => {
		const { event, isMember } = memberOnly(params, locals);
		if (!isMember && event.created_by !== locals.person.id)
			return fail(403, { where: 'link', error: 'Say you are interested first.' });
		const fd = await request.formData();
		const link = cleanLink(fd.get('chat_link'));
		if (!link.ok) return fail(400, { where: 'link', error: 'Enter a full http(s) link.' });
		setChatLink(event.id, link.value);
	},
	comment: async ({ params, locals, request }) => {
		const { event, isMember } = memberOnly(params, locals);
		if (!isMember) return fail(403, { where: 'comment', error: 'Say you are interested to join the chat.' });
		const fd = await request.formData();
		const body = (fd.get('body') ?? '').toString().trim();
		if (!body) return fail(400, { where: 'comment', error: 'Write something first.' });
		if (body.length > 500) return fail(400, { where: 'comment', error: 'Keep it under 500 characters.', body });
		addComment(event.id, locals.person.id, body);
	},
	deleteComment: async ({ params, locals, request }) => {
		load_event(params);
		const fd = await request.formData();
		deleteComment(Number(fd.get('id')), locals.person.id);
	},
	claimBooking: ({ params, locals }) => {
		const { event, isMember } = memberOnly(params, locals);
		if (!isMember) return fail(403, { where: 'booking', error: 'Say you are interested first.' });
		if ((event.end_date || event.start_date) < todayISO()) return fail(400, { where: 'booking', error: 'This event has finished.' });
		if (!claimBooking(event.id, locals.person.id)) {
			const now = getEvent(event.id);
			return fail(409, { where: 'booking', error: `${now?.booker_name ?? 'Someone'} is already sorting tickets.` });
		}
	},
	markBooked: async ({ params, locals, request }) => {
		const event = load_event(params);
		const fd = await request.formData();
		const note = (fd.get('note') ?? '').toString().trim();
		if (note.length > 120) return fail(400, { where: 'booking', error: 'Keep the note under 120 characters.' });
		if (!markBooked(event.id, locals.person.id, note)) return fail(403, { where: 'booking', error: "You're not the one booking this." });
	},
	releaseBooking: ({ params, locals }) => {
		const event = load_event(params);
		if (event.booker_id !== locals.person.id && event.created_by !== locals.person.id)
			return fail(403, { where: 'booking', error: 'Only the person booking, or the event creator, can clear this.' });
		releaseBooking(event.id);
	},
	delete: ({ params, locals }) => {
		const event = load_event(params);
		if (event.created_by !== locals.person.id) return fail(403, { where: 'delete', error: 'Only the creator can delete this.' });
		deleteEvent(event.id);
		removeImage(event.image);
		redirect(303, '/plans');
	}
};
