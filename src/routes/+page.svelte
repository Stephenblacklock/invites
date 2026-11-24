<script>
	import { untrack } from 'svelte';
	import { INTEREST, bg, countdown, flags, fmtRange, hue } from '#lib/format.js';
	import Avatars from '#lib/components/Avatars.svelte';

	let { data } = $props();

	let deck = $state(untrack(() => data.events));
	let history = $state([]);
	let activeTag = $state(null);
	let dx = $state(0);
	let dragging = $state(false);
	let leaving = $state(0); // -1 pass, 1 interested
	let busy = false;
	let toast = $state(null);
	let toastTimer;
	let failure = $state('');
	let sheet = $state(null); // { event, level } after swiping interested
	let sheetTimer;

	const allTags = $derived([...new Set(deck.flatMap((e) => e.tags))].sort());
	const visible = $derived(activeTag ? deck.filter((e) => e.tags.includes(activeTag)) : deck);
	const top = $derived(visible[0]);
	const next = $derived(visible[1]);

	$effect(() => {
		// if the active tag has no events left, fall back to everything
		if (activeTag && !deck.some((e) => e.tags.includes(activeTag))) activeTag = null;
	});

	async function send(eventId, decision, interest) {
		try {
			const res = await fetch('/api/swipe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ eventId, decision, interest })
			});
			if (!res.ok) throw new Error(String(res.status));
			return true;
		} catch {
			return false;
		}
	}

	function showToast(t) {
		toast = t;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 4500);
	}

	function commit(dir) {
		if (busy || !top) return;
		busy = true;
		leaving = dir;
		const ev = top;
		setTimeout(async () => {
			deck = deck.filter((e) => e.id !== ev.id);
			history = [...history, ev];
			leaving = 0;
			dx = 0;
			busy = false;
			const ok = await send(ev.id, dir > 0 ? 'interested' : 'not_interested');
			if (!ok) {
				failure = "Couldn't save that swipe. Check your connection.";
				deck = [ev, ...deck];
				history = history.filter((h) => h.id !== ev.id);
			} else {
				failure = '';
				if (dir > 0) {
					// saved as "keen" (2) already; the sheet lets them dial it up or down
					sheet = { event: ev, level: 2 };
					clearTimeout(sheetTimer);
					sheetTimer = setTimeout(() => (sheet = null), 8000);
				}
			}
		}, 220);
	}

	async function setLevel(n) {
		if (!sheet) return;
		const ev = sheet.event;
		sheet = { event: ev, level: n };
		clearTimeout(sheetTimer);
		const ok = await send(ev.id, 'interest', n);
		if (!ok) failure = "Couldn't save how keen you are.";
		else {
			failure = '';
			const others = ev.interested.length;
			sheet = null;
			showToast({
				text: others ? `You're in. ${others} other${others === 1 ? ' is' : 's are'} keen.` : "You're in. You're first!",
				href: `/events/${ev.id}`
			});
		}
	}

	async function undo() {
		sheet = null;
		if (busy || !history.length) return;
		const ev = history[history.length - 1];
		history = history.slice(0, -1);
		deck = [ev, ...deck];
		toast = null;
		if (!(await send(ev.id, 'undo'))) failure = "Couldn't undo that on the server.";
	}

	// ---- drag handling
	let start = null;
	function down(e) {
		if (busy || e.target.closest('a, button')) return;
		start = { x: e.clientX, y: e.clientY, id: e.pointerId };
	}
	function move(e) {
		if (!start || e.pointerId !== start.id) return;
		const mx = e.clientX - start.x;
		const my = e.clientY - start.y;
		if (!dragging) {
			if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
				dragging = true;
				e.currentTarget.setPointerCapture(e.pointerId);
			} else return;
		}
		dx = mx;
	}
	function up(e) {
		if (!start) return;
		start = null;
		if (!dragging) return;
		dragging = false;
		if (dx > 110) commit(1);
		else if (dx < -110) commit(-1);
		else dx = 0;
	}

	function key(e) {
		if (e.target.closest('input, textarea, select')) return;
		if (e.key === 'ArrowRight') commit(1);
		else if (e.key === 'ArrowLeft') commit(-1);
		else if (e.key === 'z' || e.key === 'Backspace') undo();
	}

	const tilt = $derived(leaving ? leaving * 22 : dx / 18);
	const shift = $derived(leaving ? leaving * 140 + 'vw' : dx + 'px');
	const keenOpacity = $derived(Math.max(0, Math.min(1, (leaving > 0 ? 1 : dx) / 100)));
	const passOpacity = $derived(Math.max(0, Math.min(1, (leaving < 0 ? 1 : -dx) / 100)));
</script>

<svelte:window onkeydown={key} />
<svelte:head><title>Invites</title></svelte:head>

{#if allTags.length > 1}
	<div class="chips" role="group" aria-label="Filter by tag">
		<button class="chip" class:on={!activeTag} onclick={() => (activeTag = null)}>All</button>
		{#each allTags as t (t)}
			<button class="chip" class:on={activeTag === t} onclick={() => (activeTag = activeTag === t ? null : t)}>{t}</button>
		{/each}
	</div>
{/if}

{#if top}
	<p class="left muted small">{visible.length} to go</p>
	<div class="deck">
		{#if next}
			{#key next.id}
				<article class="card behind" style:--h={hue(next.title)} aria-hidden="true">
					<div class="banner" class:has-image={next.image} style:background-image={bg(next.image)}></div>
				</article>
			{/key}
		{/if}
		{#key top.id}
			<article
				class="card top"
				class:dragging
				style:--h={hue(top.title)}
				style:transform="translateX({shift}) rotate({tilt}deg)"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
			>
				<div class="banner" class:has-image={top.image} style:background-image={bg(top.image)}>
					<span class="pill">{countdown(top.start_date, top.end_date, data.today)}</span>
					<span class="banner-date">{fmtRange(top.start_date, top.end_date, data.today)}</span>
				</div>
				<div class="card-body">
					<h2>{top.title}</h2>
					{#if top.location}<p class="loc">{top.location}</p>{/if}
					{#if flags(top, data.today).length}
						<p class="flags">{#each flags(top, data.today) as f (f.text)}<span class="flag" class:urgent={f.urgent} class:good={f.good}>{f.text}</span>{/each}</p>
					{/if}
					{#if top.description}<p class="desc clamp">{top.description}</p>{/if}
					{#if top.tags.length}
						<p class="tags">{#each top.tags as t (t)}<span class="tag">{t}</span>{/each}</p>
					{/if}
					<div class="card-foot">
						<Avatars people={top.interested} max={4} />
						<a class="more-link" href="/events/{top.id}">Details</a>
					</div>
					<p class="muted small">Added by {top.creator_name}</p>
				</div>
				<span class="stamp keen" style:opacity={keenOpacity}>Interested</span>
				<span class="stamp pass" style:opacity={passOpacity}>Pass</span>
			</article>
		{/key}
	</div>

	<div class="actions">
		<button class="round pass" onclick={() => commit(-1)} aria-label="Not interested">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			<span>Not interested</span>
		</button>
		<button class="round undo" onclick={undo} disabled={!history.length} aria-label="Undo last swipe">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -4)" /></svg>
			<span>Undo</span>
		</button>
		<button class="round keen" onclick={() => commit(1)} aria-label="Interested">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
			<span>Interested</span>
		</button>
	</div>
{:else}
	<section class="empty">
		<h2>{deck.length ? 'Nothing under that tag' : "You're all caught up"}</h2>
		<p class="muted">
			{deck.length
				? 'Clear the filter to see the rest.'
				: 'No more events to swipe on. Add one you fancy and the others will see it.'}
		</p>
		<p class="row-btns">
			<a class="btn primary" href="/events/new">Add an event</a>
			<a class="btn" href="/plans">See your plans</a>
			{#if history.length}<button class="btn ghost" onclick={undo}>Undo last swipe</button>{/if}
			<a class="btn ghost" href="/passed">Events you passed on</a>
		</p>
	</section>
{/if}

{#if failure}<p class="error center" role="alert">{failure}</p>{/if}

{#if sheet}
	<div class="sheet" role="dialog" aria-label="How keen are you?">
		<p class="sheet-title">You're in for <strong>{sheet.event.title}</strong>. How keen?</p>
		<div class="interest-opts">
			{#each INTEREST as o (o.level)}
				<button class="interest-opt" class:on={sheet.level === o.level} onclick={() => setLevel(o.level)}>
					<span class="meter" aria-hidden="true">{#each [1, 2, 3] as n (n)}<i class:on={n <= o.level}></i>{/each}</span>
					{o.label}
					<small>{o.hint}</small>
				</button>
			{/each}
		</div>
		<button class="linklike" onclick={() => (sheet = null)}>Skip</button>
	</div>
{/if}

{#if toast}
	<div class="toast" role="status">
		<span>{toast.text}</span>
		<a href={toast.href}>Open group</a>
	</div>
{/if}
