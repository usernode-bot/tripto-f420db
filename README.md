# Tripto

Gardez une trace de chaque lieu visité. Tripto is a private travel journal:
each person keeps their own list of the places they have visited, each place
gets its own showcase page (cover photo, what to know about it, practical
info, personal notes, photo and video gallery), and places can be grouped
into travel albums.

- **Private by design** — every table (`places`, `media`, `albums`,
  `album_places`) carries `owner_id` and is marked `staging:private`; a
  person only ever sees their own journal. Guests see empty lists.
- **Photos** are uploaded through the platform's file storage (the bridge's
  `usernode.uploadFile`); the database keeps only the returned URL and file
  id. Large camera photos are shrunk client-side (longest side 2000 px,
  JPEG q0.85) before upload. The first photo is the cover until another is
  chosen.
- **Videos** are stored as links (YouTube, Google Photos, iCloud, any web
  address), because the platform's file storage holds images only. They show
  in the gallery as dark tiles and open in a new tab.
- **Albums** group places into trips. An album's cover comes from its first
  place by visit date and its dates span from its places, so there is
  nothing to keep in sync. Deleting an album keeps its places.
- **Staging demo** — on a staging preview opened with `?demo=1`, the first
  signed-in viewer gets their own demo journal written once (13 invented
  places over 2023–2026 in 6 countries, 3 albums, drawn SVG illustrations as
  photos, video links pointing at example.com). Everything works on it: add,
  edit, delete, upload, albums. A single banner at the top says the demo
  data is invented.

## Layout

- `server.js` — schema (applied idempotently on boot), the JSON API under
  `/api/*` (all routes filtered by `owner_id`), the staging demo seeder,
  graceful shutdown.
- `public/index.html` — the app shell (dev-console forwarder, Tailwind, the
  native UI kit, the bridge, the theme script).
- `public/app.js` — the whole front end: router, screens, photo pipeline.
- `styles/tailwind-input.css` + `tailwind.config.js` — the design kit
  (airmail palette, stamp/envelope/postmark/postcard components).
- `dapp.json` — app manifest and proposal tests.

## Rebuilding the stylesheet

`npm run build` (run by Docker or Paketo on every image build) compiles
`styles/tailwind-input.css` to `public/tailwind.css`.

## Changing this app

Ask Homeroom bot: open the app on Homeroom, tap the Homeroom icon in the
header, then **Suggest an improvement**. You can also run Claude Code
against this repo directly; start with `CLAUDE.md`, which carries the
app-specific notes and points at the platform rules.
