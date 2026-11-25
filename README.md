# Invites

Swipe on events with your friends. Someone adds an event (title, description, place, tags, dates);
everyone else gets it in a swipe deck. Swipe right and you're in that event's group, where you can
vote on a day, drop a chat link and sort out logistics. Swipe left and it's gone for you.

Built for a small circle of friends: **personal invite links (shared password as a fallback), no accounts.**

- SvelteKit 3 (adapter-node) + SQLite (`better-sqlite3`), mobile-first PWA
- One container, one volume (`/data/invites.db`)

## How access works

**Personal links (the normal way in).** Every person has their own link, `/join/<secret>`. Opening it shows "Continue as <name>";
one tap signs that device in (a tap is required so link previews can't use it up). The link keeps working until an admin makes a new
one, which also signs that person out everywhere. Find your own link in Settings, to sign in on another device.

**New friends.** On `/admin` make a nameless invite link (optionally labelled), send it, and they open it, type their own name and are in. Each invite works once, expires after 14 days and can be revoked before use ("Copy message" gives a ready-to-send text); afterwards they have their own personal link like everyone else. First visit shows a dismissible welcome panel (how swiping works, keep your link, add to home screen).

**Admin.** The person named by `ADMIN_NAME` (default `INVITES_API_PERSON`, then `Stephen`) is admin once they exist. Admins get
**Manage people** in Settings (`/admin`): copy anyone's link, make a new one, pause or resume them, and switch the shared password on or off.

**Shared password (fallback).** Anyone with `INVITES_PASSWORD` can still pick or add a name, until an admin switches it off on `/admin`.
That path is trust-based. Changing `INVITES_PASSWORD` signs everybody out. Login is rate-limited (5 failed attempts per IP per 15 min,
plus a global cap), and the app refuses to serve anything until a password of at least 8 characters is set.

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `INVITES_PASSWORD` | yes | Shared password, 8+ characters |
| `ADMIN_NAME` | no | Who is admin (first match by name, only used while nobody is admin yet). Defaults to `INVITES_API_PERSON`, then `Stephen` |
| `ORIGIN` | yes (behind a proxy) | Public URL, e.g. `https://invites.blacklocks.uk`. Needed for SvelteKit's form CSRF check |
| `DB_PATH` | no | Defaults to `/data/invites.db` in the image |
| `INVITES_API_TOKEN` | no | Enables the JSON API at `/api/v1` (bearer token, 24+ characters, e.g. `openssl rand -hex 32`). Unset = API returns 404 |
| `INVITES_API_PERSON` | no | Name the API acts as (default `Stephen`); created on first use |
| `SESSION_SECRET` | no | Otherwise generated once and stored in the database |
| `TZ` | no | `Europe/London` in the image; decides what "today" means |

## Deploy on Unraid (Cloudflare Tunnel → NPM)

1. **Image.** Push this repo to GitHub. The workflow in `.github/workflows/docker.yml` builds and pushes
   `ghcr.io/<your-github-username>/invites:latest` on every push to `main`. The first push creates a *private*
   package; either make it public (GitHub → Packages → invites → Package settings), or run
   `docker login ghcr.io` on Tower with a token that has `read:packages`.
2. **Container** (Docker tab → Add Container, or use `compose.yml`):
   - Repository: `ghcr.io/<user>/invites:latest`
   - Network: `stephenproxy`
   - Path: `/mnt/user/appdata/invites` → `/data` (read/write)
   - Variables: `INVITES_PASSWORD`, `ORIGIN=https://invites.blacklocks.uk`, `TZ=Europe/London`
   - Extra Parameters: `--user 99:100` (so the bind mount owned by `nobody:users` is writable)
   - No published port is needed. Add one only for LAN testing.
3. **NPM proxy host:** `invites.blacklocks.uk` → scheme `http`, forward host `Invites` (container name),
   forward port `3000` (the container's *internal* port). **Force SSL off**, no Cloudflare Access.
4. **Cloudflare:** a proxied CNAME `invites` → the tunnel (`<tunnel-id>.cfargotunnel.com`), and a public hostname
   on the tunnel pointing at `http://NginxProxyManager:8080`, as for the other services.
5. Open the URL on a phone and use "Add to Home Screen" to install it as an app.

Health check: `GET /healthz` (public, returns `ok`). The image includes a Docker `HEALTHCHECK`.

## Backups

Everything lives in `/mnt/user/appdata/invites/invites.db` (plus `-wal`/`-shm` files while running). Stop the
container or use `sqlite3 invites.db ".backup copy.db"` for a consistent copy.

## Develop

```sh
npm install
INVITES_PASSWORD=dev-password-1 npm run dev
```

Build and run the production server, then run the end-to-end smoke test against it:

```sh
npm run build
INVITES_PASSWORD=test-password-123 ORIGIN=http://localhost:3100 PORT=3100 DB_PATH=/tmp/invites-test.db node build &
BASE=http://localhost:3100 INVITES_PASSWORD=test-password-123 npm run smoke
```

Run the smoke test against a fresh database each time (it trips the login rate limiter on purpose).

Notes:
- `better-sqlite3` 13 ships prebuilt binaries inside the package, so installs use `--ignore-scripts`
  (npm would otherwise try to compile it from source).
- SvelteKit 3: config lives in `vite.config.js`, and `#lib/...` replaces `$lib` (see `imports` in `package.json`).

## Spots, clubs and prices

- **Spots:** an event can have a limit (e.g. 3 tickets). The first people to say they're keen get the spots; anyone else can
  still say they're keen and joins a waiting list, moving up when someone drops out.
- **Clubs:** a club groups one kind of event (movie club, gigs). Anyone can start or join one and see who else is in it. Events
  can belong to a club, but they stay open to everyone, club member or not.
- **Prices:** rows per venue or ticket type, each optionally an estimate (`~`). Cards show the range.
- **Settings** (your name, top right): calendar feed, travel stations, switch name, sign out.

## Ideas for later

- Notifications via the self-hosted ntfy server
- Calendar (.ics) export, map pins for locations

## API (for an MCP gateway or scripts)

Set `INVITES_API_TOKEN` to enable it. Send `Authorization: Bearer <token>`. The OpenAPI spec is public at
`/api/v1/openapi.json`.

| Operation | Request |
|---|---|
| `list_events` | `GET /api/v1/events?scope=upcoming\|past\|all&q=text` |
| `get_event` | `GET /api/v1/events/{id}` (adds date poll and comments) |
| `create_event` | `POST /api/v1/events` JSON `title`, `start_date` (+ `description`, `location`, `tags[]`, `end_date`, `chat_link`, `image_url`, `decide_by`, `media_link`, `capacity`, `club`, `prices[]`). 409 on same title + start date |
| `update_event` | `PATCH /api/v1/events/{id}` (only events the API person created) |
| `my_plans` | `GET /api/v1/plans` |
| `list_clubs` | `GET /api/v1/clubs` (names, members; put an event in a club by name with `club`) |
| `preview_link` | `POST /api/v1/link-preview` (suggest event fields from a public page; nothing is saved) |

`prices` is a list of `{label, amount (GBP), estimate}` rows, one per venue or ticket type; `price_min` / `price_max` still work
as a shortcut for a single price or a range. `capacity` limits how many people can go; the rest wait in order (`waiting_list`).

It cannot swipe, join, comment or delete. Failed token attempts share the login rate limiter (5 per IP per 15 minutes).

## Travel times (optional)

People can set a private home and/or work station on `/stations`; events with a London location then show a typical evening (18:30) journey time on the swipe card, Plans and the event page.

- Journeys: TfL Journey Planner. Works anonymously (rate limited); set `TFL_APP_KEY` (free from api-portal.tfl.gov.uk) for higher limits.
- Venue coordinates: OpenStreetMap Nominatim (1 request/second, Greater London only). Results are cached on the event and in the database (3 days for journeys).
- If either service is unreachable the time is simply not shown. `TFL_BASE` / `GEOCODE_BASE` can point at other servers (the smoke tests use a fake one).
