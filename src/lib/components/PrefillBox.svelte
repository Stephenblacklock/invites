<script>
	import { onMount } from 'svelte';

	let url = $state('');
	let busy = $state(false);
	let message = $state('');
	let failed = $state(false);

	const NAMES = ['title', 'description', 'location', 'start_date', 'end_date', 'image_url'];

	function setField(name, value) {
		const el = document.querySelector(`.card-form [name="${name}"]`);
		if (!el || value === undefined) return false;
		el.value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		return true;
	}

	async function fill() {
		message = '';
		failed = false;
		if (!url.trim()) return;
		busy = true;
		try {
			const res = await fetch('/events/prefill', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: url.trim() })
			});
			const data = await res.json();
			if (!res.ok) {
				failed = true;
				message = data.error ?? "Couldn't read that link.";
				return;
			}
			const got = NAMES.filter((n) => setField(n, data.info[n]));
			const missing = ['start_date', 'location'].filter((n) => !got.includes(n));
			message =
				`Filled in from ${data.source}.` +
				(missing.length ? ` Please check ${missing.map((n) => (n === 'start_date' ? 'the date' : 'the location')).join(' and ')}.` : ' Have a quick look before adding.');
		} catch {
			failed = true;
			message = "Couldn't read that link.";
		} finally {
			busy = false;
		}
	}

	// Lets a share link like /events/new?url=https://… fill the form straight away.
	onMount(() => {
		const q = new URLSearchParams(location.search).get('url');
		if (q) {
			url = q;
			fill();
		}
	});
</script>

<fieldset class="prefill">
	<legend>Have a link?</legend>
	<label>
		<span>Paste a ticket or event page to fill this in</span>
		<input type="url" inputmode="url" bind:value={url} placeholder="https://www.eventim.co.uk/…" onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fill(); } }} />
	</label>
	<button type="button" class="btn" onclick={fill} disabled={busy || !url.trim()}>{busy ? 'Reading…' : 'Fill it in'}</button>
	{#if message}<small class={failed ? 'error' : 'hint'} role="status">{message}</small>{/if}
</fieldset>
