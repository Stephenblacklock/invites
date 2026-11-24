/** Tiny in-memory sliding-window limiter: `const ok = limiter(12)`; `ok(key)` is false once a key is over the cap. */
export function limiter(max, windowMs = 60_000) {
	const hits = new Map();
	return (key) => {
		const now = Date.now();
		const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
		if (recent.length >= max) return false;
		recent.push(now);
		hits.set(key, recent);
		return true;
	};
}
