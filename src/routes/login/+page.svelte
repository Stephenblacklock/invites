<script>
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Invites · Sign in</title></svelte:head>

<main class="center-page">
	<div class="brand-mark" aria-hidden="true">
		<img src="/icon.svg" alt="" width="72" height="72" />
	</div>
	<h1>Invites</h1>
	<p class="muted">Swipe on events. See who else is keen.</p>

	{#if data.passwordLogin}
	<form
		method="POST"
		class="stack-form"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update();
				busy = false;
			};
		}}
	>
		<label>
			<span>Password</span>
			<input type="password" name="password" autocomplete="current-password" required />
		</label>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<button class="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Come in'}</button>
	</form>
	{:else}
		<p class="muted">Sign in with the personal link you were sent. Ask Stephen if you've lost it.</p>
	{/if}
</main>
