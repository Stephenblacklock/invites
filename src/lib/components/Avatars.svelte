<script>
	import { hue, namesLabel } from '#lib/format.js';
	let { people = [], max = 4, label = true } = $props();
	const shown = $derived(people.slice(0, max));
	const names = $derived(people.map((p) => p.name));
</script>

<span class="avatars">
	{#if shown.length}
		<span class="avatar-stack" aria-hidden="true">
			{#each shown as p (p.id)}
				<span class="avatar sm" style:--h={hue(p.name)}>{p.name[0].toUpperCase()}</span>
			{/each}
			{#if people.length > max}<span class="avatar sm more">+{people.length - max}</span>{/if}
		</span>
	{/if}
	{#if label}
		<span class="avatars-label">
			{#if names.length}<strong>{namesLabel(names)}</strong> {names.length === 1 ? 'is' : 'are'} keen{:else}Be the first to say you're keen{/if}
		</span>
	{/if}
</span>
