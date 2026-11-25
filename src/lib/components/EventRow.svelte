<script>
	import { bg, countdown, flags, fmtRange, hue } from '#lib/format.js';
	import Avatars from './Avatars.svelte';
	let { event, today } = $props();
	const h = $derived(hue(event.title));
</script>

<a class="event-row" href="/events/{event.id}" style:--h={h}>
	<span class="date-chip" class:has-image={event.image} style:background-image={bg(event.image)}>
		<span class="d1">{countdown(event.start_date, event.end_date, today)}</span>
	</span>
	<span class="event-main">
		<strong class="event-title">{event.title}</strong>
		<span class="muted small">{fmtRange(event.start_date, event.end_date, today)}{event.location ? ` · ${event.location}` : ''}</span>
		{#each flags(event, today) as f, i (i)}<span class="flag" class:urgent={f.urgent} class:good={f.good}>{f.text}</span>{/each}
		<Avatars people={event.interested} max={4} label={false} />
	</span>
	<span class="count" aria-label="{event.interested.length} interested">{event.interested.length}</span>
</a>
