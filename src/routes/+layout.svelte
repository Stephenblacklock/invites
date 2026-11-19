<script>
	import '../app.css';
	import { page } from '$app/state';
	import { hue } from '#lib/format.js';

	let { data, children } = $props();
	const path = $derived(page.url.pathname);
	const isActive = (href) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<div class="shell" class:has-nav={!!data.person}>
	{#if data.person}
		<header class="topbar">
			<a class="wordmark" href="/">Invites</a>
			<a class="whoami" href="/who" title="Switch name">
				<span class="avatar sm" style:--h={hue(data.person.name)} aria-hidden="true">{data.person.name[0].toUpperCase()}</span>
				{data.person.name}
			</a>
		</header>
	{/if}

	<div class="content">
		{@render children()}
	</div>

	{#if data.person}
		<nav class="tabbar" aria-label="Main">
			<a href="/" class:active={isActive('/')} aria-current={path === '/' ? 'page' : undefined}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6.2 5.3 5.3 0 0 1 21.3 12C19 16.4 12 21 12 21z"/></svg>
				Swipe
			</a>
			<a href="/plans" class:active={isActive('/plans')} aria-current={isActive('/plans') ? 'page' : undefined}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>
				Plans
			</a>
			<a href="/events/new" class:active={isActive('/events/new')} aria-current={isActive('/events/new') ? 'page' : undefined}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/></svg>
				Add
			</a>
		</nav>
	{/if}
</div>
