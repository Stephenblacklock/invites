<script>
	let { data, form } = $props();
</script>

<svelte:head><title>Invites · Join</title></svelte:head>

<main class="center-page">
	<div class="brand-mark" aria-hidden="true">
		<img src="/icon.svg" alt="" width="72" height="72" />
	</div>
	<h1>Invites</h1>
	{#if data.mode === 'new'}
		<p class="muted">You're invited. Swipe on events and see who else is keen.</p>
		<form method="POST" class="stack-form">
			<label>
				<span>Your name</span>
				<input name="name" maxlength="30" autocomplete="given-name" value={form?.name ?? ''} required />
			</label>
			{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
			<button class="btn primary">Join</button>
		</form>
	{:else if data.mode === 'back'}
		<p class="muted">Swipe on events. See who else is keen.</p>
		<form method="POST" class="stack-form">
			<button class="btn primary">Continue as {data.name}</button>
		</form>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<p class="hint">Not {data.name}? Don't tap this, it's their personal link.</p>
	{:else}
		<p class="error" role="alert">This link isn't valid any more. Ask Stephen for a new one.</p>
		<p><a class="btn" href="/login">Sign in with the password</a></p>
	{/if}
</main>
