<script>
	import { enhance } from '$app/forms';
	import { bg, countdown, fmtDate, fmtRange, hue, isRange } from '#lib/format.js';
	import Avatars from '#lib/components/Avatars.svelte';

	let { data, form } = $props();
	const ev = $derived(data.event);
	const member = $derived(data.mine === 'interested');
	const finished = $derived((ev.end_date || ev.start_date) < data.today);
	const best = $derived(Math.max(0, ...data.options.map((o) => o.voters.length)));
	const err = (where) => (form?.where === where ? form.error : null);
</script>

<svelte:head><title>Invites · {ev.title}</title></svelte:head>

<a class="back" href="/plans">← Plans</a>

<header class="event-hero" class:has-image={ev.image} style:--h={hue(ev.title)} style:background-image={bg(ev.image)}>
	<span class="pill">{countdown(ev.start_date, ev.end_date, data.today)}</span>
	<h1>{ev.title}</h1>
	<p>{fmtRange(ev.start_date, ev.end_date, data.today)}</p>
</header>

<section class="panel">
	{#if ev.location}
		<p class="meta"><span class="k">Where</span> {ev.location}</p>
	{/if}
	{#if ev.description}<p class="desc">{ev.description}</p>{/if}
	{#if ev.tags.length}
		<p class="tags">
			{#each ev.tags as t (t)}<span class="tag">{t}</span>{/each}
		</p>
	{/if}
	<p class="muted small">Added by {ev.creator_name}</p>
</section>

<section class="panel">
	<h2>Who's keen <span class="count-pill">{ev.interested.length}</span></h2>
	{#if ev.interested.length}
		<ul class="member-list">
			{#each ev.interested as p (p.id)}
				<li><Avatars people={[p]} max={1} label={false} /> {p.name}</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">Nobody yet.</p>
	{/if}

	{#if !finished}
		{#if member}
			<form method="POST" action="?/leave" use:enhance>
				<button class="btn ghost">Actually, count me out</button>
			</form>
		{:else}
			<form method="POST" action="?/join" use:enhance>
				<button class="btn primary">{data.mine === 'not_interested' ? "Changed my mind, I'm in" : "I'm interested"}</button>
			</form>
		{/if}
	{/if}
	<p class="center-link"><a href="/events/{ev.id}/calendar.ics">Add to calendar</a></p>
</section>

{#if member || ev.chat_link}
	<section class="panel">
		<h2>Group chat</h2>
		{#if ev.chat_link}
			<p>
				<a class="btn primary" href={ev.chat_link} target="_blank" rel="noopener noreferrer">Open the group chat</a>
			</p>
		{:else}
			<p class="muted">No chat link yet. Paste a WhatsApp (or other) invite link so everyone can join.</p>
		{/if}
		{#if member}
			<form method="POST" action="?/link" use:enhance class="inline-form">
				<input type="url" name="chat_link" value={ev.chat_link ?? ''} placeholder="https://chat.whatsapp.com/…" aria-label="Chat link" />
				<button class="btn">{ev.chat_link ? 'Update' : 'Save'}</button>
			</form>
			{#if err('link')}<p class="error">{err('link')}</p>{/if}
		{/if}
	</section>
{/if}

{#if isRange(ev)}
	<section class="panel">
		<h2>Pick a day</h2>
		<p class="muted small">Runs {fmtRange(ev.start_date, ev.end_date, data.today)}. Add the days that work and vote.</p>
		{#if data.options.length}
			<ul class="poll">
				{#each data.options as o (o.id)}
					<li class:leading={best > 0 && o.voters.length === best}>
						<form method="POST" action="?/vote" use:enhance>
							<input type="hidden" name="option" value={o.id} />
							<button class="vote" class:mine={o.mine} disabled={!member || finished} aria-pressed={o.mine}>
								<span class="vote-date">{fmtDate(o.date, data.today)}</span>
								<span class="vote-count">{o.voters.length}</span>
							</button>
						</form>
						<span class="muted small voters">{o.voters.join(', ') || 'No votes yet'}</span>
						{#if data.canEdit}
							<form method="POST" action="?/removeOption" use:enhance>
								<input type="hidden" name="option" value={o.id} />
								<button class="linklike danger" aria-label="Remove {fmtDate(o.date, data.today)}">Remove</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if member && !finished}
			<form method="POST" action="?/addOption" use:enhance class="inline-form">
				<input type="date" name="date" min={ev.start_date > data.today ? ev.start_date : data.today} max={ev.end_date} aria-label="Add a date" required />
				<button class="btn">Add date</button>
			</form>
		{:else if !member}
			<p class="muted small">Join the group to add dates and vote.</p>
		{/if}
		{#if err('poll')}<p class="error">{err('poll')}</p>{/if}
	</section>
{/if}

<section class="panel">
	<h2>Chat</h2>
	{#if data.comments.length}
		<ul class="comments">
			{#each data.comments as c (c.id)}
				<li>
					<strong>{c.name}</strong>
					<span>{c.body}</span>
					{#if c.person_id === data.person.id}
						<form method="POST" action="?/deleteComment" use:enhance>
							<input type="hidden" name="id" value={c.id} />
							<button class="linklike danger" aria-label="Delete your message">Delete</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No messages yet. Use this for quick logistics, or put the real chat link above.</p>
	{/if}
	{#if member}
		<form method="POST" action="?/comment" use:enhance={() => async ({ update }) => update({ reset: true })} class="inline-form">
			<input name="body" maxlength="500" placeholder="Meet at 6 by the entrance?" aria-label="Message" required />
			<button class="btn">Send</button>
		</form>
	{/if}
	{#if err('comment')}<p class="error">{err('comment')}</p>{/if}
</section>

{#if data.canEdit}
	<section class="panel owner">
		<h2>Your event</h2>
		<p>
			<a class="btn" href="/events/{ev.id}/edit">Edit details</a>
		</p>
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (!confirm('Delete this event for everyone?')) cancel();
			}}
		>
			<button class="btn danger">Delete event</button>
		</form>
		{#if err('delete')}<p class="error">{err('delete')}</p>{/if}
	</section>
{/if}
