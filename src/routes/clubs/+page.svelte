<script>
	import { enhance } from '$app/forms';
	import Avatars from '#lib/components/Avatars.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Invites · Clubs</title></svelte:head>

<h1>Clubs</h1>
<p class="muted">
	A club is a group for one kind of thing, like a movie club or a gig club. Anyone can join, and every event is still open to everyone.
</p>

{#if data.clubs.length}
	<div class="list">
		{#each data.clubs as c (c.id)}
			<section class="panel club-card">
				<h2><a href="/clubs/{c.id}">{c.name}</a></h2>
				{#if c.description}<p class="muted">{c.description}</p>{/if}
				<p class="meta">
					<Avatars people={c.members} max={5} label={false} />
					{c.members.length} {c.members.length === 1 ? 'member' : 'members'} · {c.upcoming}
					upcoming
				</p>
				<form method="POST" action={c.joined ? '?/leave' : '?/join'} use:enhance>
					<input type="hidden" name="club" value={c.id} />
					<button class="btn {c.joined ? 'ghost' : 'primary'}">{c.joined ? 'Leave' : 'Join'}</button>
				</form>
			</section>
		{/each}
	</div>
{:else}
	<section class="empty"><p class="muted">No clubs yet. Start the first one below.</p></section>
{/if}

<section class="panel">
	<h2>Start a club</h2>
	<form method="POST" action="?/create" use:enhance class="stack-form">
		<label>
			<span>Name</span>
			<input name="name" maxlength="30" value={form?.where === 'create' ? form.name : ''} placeholder="Movie club" required />
		</label>
		<label>
			<span>What's it about? <em>(optional)</em></span>
			<input name="description" maxlength="200" value={form?.where === 'create' ? form.description : ''} placeholder="New releases and the odd classic" />
		</label>
		{#if form?.where === 'create' && form.error}<p class="error">{form.error}</p>{/if}
		<button class="btn primary">Create club</button>
	</form>
</section>
