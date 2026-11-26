<script>
	import { parseMedia } from '#lib/media.js';
	let { link } = $props();
	const m = $derived(parseMedia(link));
</script>

{#if m}
	<section class="panel media">
		<h2>{m.kind === 'youtube' ? 'Watch' : 'Listen'}</h2>
		<iframe
			class:spotify={m.kind === 'spotify'}
			title="{m.label} player"
			src={m.embed}
			height={m.height}
			allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
			allowfullscreen
			referrerpolicy="strict-origin-when-cross-origin"
		></iframe>
		<p class="hint">
			<a href={m.link} target="_blank" rel="noopener noreferrer">Open in {m.label}</a>
		</p>
	</section>
{/if}
