<script>
	import { enhance } from '$app/forms';
	import EventRow from '#lib/components/EventRow.svelte';
	let { data } = $props();
	let copied = $state(false);
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

<svelte:head><title>Invites · Plans</title></svelte:head>

<h1>Your plans</h1>

{#if data.upcoming.length}
	<div class="list">
		{#each data.upcoming as e (e.id)}<EventRow event={e} today={data.today} />{/each}
	</div>
{:else}
	<section class="empty">
		<p class="muted">Nothing planned yet. Swipe right on something, or add your own.</p>
		<p class="row-btns">
			<a class="btn primary" href="/">Start swiping</a>
			<a class="btn" href="/events/new">Add an event</a>
		</p>
	</section>
{/if}

<p class="center-link"><a href="/passed">Events you passed on</a></p>

{#if data.past.length}
	<h2 class="section-title">Past</h2>
	<div class="list faded">
		{#each data.past as e (e.id)}<EventRow event={e} today={data.today} />{/each}
	</div>
{/if}

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
