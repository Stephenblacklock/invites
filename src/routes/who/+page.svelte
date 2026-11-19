<script>
	import { enhance } from '$app/forms';
	import { hue } from '#lib/format.js';
	let { data, form } = $props();
</script>

<svelte:head><title>Invites · Who are you?</title></svelte:head>

<main class="center-page">
	<h1>Who are you?</h1>
	<p class="muted">Tap your name, or add it if you're new. No account needed.</p>

	{#if data.people.length}
		<ul class="people">
			{#each data.people as p (p.id)}
				<li>
					<form method="POST" action="?/pick" use:enhance>
						<input type="hidden" name="id" value={p.id} />
						<button class="person-btn" class:current={p.id === data.currentId}>
							<span class="avatar" style:--h={hue(p.name)} aria-hidden="true">{p.name[0].toUpperCase()}</span>
							{p.name}
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	<form method="POST" action="?/create" use:enhance class="stack-form">
		<label>
			<span>{data.people.length ? 'Not in the list? Add your name' : 'Your name'}</span>
			<input name="name" maxlength="30" autocomplete="given-name" value={form?.name ?? ''} required />
		</label>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<button class="btn primary">That's me</button>
	</form>

	<form method="POST" action="/logout" class="center-link">
		<button class="linklike">Sign out</button>
	</form>
</main>
