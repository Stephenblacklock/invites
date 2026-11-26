import { listPrimaryTags, tagCounts } from '#lib/server/db.js';
import { json } from '#lib/server/api.js';

/** The main tags (filter chips) and every other tag in use, so events can reuse existing tags instead of inventing near-duplicates. */
export function GET() {
	const primary = listPrimaryTags();
	return json({ primary, other: tagCounts().filter((t) => !primary.includes(t.tag)) });
}
