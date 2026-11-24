// Recognises the video/music links an event can carry and turns them into a safe embed address.
// Only YouTube and Spotify are accepted, so an event can never embed an arbitrary site.
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

/** @returns {{kind:'youtube'|'spotify', label:string, embed:string, link:string, height?:number}|null} */
export function parseMedia(raw) {
	let u;
	try {
		u = new URL(String(raw ?? '').trim());
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
	const host = u.hostname.toLowerCase();

	if (YT_HOSTS.has(host)) {
		let id = null;
		if (host.endsWith('youtu.be')) id = u.pathname.slice(1).split('/')[0];
		else if (u.pathname === '/watch') id = u.searchParams.get('v');
		else id = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
		if (id && VIDEO_ID.test(id)) {
			return { kind: 'youtube', label: 'YouTube', embed: `https://www.youtube-nocookie.com/embed/${id}`, link: `https://www.youtube.com/watch?v=${id}` };
		}
		const list = u.searchParams.get('list');
		if (u.pathname === '/playlist' && list && LIST_ID.test(list)) {
			return { kind: 'youtube', label: 'YouTube', embed: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, link: `https://www.youtube.com/playlist?list=${list}` };
		}
		return null;
	}

	if (host === 'open.spotify.com') {
		const m = /^\/(?:intl-[a-z]{2}(?:-[a-z]+)?\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{10,30})\/?$/.exec(u.pathname);
		if (m) {
			return {
				kind: 'spotify',
				label: 'Spotify',
				embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
				link: `https://open.spotify.com/${m[1]}/${m[2]}`,
				height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352
			};
		}
	}
	return null;
}
