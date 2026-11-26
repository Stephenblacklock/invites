<script>
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let copied = $state(null);
	let kind = $state('one');
	async function copyInvite(i, asMessage = false) {
		const url = `${data.origin}/join/${i.token}`;
		const limit = i.max_uses > 1 ? `works for up to ${i.max_uses} people, for 14 days` : 'works once, for 14 days';
		const text = asMessage
			? `Join our events app: swipe on gigs, films and nights out and see which friends are keen. Open this, type your name and you're in (link ${limit}): ${url}`
			: url;
		try {
			await navigator.clipboard.writeText(text);
			copied = (asMessage ? 'm' : 'i') + i.id;
			setTimeout(() => (copied = null), 2000);
		} catch {
			window.prompt('Copy this', text);
		}
	}
	async function copy(p) {
		const url = `${data.origin}/join/${p.token}`;
		try {
			await navigator.clipboard.writeText(url);
			copied = p.id;
			setTimeout(() => (copied = null), 2000);
		} catch {
			window.prompt('Copy this link', url);
		}
	}
</script>

<svelte:head><title>Invites · Admin</title></svelte:head>

<h1>Admin</h1>
<p class="muted">Each person has a personal link that keeps working until you make a new one. Send it to them once.</p>
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<section class="panel">
	<h2>Invite someone new</h2>
	<p class="muted">Make a link and send it. They open it, type their own name and they're in. Links expire after 14 days.</p>
	<form method="POST" action="?/invite" use:enhance class="stack-form">
		<div class="row-btns">
			<select name="kind" bind:value={kind} aria-label="Who is it for">
				<option value="one">One person</option>
				<option value="group">A group chat</option>
			</select>
			{#if kind === 'group'}
				<label class="inline">Up to <input name="max" type="number" min="2" max="50" value="15" style="width:4.5rem" /> people</label>
			{/if}
		</div>
		<input name="note" maxlength="40" placeholder={kind === 'group' ? 'Which chat? e.g. Darts group' : "Who's it for? (optional)"} />
		<button class="btn primary">Make invite link</button>
	</form>
	{#each data.invites as i (i.id)}
		{@const full = i.uses >= i.max_uses}
		<div class="invite-row">
			<div>
				<strong>{i.note || (i.max_uses > 1 ? 'Group invite' : 'Open invite')}</strong>
				<span class="hint">
					{i.max_uses > 1 ? ` ${i.uses} of ${i.max_uses} joined` : full ? ' joined' : ''}{i.expired ? ' (expired)' : ''}
				</span>
				{#if i.joined}<div class="hint">{i.joined}</div>{/if}
			</div>
			{#if !full && !i.expired}
				<div class="row-btns">
					<button type="button" class="btn primary" onclick={() => copyInvite(i, true)}>{copied === 'm' + i.id ? 'Copied' : 'Copy message'}</button>
					<button type="button" class="btn" onclick={() => copyInvite(i)}>{copied === 'i' + i.id ? 'Copied' : 'Copy link'}</button>
					<form method="POST" action="?/revokeInvite" use:enhance>
						<input type="hidden" name="id" value={i.id} />
						<button class="btn ghost">Revoke</button>
					</form>
				</div>
			{/if}
		</div>
	{/each}
</section>

<section class="panel">
	<h2>Main tags</h2>
	<p class="muted">These show as filter chips on the deck and as quick picks on the event form. Every other tag still works, tucked behind "More".</p>
	<form method="POST" action="?/primaryTags" use:enhance class="stack-form">
		<input name="tags" value={data.primaryTags.join(', ')} placeholder="gig, cinema, sport, food" />
		<button class="btn">Save main tags</button>
	</form>
	<p class="hint">In use: {data.tagsInUse.map((t) => `${t.tag} (${t.count})`).join(', ') || 'none yet'}</p>
</section>

<h2>People</h2>
<ul class="admin-people">
	{#each data.people as p (p.id)}
		<li class="panel">
			<div>
				<strong>{p.name}</strong>
				{#if p.is_admin}<span class="hint"> admin</span>{/if}
				{#if p.disabled}<span class="hint"> paused</span>{/if}
				<div class="hint">{p.invite_used_at ? `Joined ${p.invite_used_at.slice(0, 10)}` : 'Link not used yet'}</div>
			</div>
			<div class="row-btns">
				<button type="button" class="btn" onclick={() => copy(p)}>{copied === p.id ? 'Copied' : 'Copy link'}</button>
				<form method="POST" action="?/reset" use:enhance>
					<input type="hidden" name="id" value={p.id} />
					<button class="btn ghost" title="Old link stops working and they are signed out">New link</button>
				</form>
				{#if p.id !== data.meId}
					<form method="POST" action={p.disabled ? '?/resume' : '?/pause'} use:enhance>
						<input type="hidden" name="id" value={p.id} />
						<button class="btn ghost">{p.disabled ? 'Resume' : 'Pause'}</button>
					</form>
				{/if}
			</div>
		</li>
	{/each}
</ul>

<section class="panel">
	<h2>Shared password</h2>
	<p class="muted">
		The shared password {data.passwordLogin ? 'still works as a fallback' : 'is switched off'}. Turn it off once everyone has their link.
	</p>
	<form method="POST" action="?/passwordLogin" use:enhance>
		<input type="hidden" name="on" value={data.passwordLogin ? '0' : '1'} />
		<button class="btn">{data.passwordLogin ? 'Switch off' : 'Switch on'}</button>
	</form>
</section>

<style>
	.admin-people { list-style: none; padding: 0; display: grid; gap: 0.5rem; }
	.invite-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; padding: 0.5rem 0; }
	.admin-people li { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
</style>
