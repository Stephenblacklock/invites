<script>
	let { image = null, error = null } = $props();
	let input;
	let preview = $state(null);
	let note = $state('');
	let removing = $state(false);

	const MAX_EDGE = 1600;

	// Phone photos are big: shrink still images in the browser before upload. GIFs are sent untouched so they keep animating.
	async function onPick() {
		note = '';
		const file = input.files?.[0];
		if (preview) URL.revokeObjectURL(preview);
		preview = file ? URL.createObjectURL(file) : null;
		if (!file || file.type === 'image/gif' || file.size < 700 * 1024 || !file.type.startsWith('image/')) return;
		try {
			const bmp = await createImageBitmap(file);
			const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
			const c = document.createElement('canvas');
			c.width = Math.round(bmp.width * scale);
			c.height = Math.round(bmp.height * scale);
			c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
			const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
			if (blob && blob.size < file.size) {
				const dt = new DataTransfer();
				dt.items.add(new File([blob], 'banner.jpg', { type: 'image/jpeg' }));
				input.files = dt.files;
				note = `Resized to ${Math.round(blob.size / 1024)} KB`;
			}
		} catch {
			/* send the original; the server still checks size and type */
		}
	}
</script>

<fieldset class="image-field">
	<legend>Banner picture <em>(optional)</em></legend>
	{#if image && !removing}
		<img class="image-current" src="/img/{image}" alt="Current banner" />
	{/if}
	{#if preview}<img class="image-current" src={preview} alt="Selected banner preview" />{/if}

	<label>
		<span>Upload a photo or GIF</span>
		<input bind:this={input} type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" onchange={onPick} />
	</label>
	{#if note}<small class="hint">{note}</small>{/if}

	<label>
		<span>…or paste an image link</span>
		<input name="image_url" type="url" inputmode="url" placeholder="https://media.giphy.com/media/…/giphy.gif" />
	</label>
	<p class="hint">Use a direct picture address (ends in .jpg, .png, .webp or .gif). We keep our own copy.</p>

	{#if image}
		<label class="check">
			<input type="checkbox" name="remove_image" bind:checked={removing} />
			<span>Remove the current banner</span>
		</label>
	{/if}
	{#if error}<small class="error">{error}</small>{/if}
</fieldset>
