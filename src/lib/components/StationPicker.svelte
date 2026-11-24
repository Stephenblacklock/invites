<script>
	import { enhance } from '$app/forms';
	let { kind, label, current = null } = $props();
	let q = $state('');
	let results = $state([]);
	let busy = $state(false);
	let message = $state('');
	let timer;
	let formEl;
	let idEl;
	let nameEl;

	function onInput() {
		clearTimeout(timer);
		message = '';
		if (q.trim().length < 2) {
			results = [];
			return;
		}
		timer = setTimeout(search, 350);
	}

	async function search() {
		busy = true;
		try {
			const res = await fetch('/stations/search?q=' + encodeURIComponent(q.trim()));
			const data = await res.json();
			results = data.stations ?? [];
			message = res.ok ? (results.length ? '' : 'No stations found.') : (data.error ?? "Couldn't search.");
		} catch {
			message = "Couldn't search.";
		} finally {
			busy = false;
		}
	}

	function pick(s) {
		idEl.value = s.id;
		nameEl.value = s.name;
		formEl.requestSubmit();
		q = '';
		results = [];
	}
</script>

<fieldset class="station-picker">
	<legend>{label}</legend>
	{#if current}
		<p><strong>{current.name}</strong></p>
		<form method="POST" action="?/clear" use:enhance>
			<input type="hidden" name="kind" value={kind} />
			<button class="btn ghost">Remove</button>
		</form>
	{:else}
		<p class="muted">Not set.</p>
	{/if}

	<label>
		<span>{current ? 'Change it' : 'Find your station'}</span>
		<input type="search" bind:value={q} oninput={onInput} placeholder="Start typing, e.g. Bow Road" autocomplete="off" />
	</label>
	{#if busy}<p class="hint">Searching…</p>{/if}
	{#if message}<p class="hint">{message}</p>{/if}
	{#if results.length}
		<ul class="station-results">
			{#each results as s (s.id)}
				<li><button type="button" class="btn" onclick={() => pick(s)}>{s.name}</button></li>
			{/each}
		</ul>
	{/if}

	<form bind:this={formEl} method="POST" action="?/save" use:enhance hidden>
		<input type="hidden" name="kind" value={kind} />
		<input bind:this={idEl} type="hidden" name="id" />
		<input bind:this={nameEl} type="hidden" name="name" />
	</form>
</fieldset>
