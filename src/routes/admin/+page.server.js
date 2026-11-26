import { error, fail } from '@sveltejs/kit';
import { parseTagList } from '#lib/validate.js';
import {
	createInvite,
	getPerson,
	listInvites,
	listPrimaryTags,
	setPrimaryTags,
	tagCounts,
	revokeInvite,
	listPeopleAdmin,
	passwordLoginOn,
	resetInviteToken,
	setDisabled,
	setMeta
} from '#lib/server/db.js';

function admin(locals) {
	if (!locals.person?.is_admin) error(403, 'Admins only');
	return locals.person;
}

export function load({ locals, url }) {
	admin(locals);
	return {
		origin: url.origin,
		people: listPeopleAdmin(),
		invites: listInvites().filter((i) => !i.revoked),
		primaryTags: listPrimaryTags(),
		tagsInUse: tagCounts().slice(0, 30),
		passwordLogin: passwordLoginOn(),
		meId: locals.person.id
	};
}

async function target(event) {
	const me = admin(event.locals);
	const fd = await event.request.formData();
	const person = getPerson(Number(fd.get('id')));
	return { me, person, fd };
}

export const actions = {
	// new link; the old one dies and that person is signed out everywhere
	reset: async (event) => {
		const { person } = await target(event);
		if (!person) return fail(400, { error: 'No such person.' });
		resetInviteToken(person.id, true);
	},
	pause: async (event) => {
		const { me, person } = await target(event);
		if (!person) return fail(400, { error: 'No such person.' });
		if (person.id === me.id) return fail(400, { error: "You can't pause yourself." });
		setDisabled(person.id, true);
	},
	resume: async (event) => {
		const { person } = await target(event);
		if (!person) return fail(400, { error: 'No such person.' });
		setDisabled(person.id, false);
	},
	invite: async (event) => {
		admin(event.locals);
		const fd = await event.request.formData();
		const group = fd.get('kind') === 'group';
		const max = Math.min(50, Math.max(2, parseInt((fd.get('max') ?? '15').toString(), 10) || 15));
		createInvite((fd.get('note') ?? '').toString().trim(), group ? max : 1);
	},
	primaryTags: async (event) => {
		admin(event.locals);
		const fd = await event.request.formData();
		setPrimaryTags(parseTagList((fd.get('tags') ?? '').toString()));
	},
	revokeInvite: async (event) => {
		admin(event.locals);
		const fd = await event.request.formData();
		revokeInvite(Number(fd.get('id')));
	},
	passwordLogin: async (event) => {
		admin(event.locals);
		const fd = await event.request.formData();
		setMeta('password_login', fd.get('on') === '1' ? 'on' : 'off');
	}
};
