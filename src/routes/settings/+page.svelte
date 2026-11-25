<script>
	import { enhance } from '$app/forms';
	let { data } = $props();
	let copied = $state(false);
	let copiedJoin = $state(false);
	async function copyJoin() {
		try {
			await navigator.clipboard.writeText(data.joinLink);
			copiedJoin = true;
			setTimeout(() => (copiedJoin = false), 2000);
		} catch {
			window.prompt('Copy this link', data.joinLink);
		}
	}
	async function copyFeed() {
		try {
			await navigator.clipboard.writeText(data.feed);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			/* the link is also shown, so it can be copied by hand */
		}
	}
</script>

<svelte:head><title>Invites · Settings</title></svelte:head>

<h1>Settings</h1>

<section class="panel calendar-sync">
	<h2>Calendar</h2>
	<p class="muted">Subscribe once and everything you're keen on shows up in your calendar app and stays up to date.</p>
	<p class="row-btns">
		<a class="btn primary" href={data.feed.replace(/^https?:/, 'webcal:')}>Subscribe</a>
		<button type="button" class="btn" onclick={copyFeed}>{copied ? 'Copied' : 'Copy link'}</button>
	</p>
	<p class="hint">Private link: anyone who has it can see your plans, so don't share it.</p>
	<form method="POST" action="?/resetCalendar" use:enhance>
		<button class="btn ghost">Make a new link</button>
	</form>
</section>

<section class="panel">
	<h2>Travel times</h2>
	<p class="muted">
		Set a home or work station and events show how long it takes to get there.
		{#if data.stations.home || data.stations.work}
			Now: {[data.stations.home && `home ${data.stations.home}`, data.stations.work && `work ${data.stations.work}`].filter(Boolean).join(', ')}.
		{/if}
	</p>
	<p><a class="btn" href="/stations">Your stations</a></p>
</section>

<section class="panel">
	<h2>Your sign-in link</h2>
	<p class="muted">Open this on another phone or browser to sign in as you, no password needed. It works until an admin makes a new one.</p>
	<p class="row-btns"><button type="button" class="btn" onclick={copyJoin}>{copiedJoin ? 'Copied' : 'Copy link'}</button></p>
	<p class="hint">Private: anyone with it can sign in as you.</p>
</section>

<section class="panel">
	<h2>Account</h2>
	<div class="row-btns">
		{#if data.person?.is_admin}<a class="btn" href="/admin">Manage people</a>{/if}
		<a class="btn" href="/who">Switch name</a>
		<form method="POST" action="/logout"><button class="btn ghost">Sign out</button></form>
	</div>
</section>
