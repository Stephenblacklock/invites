import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit({
			adapter: adapter(),
			// Built-in CSRF origin check is replaced by csrfBlocked() in hooks.server.js: Facebook/Messenger
			// and other in-app browsers send a missing or "null" Origin on form posts, which the default rejects.
			csrf: { trustedOrigins: ['*'] }
		})],
	// better-sqlite3 is a native module: keep it out of the bundle
	ssr: { external: ['better-sqlite3'] }
});
