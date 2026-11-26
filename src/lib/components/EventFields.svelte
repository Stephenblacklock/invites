<script>
	import { onMount, untrack } from 'svelte';
	import ImageField from './ImageField.svelte';
	let { values = {}, errors = {}, today, allowPast = false, clubs = [] } = $props();
	// stored as pence; while re-showing a rejected form the raw text comes back as a string
	const money = (v) => (typeof v === 'number' ? String(v / 100) : (v ?? ''));
	const MAX_ROWS = 8;
	const blank = () => ({ label: '', amount: '', estimate: false });
	let rows = $state(
		untrack(() =>
			Array.isArray(values.prices) && values.prices.length
				? values.prices.map((r) => ({ label: r.label ?? '', amount: money(r.amount), estimate: !!r.estimate }))
				: [blank()]
		)
	);
	// the "fill from a link" box hands over any prices it found
	onMount(() => {
		const onPrices = (e) => {
			const got = (e.detail ?? []).slice(0, MAX_ROWS).map((r) => ({ label: r.label ?? '', amount: String(r.amount ?? ''), estimate: !!r.estimate }));
			if (got.length) rows = got;
		};
		window.addEventListener('invites:prices', onPrices);
		return () => window.removeEventListener('invites:prices', onPrices);
	});
	let priceTbd = $state(untrack(() => !!values.price_tbd));
	let dateTbd = $state(untrack(() => !!values.date_tbd));
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
<label class="check">
	<input type="checkbox" name="date_tbd" value="1" bind:checked={dateTbd} />
	<span>Date to be confirmed <em>(the date above is a rough guess; it shows as TBC and stays out of calendars)</em></span>
</label>
<fieldset class="prices">
	<legend>Price per person <em>(£, optional)</em></legend>
	<label class="check">
		<input type="checkbox" name="price_tbd" value="1" bind:checked={priceTbd} />
		<span>Price to be confirmed</span>
	</label>
	{#if !priceTbd}
	{#each rows as row, i (i)}
		<div class="price-row">
			<input name="price_label_{i}" bind:value={row.label} maxlength="40" placeholder={i === 0 ? 'Curzon, or Standing' : 'Another venue or ticket'} aria-label="What this price is for" />
			<input name="price_amount_{i}" bind:value={row.amount} inputmode="decimal" placeholder="18, or free" aria-label="Price in pounds" />
			<label class="est"><input type="checkbox" name="price_estimate_{i}" value="1" bind:checked={row.estimate} /> Estimate</label>
			{#if rows.length > 1}
				<button type="button" class="btn ghost x" onclick={() => rows.splice(i, 1)} aria-label="Remove this price">✕</button>
			{/if}
		</div>
		{#if errors['price_' + i]}<small class="error">{errors['price_' + i]}</small>{/if}
	{/each}
	{#if errors.prices}<small class="error">{errors.prices}</small>{/if}
	<button type="button" class="btn" onclick={() => rows.push(blank())} disabled={rows.length >= MAX_ROWS}>Add another price</button>
	<small class="hint">Different venues or ticket types each get a row. Cards show the range.</small>
	{/if}
</fieldset>

<label>
	<span>Spots <em>(optional)</em></span>
	<input name="capacity" inputmode="numeric" value={values.capacity ?? ''} placeholder="3" />
	{#if errors.capacity}<small class="error">{errors.capacity}</small>{/if}
</label>
<p class="hint">For things with a limited number of tickets or seats. Anyone else can still say they're keen and joins a waiting list in order.</p>

<label>
	<span>Decide by <em>(optional)</em></span>
	<input type="date" name="decide_by" value={values.decide_by ?? ''} min={allowPast ? undefined : today} />
	{#if errors.decide_by}<small class="error">{errors.decide_by}</small>{/if}
</label>
<p class="hint">If it runs over several days, set an end date and the group can vote on which day to go.</p>

<label>
	<span>Tags <em>(comma separated)</em></span>
	<input name="tags" value={tagText} placeholder="festive, outdoors, food" />
</label>

{#if clubs.length}
	<label>
		<span>Club <em>(optional)</em></span>
		<select name="club">
			<option value="">No club</option>
			{#each clubs as c (c.id)}
				<option value={c.id} selected={String(values.club_id ?? values.club ?? '') === String(c.id)}>{c.name}</option>
			{/each}
		</select>
		{#if errors.club}<small class="error">{errors.club}</small>{/if}
	</label>
{/if}

<label>
	<span>Trailer or playlist link <em>(optional)</em></span>
	<input name="media_link" type="url" inputmode="url" value={values.media_link ?? ''} placeholder="YouTube or Spotify link" />
	{#if errors.media_link}<small class="error">{errors.media_link}</small>{/if}
</label>

<label>
	<span>Group chat link <em>(optional)</em></span>
	<input name="chat_link" type="url" value={values.chat_link ?? ''} placeholder="https://chat.whatsapp.com/…" />
	{#if errors.chat_link}<small class="error">{errors.chat_link}</small>{/if}
</label>

<ImageField image={values.image ?? null} error={errors.image} />
