import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter() })],
	// better-sqlite3 is a native module: keep it out of the bundle
	ssr: { external: ['better-sqlite3'] }
});
