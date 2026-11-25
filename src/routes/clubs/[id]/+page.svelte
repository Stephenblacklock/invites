<script>
	import { enhance } from '$app/forms';
	import Avatars from '#lib/components/Avatars.svelte';
	import EventRow from '#lib/components/EventRow.svelte';
	let { data, form } = $props();
	const club = $derived(data.club);
	let editing = $state(false);
</script>

<svelte:head><title>Invites · {club.name}</title></svelte:head>

<a class="back" href="/clubs">← Clubs</a>
<h1>{club.name}</h1>
{#if club.description}<p class="muted">{club.description}</p>{/if}
{#if club.creator_name}<p class="hint">Started by {club.creator_name}</p>{/if}

<form method="POST" action={club.joined ? '?/leave' : '?/join'} use:enhance>
	<button class="btn {club.joined ? 'ghost' : 'primary'}">{club.joined ? 'Leave this club' : 'Join this club'}</button>
</form>

<section class="panel">
	<h2>Members <span class="count-pill">{club.members.length}</span></h2>
	<ul class="member-list">
		{#each club.members as p (p.id)}
			<li><Avatars people={[p]} max={1} label={false} /> {p.name}</li>
		{/each}
	</ul>
</section>

<h2 class="section-title">Upcoming events</h2>
{#if data.events.length}
	<div class="list">
		{#each data.events as e (e.id)}<EventRow event={e} today={data.today} />{/each}
	</div>
{:else}
	<p class="muted">Nothing coming up. Pick this club when you <a href="/events/new">add an event</a>.</p>
{/if}

{#if data.mine}
	<section class="panel">
		<h2>Manage</h2>
		{#if editing}
			<form method="POST" action="?/save" use:enhance={() => async ({ update }) => { await update(); if (!form?.error) editing = false; }} class="stack-form">
				<label><span>Name</span><input name="name" maxlength="30" value={form?.name ?? club.name} required /></label>
				<label><span>What's it about?</span><input name="description" maxlength="200" value={form?.description ?? club.description} /></label>
				{#if form?.error}<p class="error">{form.error}</p>{/if}
				<button class="btn primary">Save</button>
			</form>
		{:else}
			<p class="row-btns"><button type="button" class="btn" onclick={() => (editing = true)}>Edit name and description</button></p>
		{/if}
		<form method="POST" action="?/delete" use:enhance>
			<button class="btn ghost">Delete club</button>
		</form>
		<p class="hint">Deleting a club keeps its events; they just no longer belong to a club.</p>
	</section>
{/if}
