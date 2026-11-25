<script>
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let copied = $state(null);
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

<h1>People</h1>
<p class="muted">Each person has a personal link that keeps working until you make a new one. Send it to them once.</p>
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

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
	.admin-people li { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
</style>
