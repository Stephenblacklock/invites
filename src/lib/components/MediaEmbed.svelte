<script>
	import { parseMedia } from '#lib/media.js';
	let { link } = $props();
	const m = $derived(parseMedia(link));
	let open = $state(false);
</script>

{#if m}
	<section class="panel media">
		<h2>{m.kind === 'youtube' ? 'Watch' : 'Listen'}</h2>
		{#if open}
			<iframe
				class:spotify={m.kind === 'spotify'}
				title="{m.label} player"
				src={m.embed}
				height={m.height}
				allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
				allowfullscreen
				referrerpolicy="strict-origin-when-cross-origin"
			></iframe>
		{:else}
			<button type="button" class="btn primary" onclick={() => (open = true)}>▶ Play on {m.label}</button>
		{/if}
		<p class="hint">
			<a href={m.link} target="_blank" rel="noopener noreferrer">Open in {m.label}</a>
			· The player only loads when you tap play.
		</p>
	</section>
{/if}
