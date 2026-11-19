<script>
	import { enhance } from '$app/forms';
	import EventFields from '#lib/components/EventFields.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Invites · Edit {data.event.title}</title></svelte:head>

<a class="back" href="/events/{data.event.id}">← Back</a>
<h1>Edit event</h1>

<form method="POST" use:enhance class="card-form">
	<EventFields values={form?.values ?? data.event} errors={form?.errors} today={data.today} allowPast />
	<button class="btn primary">Save changes</button>
</form>
