<script>
	import StationPicker from '#lib/components/StationPicker.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Invites · Your stations</title></svelte:head>

<a class="back" href="/settings">← Settings</a>
<h1>Your stations</h1>
<p class="muted">
	Pick a home and/or work station and every event with a London location shows roughly how long it takes to get there.
	These are private: only you see your own times, and nobody else can see which stations you chose.
</p>

{#if form?.error}<p class="error">{form.error}</p>{/if}

<StationPicker kind="home" label="Home station" current={data.stations.home} />
<StationPicker kind="work" label="Work station" current={data.stations.work} />

<p class="hint">Journey times are a typical evening departure (18:30) and can differ on the night. Powered by TfL Open Data. Venue locations from © OpenStreetMap contributors.</p>
