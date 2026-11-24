<script>
	import { enhance } from '$app/forms';
	import EventFields from '#lib/components/EventFields.svelte';
	import PrefillBox from '#lib/components/PrefillBox.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Invites · Add an event</title></svelte:head>

<h1>Add an event</h1>
<p class="muted">You'll be marked as interested. Everyone else will see it in their swipe deck.</p>

<form method="POST" enctype="multipart/form-data" use:enhance class="card-form">
	<PrefillBox />
	<EventFields values={form?.values} errors={form?.errors} today={data.today} />
	<button class="btn primary">Add event</button>
</form>
