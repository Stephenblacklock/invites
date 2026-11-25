<script>
	import { onMount } from 'svelte';
	let { joinLink, friends = 0 } = $props();
	let show = $state(false);
	let copied = $state(false);
	const KEY = 'invites:welcome-done';

	onMount(() => {
		try {
			show = !localStorage.getItem(KEY);
		} catch {
			show = false;
		}
	});
	function done() {
		show = false;
		try {
			localStorage.setItem(KEY, '1');
		} catch {
			/* it just shows again next visit */
		}
	}
	async function copy() {
		try {
			await navigator.clipboard.writeText(joinLink);
			copied = true;
		} catch {
			window.prompt('Copy your link', joinLink);
		}
	}
</script>

{#if show}
	<section class="panel welcome" aria-label="Welcome">
		<h2>Welcome</h2>
		<ul>
			<li><strong>Swipe right</strong> on things you fancy, left to pass. After a right swipe, say how keen you are.</li>
			<li>Open an event to see <strong>who else is keen</strong>{friends ? ` (${friends} ${friends === 1 ? 'friend is' : 'friends are'} on here)` : ''}.</li>
			<li>
				<strong>Keep your link.</strong> If you get signed out, your personal link gets you back in, whatever browser you're in.
				<button type="button" class="btn" onclick={copy}>{copied ? 'Copied' : 'Copy my link'}</button>
			</li>
			<li>Add this page to your home screen so it opens like an app.</li>
		</ul>
		<button type="button" class="btn primary" onclick={done}>Got it</button>
	</section>
{/if}

<style>
	.welcome ul { padding-left: 1.1rem; display: grid; gap: 0.5rem; margin: 0.5rem 0 1rem; }
</style>
