<script>
	import EventRow from '#lib/components/EventRow.svelte';
	let { data } = $props();
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
