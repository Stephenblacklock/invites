<script>
	import { enhance } from '$app/forms';
	import { countdown, fmtRange } from '#lib/format.js';
	let { data } = $props();
</script>

<svelte:head><title>Invites · Passed</title></svelte:head>

<a class="back" href="/plans">← Plans</a>
<h1>Passed on</h1>
<p class="muted">Upcoming events you said no to. Changed your mind?</p>

{#if data.events.length}
	<div class="list">
		{#each data.events as e (e.id)}
			<div class="event-row static">
				<span class="event-main">
					<a class="event-title" href="/events/{e.id}">{e.title}</a>
					<span class="muted small">{countdown(e.start_date, e.end_date, data.today)} · {fmtRange(e.start_date, e.end_date, data.today)}</span>
				</span>
				<form method="POST" action="?/join" use:enhance>
					<input type="hidden" name="id" value={e.id} />
					<button class="btn">I'm in</button>
				</form>
			</div>
		{/each}
	</div>
{:else}
	<p class="muted">Nothing here.</p>
{/if}
