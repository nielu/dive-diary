# Dive diary

A personal cave-diving log: one entry per dive, with the dive details, a
navigation and log text, photos of the cave map with markers and a drawn
route, and dive photos and short video clips. Works offline on your phone and syncs when you're back
on a connection. Read-only share links for family.

**Stack:** PocketBase 0.40 (SQLite, file storage, auth, one binary) + Svelte 5
frontend served by PocketBase itself. Leaflet for the map editor. IndexedDB +
a service worker for offline use.

## Layout

```
backend/
  pb_migrations/1762400000_init.js   schema: dives, maps, photos, shares
  pb_hooks/main.pb.js                share endpoint + owner account seeding
frontend/
  src/lib/localdb.js     IndexedDB store (local-first, client-generated ids)
  src/lib/sync.js        push/pull sync with PocketBase
  src/lib/image.js       downscale + EXIF/GPS strip before upload
  src/lib/tour.js        route geometry + scroll timeline for "Follow the route"
  src/lib/refs.js        "#T1" marker references in the navigation/log text
  src/lib/fitimport.js   Garmin .fit dive files → dive fields + depth profile
  src/lib/importmatch.js new dive / fill a hand-written one / already imported
  src/lib/clip.js        video clips → H.264 MP4 + poster frame, in the browser
  src/lib/media.js       picked files → photos or clips
  src/lib/app.svelte.js  reactive state, background sync, actions
  src/components/        UI (MapCanvas = Leaflet, MapScreen = editor,
                         TourPage = "Follow the route", ClipPlayer = a clip
                         in the tour)
  tests/sync.test.js     sync integration tests against a live server
  tests/tour.test.js     unit tests for the tour geometry
  tests/refs.test.js     unit tests for marker references
```

## Run locally

```bash
# 1. backend (download PocketBase 0.40.x for your OS into backend/)
cd backend
OWNER_EMAIL=you@example.com OWNER_PASSWORD='a-long-password' ./pocketbase serve

# 2. frontend dev server (proxies /api to :8090)
cd frontend
npm install
npm run dev            # http://localhost:5173

# production build goes into backend/pb_public, served at http://localhost:8090
npm run build
```

`OWNER_EMAIL` / `OWNER_PASSWORD` create your account on first start if it
doesn't exist; after that you can drop them. Signups are disabled, so nobody
else can create an account. The admin dashboard is at `/_/` (create a
superuser with `./pocketbase superuser upsert EMAIL PASS`).

### Tests

```bash
cd frontend && npm run build   # the browser tests use the built app
cd .. && ./scripts/test.sh      # unit, sync and browser tests on a throwaway server
./scripts/test.sh --unit        # just the fast unit tests, no server
```

`scripts/test.sh` starts PocketBase with the same folder layout as the Docker
image and a fresh database, then runs `frontend/tests/*.test.js` (Node) and
`frontend/e2e/*.spec.js` (Playwright). GitHub Actions runs the same script on
every push (`.github/workflows/test.yml`). In Railway, turn on **Wait for CI**
in the service settings so a push only deploys after the tests pass.

## Deploy

### From a phone: Railway (about $5/month)

Everything below is done in a phone browser; no terminal needed.

1. Put this project in a GitHub repository.
2. On railway.com, sign in with GitHub and pick the Hobby plan.
3. **New Project → Deploy from GitHub repo**, choose the repository. Railway
   finds the `Dockerfile` and builds it.
4. In the service's **Variables**, add:
   - `OWNER_EMAIL` your email (your login)
   - `OWNER_PASSWORD` a long password
   - `PORT` = `8090`
5. Add a **Volume** to the service with mount path `/pb/pb_data`. This is
   where the database and uploads live; without it, every redeploy starts
   empty.
6. **Settings → Networking → Generate Domain** (port 8090 if asked). You get
   an `https://….up.railway.app` address.
7. Open it on your phone, sign in, and use **Add to Home Screen** so it opens
   like an app and works offline.

On first start the app creates your login, plus the same login for the admin
dashboard at `/_/`. Changing `OWNER_PASSWORD` later doesn't change the
password; do that in the dashboard (Collections → users).

Every push to the repository redeploys automatically; the volume keeps your
data. Hobby includes up to 5 GB of volume storage, which fits thousands of
photos at the app's upload size. Clips take about 60 MB a minute, so they
fill it faster; when it gets tight, add a Railway **Bucket** and point
PocketBase at it in the dashboard (Settings → Files storage, S3). Buckets
cost a fraction of volume storage and go up to 1 TB on Hobby. Files already
uploaded need copying over once.

### Railway CDN

Railway's CDN (Settings → **Edge** → **Enable CDN Caching**, free) serves the
app's code, fonts and icons from a location near each visitor. The server
sends the caching headers it needs (`pb_hooks/main.pb.js`): hashed files are
cached for a year; the start page, service worker and manifest never at the
CDN, so updates reach phones right away; owner image links and everything
shared stay out of the CDN, so turning a share link off still works. Leave
HTML caching on **Auto** and purge-on-deploy at its default. To see which
CDN location serves you, open `/.railway/cdn-trace` on your app.

### Other hosts

The service worker (offline mode) needs HTTPS.

**Docker anywhere (Fly.io, a VPS…).** `docker build -t dive-diary .`, then
run it with persistent storage mounted at `/pb/pb_data` and the `OWNER_*`
variables set. It listens on `$PORT`, default 8090.

**Plain VPS without Docker.** Build the frontend, copy `backend/` (binary,
`pb_migrations`, `pb_hooks`, `pb_public`) to the server, point a domain at
it, and let PocketBase get a Let's Encrypt certificate itself:
`./pocketbase serve dives.example.com`. Run it under systemd.

### Backups

In the dashboard (`/_/`), **Settings → Backups**: turn on scheduled backups
to S3-compatible storage (Cloudflare R2, Backblaze B2). Uploads can go to
the same kind of storage under **Settings → Files storage** if you'd rather
not keep them on the volume.

## How things work

**Offline.** Every edit is written to IndexedDB first, with ids generated on
the device, so a dive, its maps and photos can all be created with no signal
and still reference each other. A sync runs a moment after each change, when
the connection comes back, when the app returns to the foreground, and every
two minutes. Push goes parents-first (dives, maps, photos) and deletes go
children-first. A record edited on the device is never overwritten by the
server until it has been pushed (last write wins; it's a single-user app).
Pulls are incremental: only records changed since the last sync are
downloaded, plus a list of ids to notice deletions.

If the server rejects a change (say, a value it doesn't accept), the record
keeps the reason and isn't sent again until it's edited, so a photo isn't
re-uploaded every few minutes. Its maps and photos wait for it instead of
failing too. The sync status then reads "N couldn't sync"; tapping it lists
each one with the reason and a link to fix it. Being offline, the server
restarting or the rate limit kicking in just pause the sync.

The app shell is precached by the service worker. Maps (full and preview) and photo thumbnails of
the current trip (the newest dive's trip, plus the 30 days before it) are
downloaded into the offline cache after each sync, so maps uploaded at home
open at the site; older dives work offline if they were opened before. A
full-size photo that isn't cached falls back to its thumbnail. The app asks
the browser to keep its data; on iPhone, Safari can still clear a website's
data after a week without a visit, so the app suggests adding it to the Home
Screen. Sign in once with a connection; sessions last 45 days and renew once
a day.

**Maps.** Map photos are downscaled to max 4000 px, photos to 2560 px, and
both are re-encoded as JPEG in the browser, which strips EXIF data including
GPS. Dive pages show a light preview of each map (fitted inside 1200 px,
roughly 8× smaller than a 4000 px map photo); the map viewer and the route
tour open on that preview and swap in the full map once it has downloaded.
Offline, if only the preview was kept, the viewer says so and shows it.
Markers are `{id, x, y, label, note}` and the route is a list of line
segments `[[{x, y}, ...], ...]`, all with x/y normalized to 0..1 from the
image's top-left, so they're independent of resolution. In Route mode,
tapping a marker adds a point exactly on it.

**Follow the route.** A dive with a drawn route gets a "Follow the route"
button (on the dive page and the map screen, for you and on share links). It
opens a full-screen page: the map stays fixed behind the text, and scrolling
moves a diver dot along the route while the camera follows. The route is
walked in the order the lines were drawn; a jump between lines is instant.
Every marker the route passes within 2.5% of the map's size becomes a
waypoint: the diver stops there while its card (label, note, photos) scrolls
past. Markers off the route are shown dimmed without a card. It opens with the
dive details and the navigation plan, and ends with the log and any photos
not attached to a waypoint. Several maps with routes play one after another.
Attach photos to a marker in the map editor (Markers mode, tap the marker,
then tap dive photos or upload new ones); markers with photos get a small dot.

**Marker references.** Write `#` and a marker's label in the navigation or
log text (`#T1`, `#3`, `#J-2`) and it becomes a link to that marker: on the
dive page it opens the right map zoomed to the marker with its note; inside
"Follow the route" it scrolls to that waypoint (or opens the map if the route
doesn't pass it). Case doesn't matter. Labels are matched across all of the
dive's maps; if two markers share a label, the first map wins. Anything that
doesn't match a marker, like "dive #99", stays plain text. In the editor,
focusing either text field shows the dive's markers as chips; tapping one
inserts the reference at the cursor. Labels can use letters, digits and
`. _ -` between them; a label like `A/1` can't be referenced.

**Importing dives (Garmin).** In the Garmin app, share a dive as a `.fit`
file (one file per dive), save it to Files, and pick it on **Import** (dive
list) or with **Add Garmin .fit file** on a dive you already wrote up. The file
is read in the browser with Garmin's FIT SDK (loaded only when importing, and
cached for offline use). It fills the date and time in the dive site's local
time, max and average depth, the lowest water temperature, underwater time,
dive number, gas (the starting mix plus any gas switched to), the computer
model and a depth profile of up to 360 points. GPS positions in the file are
left out on purpose. For a new dive, the site name is guessed from the file
name. A hand-written dive on the same day with a time in within 45 minutes
(or the only untimed dive that day) gets the computer's numbers and profile;
its site, notes and a gas you typed stay. Each import remembers its source
(`garmin:<start time>`), so importing the same file again is recognised.
The profile chart scrubs by touch, mouse or arrow keys and also shows on
share links. `tests/fixtures/make-dive-fit.mjs` writes the synthetic dives
the tests use.

**Plan beside the map.** The map screen has a **Plan** button that shows the
dive's navigation text over the map (open by default when editing your own
maps; the choice is remembered). `#T1` references in it select and zoom to
that marker. In Markers mode, labels the plan mentions that no map has yet
are listed; tap one, then tap the map, and the marker gets that label.

**Clips.** Short videos go in with photos (**Add photos or clips**, or the
`+` on a marker). Each is prepared on the device before it's saved, so it
works offline at the site too (the video tools, Mediabunny on the browser's
WebCodecs, load only when a clip is added and are cached for offline use):
H.264 video at up to 1080p is copied as is; anything else, such as the
HEVC that phones and the DJI app export, 4K or very high bitrates, is
re-encoded once to H.264 at up to 1080p and about 8 Mbit/s (about 60 MB a
minute; on real cave footage that kept the sand and silt detail that
5 Mbit/s smeared). Either way the file comes out as an MP4 with its index at
the front (playback starts at once) and none of the camera's or phone's
metadata, location included. Sound is kept; on a browser that can't encode
AAC, a clip whose sound isn't already AAC is added without it, and the app
says so. Converting needs Safari on iOS 26 or later, or Chrome; a browser
that can't read the source format says so. Up to 200 MB per clip (about 3
minutes at that bitrate).

A clip is a photos record with a `video` file; its `image` is a poster frame
taken from the result, so the grid, thumbnails, the offline cache and
marker attachments treat it like a photo. Clips show a play badge with
their length and play in the photo viewer. In "Follow the route", a clip
attached to a marker plays muted and on a loop while its card is on screen
and pauses when scrolled away (tap for sound; with reduced motion it waits
for a tap). Videos stream with range requests, through the share route for
family too, and aren't kept offline; offline, the viewer shows the poster
and says the clip needs a connection.

**Share links.** A share is a random 32-character token tied to a trip (or to
all dives). `GET /api/share/{token}` returns that trip's dives, maps and
photos without auth; the collections themselves stay owner-only. Image files
are protected: the owner app adds a file token (valid 48 hours, renewed every
12) and leaves it out of offline cache keys. Viewers get images through
`GET /api/share/{token}/file/{collection}/{id}/{name}`, which checks the link
on every request, so turning a link off stops its images straight away
(a browser may keep images it already showed for up to an hour). Expiry dates
end at midnight in the owner's time zone.

**Security settings** (migration `1762560000_hardening.js`): rate limiting is
on, with at most 5 sign-in attempts a minute per visitor address. Railway's
edge overwrites `X-Real-IP` with the visitor's address, so PocketBase is set
to trust that header; on a host that doesn't set it, change the trusted proxy
in the dashboard (Settings → Application), or every visitor shares one limit.

## Notes and limits

- Depth, temperature and run time are optional; 0 means "not filled in".
- Replacing a map image isn't supported. Add a new map and delete the old one.
- If a dive is deleted on another device while you edit it offline here, your
  version is recreated on sync (maps whose image already left this device
  can't be recreated and show as a sync error).
- Markdown works in the navigation and log fields.
- A clip can't be trimmed or replaced in the app; edit it in your camera's
  app first, and delete and re-add it to change it.
