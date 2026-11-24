<script>
	import ImageField from './ImageField.svelte';
	let { values = {}, errors = {}, today, allowPast = false } = $props();
	const tagText = $derived(Array.isArray(values.tags) ? values.tags.join(', ') : (values.tags ?? ''));
</script>

<label>
	<span>Title</span>
	<input name="title" maxlength="80" value={values.title ?? ''} placeholder="Winter Wonderland" required />
	{#if errors.title}<small class="error">{errors.title}</small>{/if}
</label>

<label>
	<span>What is it?</span>
	<textarea name="description" rows="4" maxlength="1000" placeholder="Rides, mulled wine, the big wheel…"
		>{values.description ?? ''}</textarea
	>
	{#if errors.description}<small class="error">{errors.description}</small>{/if}
</label>

<label>
	<span>Where?</span>
	<input name="location" maxlength="120" value={values.location ?? ''} placeholder="Hyde Park, London" />
	{#if errors.location}<small class="error">{errors.location}</small>{/if}
</label>

<div class="row2">
	<label>
		<span>Starts</span>
		<input type="date" name="start_date" value={values.start_date ?? ''} min={allowPast ? undefined : today} required />
		{#if errors.start_date}<small class="error">{errors.start_date}</small>{/if}
	</label>
	<label>
		<span>Ends <em>(optional)</em></span>
		<input type="date" name="end_date" value={values.end_date ?? ''} min={values.start_date || (allowPast ? undefined : today)} />
		{#if errors.end_date}<small class="error">{errors.end_date}</small>{/if}
	</label>
</div>
<p class="hint">If it runs over several days, set an end date and the group can vote on which day to go.</p>

<label>
	<span>Tags <em>(comma separated)</em></span>
	<input name="tags" value={tagText} placeholder="festive, outdoors, food" />
</label>

<label>
	<span>Group chat link <em>(optional)</em></span>
	<input name="chat_link" type="url" value={values.chat_link ?? ''} placeholder="https://chat.whatsapp.com/…" />
	{#if errors.chat_link}<small class="error">{errors.chat_link}</small>{/if}
</label>

<ImageField image={values.image ?? null} error={errors.image} />
