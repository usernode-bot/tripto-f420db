const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json({ limit: '200kb' }));

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Tripto data model ───────────────────────────────────────────────────────
// One person's private travel journal: every table carries owner_id and is
// marked staging:private, so staging copies the schema but none of the rows
// and no other person ever reads them. This app has no public table, so no
// public table points at a private one. Applied on boot, idempotently.
async function ensureSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS places (
      id SERIAL PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      about TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      visited_on DATE NOT NULL,
      kind TEXT NOT NULL DEFAULT 'autre',
      cover_media_id INTEGER,
      demo_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS places_owner_demo_key ON places (owner_id, demo_key)`,
    `CREATE INDEX IF NOT EXISTS places_owner_visited ON places (owner_id, visited_on DESC, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      owner_id TEXT,
      kind TEXT CHECK (kind IN ('photo','video')),
      url TEXT NOT NULL,
      file_id TEXT,
      width INTEGER,
      height INTEGER,
      caption TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS media_place ON media (place_id, position, id)`,
    `CREATE TABLE IF NOT EXISTS albums (
      id SERIAL PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      demo_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS albums_owner_demo_key ON albums (owner_id, demo_key)`,
    `CREATE TABLE IF NOT EXISTS album_places (
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (album_id, place_id)
    )`,
    `CREATE TABLE IF NOT EXISTS demo_seeded (
      owner_id TEXT PRIMARY KEY,
      seeded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  ];
  for (const sql of stmts) await pool.query(sql);
  for (const t of ['places', 'media', 'albums', 'album_places', 'demo_seeded']) {
    await pool.query(`COMMENT ON TABLE ${t} IS 'staging:private'`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const KINDS = ['ville', 'monument', 'musee', 'nature', 'plage', 'montagne', 'restaurant', 'autre'];
const now_ = (req) => req.now || new Date();
// Whose journal this request reads or writes: null for a guest, whose reads
// then answer empty lists and 404s and whose writes the middleware refuses.
const ownerId = (req) => (req.user ? String(req.user.id) : null);

function bad(res, field, message) {
  return res.status(400).json({ error: message, field });
}

// A date a person typed: YYYY-MM-DD, a real day, not in the future — the app
// records places already visited.
function validVisitedOn(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false;
  return value <= today;
}

// Validate the place fields a write carries. Returns { fields } or { error }.
function readPlaceFields(body, { partial, today }) {
  const fields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: { field: 'name', message: 'Donnez un nom au lieu.' } };
    if (name.length > 120) return { error: { field: 'name', message: 'Le nom est trop long.' } };
    fields.name = name;
  }
  for (const [key, max] of [['city', 80], ['country', 80], ['address', 200]]) {
    if (!partial || has(key)) {
      const v = typeof body[key] === 'string' ? body[key].trim() : '';
      if (v.length > max) return { error: { field: key, message: 'Texte trop long.' } };
      fields[key] = v;
    }
  }
  for (const key of ['about', 'notes']) {
    if (!partial || has(key)) {
      const v = typeof body[key] === 'string' ? body[key] : '';
      if (v.length > 4000) return { error: { field: key, message: 'Texte trop long.' } };
      fields[key] = v;
    }
  }
  if (!partial || has('kind')) {
    if (!KINDS.includes(body.kind)) return { error: { field: 'kind', message: 'Type de lieu inconnu.' } };
    fields.kind = body.kind;
  }
  if (!partial || has('visited_on')) {
    if (!validVisitedOn(body.visited_on, today)) {
      return { error: { field: 'visited_on', message: 'Choisissez une date passée ou d’aujourd’hui.' } };
    }
    fields.visited_on = body.visited_on;
  }
  return { fields };
}

// The cover rule: cover_media_id when it still names one of the place's
// photos, else the photo with the lowest (position, id), else none (the
// stamp then shows the place type's icon).
const PLACE_LIST_COLUMNS = `
  p.id, p.name, p.city, p.country, p.visited_on::text AS visited_on, p.kind,
  COALESCE(
    (SELECT m.url FROM media m WHERE m.id = p.cover_media_id AND m.kind = 'photo'),
    (SELECT m2.url FROM media m2 WHERE m2.place_id = p.id AND m2.kind = 'photo'
      ORDER BY m2.position ASC, m2.id ASC LIMIT 1)
  ) AS cover_url,
  (SELECT count(*) FROM media w WHERE w.place_id = p.id AND w.kind = 'photo')::int AS photo_count,
  (SELECT count(*) FROM media w WHERE w.place_id = p.id AND w.kind = 'video')::int AS video_count`;

async function getPlacePayload(req, id) {
  const owner = ownerId(req);
  if (!owner) return null;
  const { rows: [place] } = await pool.query(
    `SELECT p.id, p.name, p.city, p.country, p.address, p.about, p.notes,
            p.visited_on::text AS visited_on, p.kind, p.cover_media_id,
            ${PLACE_LIST_COLUMNS}
     FROM places p WHERE p.id = $1 AND p.owner_id = $2`,
    [id, owner]
  );
  if (!place) return null;
  const { rows: media } = await pool.query(
    `SELECT id, kind, url, file_id, width, height, caption, position
     FROM media WHERE place_id = $1 ORDER BY position ASC, id ASC`,
    [id]
  );
  const { rows: albums } = await pool.query(
    `SELECT a.id, a.name FROM albums a
     JOIN album_places ap ON ap.album_id = a.id
     WHERE ap.place_id = $1 ORDER BY a.name ASC`,
    [id]
  );
  return { ...place, media, albums };
}

// ── The API ─────────────────────────────────────────────────────────────────
const api = express.Router();

api.get('/me', (req, res) => {
  res.json({
    signedIn: !!req.user,
    staging: IS_STAGING,
    today: now_(req).toISOString().slice(0, 10),
  });
});

api.get('/places', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.json({ places: [], stats: { places: 0, countries: 0 } });
    const { rows } = await pool.query(
      `SELECT ${PLACE_LIST_COLUMNS} FROM places p
       WHERE p.owner_id = $1 ORDER BY p.visited_on DESC, p.created_at DESC`,
      [owner]
    );
    const { rows: [{ countries }] } = await pool.query(
      `SELECT count(DISTINCT lower(country))::int AS countries
       FROM places WHERE owner_id = $1 AND country <> ''`,
      [owner]
    );
    res.json({ places: rows, stats: { places: rows.length, countries } });
  } catch (err) { next(err); }
});

api.post('/places', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const today = now_(req).toISOString().slice(0, 10);
    const { fields, error } = readPlaceFields(req.body || {}, { partial: false, today });
    if (error) return bad(res, error.field, error.message);
    const { rows: [place] } = await pool.query(
      `INSERT INTO places (owner_id, name, city, country, address, about, notes, visited_on, kind, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
      [owner, fields.name, fields.city, fields.country, fields.address, fields.about,
        fields.notes, fields.visited_on, fields.kind, now_(req)]
    );
    res.status(201).json({ place: await getPlacePayload(req, place.id) });
  } catch (err) { next(err); }
});

api.get('/places/:id', async (req, res, next) => {
  try {
    const place = await getPlacePayload(req, req.params.id);
    if (!place) return res.status(404).json({ error: 'Not found' });
    res.json({ place });
  } catch (err) { next(err); }
});

api.patch('/places/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const today = now_(req).toISOString().slice(0, 10);
    const { fields, error } = readPlaceFields(req.body || {}, { partial: true, today });
    if (error) return bad(res, error.field, error.message);
    const keys = Object.keys(fields);
    if (!keys.length) return bad(res, 'name', 'Rien à enregistrer.');
    const params = [req.params.id, now_(req), ...keys.map((k) => fields[k]), owner];
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rowCount } = await pool.query(
      `UPDATE places SET ${sets}, updated_at = $2
       WHERE id = $1 AND owner_id = $${params.length}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ place: await getPlacePayload(req, req.params.id) });
  } catch (err) { next(err); }
});

api.delete('/places/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      `SELECT file_id FROM media WHERE place_id = $1 AND kind = 'photo' AND file_id IS NOT NULL`,
      [req.params.id]
    );
    // Deleting the place cascades to its media rows and album memberships.
    const { rowCount } = await pool.query(
      `DELETE FROM places WHERE id = $1 AND owner_id = $2`, [req.params.id, owner]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ file_ids: rows.map((r) => r.file_id) });
  } catch (err) { next(err); }
});

// Media rows: photos (uploaded through the bridge, whose URL and file id are
// all the database ever holds) and videos (links, since the platform's file
// storage holds images only).
api.post('/places/:id/media', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!/^https:\/\//.test(url) || url.length > 2000) {
      return bad(res, 'url', 'Adresse de média invalide.');
    }
    let width = null, height = null, file_id = null;
    if (body.kind === 'photo') {
      file_id = typeof body.file_id === 'string' ? body.file_id : null;
      width = Number.isInteger(body.width) ? body.width : null;
      height = Number.isInteger(body.height) ? body.height : null;
    } else if (body.kind !== 'video') {
      return bad(res, 'kind', 'Type de média inconnu.');
    }
    const owned = await pool.query(
      `SELECT 1 FROM places WHERE id = $1 AND owner_id = $2`, [req.params.id, owner]
    );
    if (!owned.rowCount) return res.status(404).json({ error: 'Not found' });
    const { rows: [{ next_pos }] } = await pool.query(
      `SELECT COALESCE(max(position), 0) + 1 AS next_pos FROM media WHERE place_id = $1`,
      [req.params.id]
    );
    const { rows: [media] } = await pool.query(
      `INSERT INTO media (place_id, owner_id, kind, url, file_id, width, height, caption, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', $8, $9) RETURNING id, kind, url, file_id, width, height, caption, position`,
      [req.params.id, owner, body.kind, url, file_id, width, height, next_pos, now_(req)]
    );
    res.status(201).json({ media });
  } catch (err) { next(err); }
});

api.patch('/media/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const caption = typeof (req.body || {}).caption === 'string' ? req.body.caption : '';
    if (caption.length > 300) return bad(res, 'caption', 'Légende trop longue.');
    const { rows: [media] } = await pool.query(
      `UPDATE media SET caption = $3 WHERE id = $1 AND owner_id = $2
       RETURNING id, kind, url, file_id, width, height, caption, position`,
      [req.params.id, owner, caption]
    );
    if (!media) return res.status(404).json({ error: 'Not found' });
    res.json({ media });
  } catch (err) { next(err); }
});

api.delete('/media/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const { rows: [media] } = await pool.query(
      `DELETE FROM media WHERE id = $1 AND owner_id = $2 RETURNING file_id, place_id`,
      [req.params.id, owner]
    );
    if (!media) return res.status(404).json({ error: 'Not found' });
    if (media.file_id) {
      // The cover may have pointed at the deleted photo: fall back to the
      // next photo (the list query's COALESCE already does).
      await pool.query(
        `UPDATE places SET cover_media_id = NULL, updated_at = $3
         WHERE id = $1 AND cover_media_id = $2`,
        [media.place_id, req.params.id, now_(req)]
      );
      // Cover cleared: point it at the next remaining photo, if any.
      await pool.query(
        `UPDATE places p SET cover_media_id = (
           SELECT m.id FROM media m WHERE m.place_id = p.id AND m.kind = 'photo'
           ORDER BY m.position ASC, m.id ASC LIMIT 1), updated_at = $3
         WHERE p.id = $1 AND p.cover_media_id IS NULL`,
        [media.place_id, req.params.id, now_(req)]
      );
    }
    res.json({ file_id: media.file_id });
  } catch (err) { next(err); }
});

api.put('/places/:id/cover', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const mediaId = (req.body || {}).media_id;
    if (!Number.isInteger(mediaId)) return bad(res, 'media_id', 'Photo inconnue.');
    const owned = await pool.query(
      `SELECT 1 FROM media m JOIN places p ON p.id = m.place_id
       WHERE m.id = $1 AND m.place_id = $2 AND m.kind = 'photo' AND p.owner_id = $3`,
      [mediaId, req.params.id, owner]
    );
    if (!owned.rowCount) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      `UPDATE places SET cover_media_id = $3, updated_at = $4 WHERE id = $1 AND owner_id = $2`,
      [req.params.id, owner, mediaId, now_(req)]
    );
    res.json({ place: await getPlacePayload(req, req.params.id) });
  } catch (err) { next(err); }
});

api.put('/places/:id/albums', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const ids = Array.isArray((req.body || {}).album_ids)
      ? req.body.album_ids.filter(Number.isInteger) : [];
    const owned = await pool.query(
      `SELECT 1 FROM places WHERE id = $1 AND owner_id = $2`, [req.params.id, owner]
    );
    if (!owned.rowCount) return res.status(404).json({ error: 'Not found' });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM album_places WHERE place_id = $1`, [req.params.id]);
      if (ids.length) {
        await c.query(
          `INSERT INTO album_places (album_id, place_id)
           SELECT a.id, $2 FROM albums a WHERE a.owner_id = $3 AND a.id = ANY($1::int[])
           ON CONFLICT DO NOTHING`,
          [ids, req.params.id, owner]
        );
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    res.json({ place: await getPlacePayload(req, req.params.id) });
  } catch (err) { next(err); }
});

const ALBUM_LIST_COLUMNS = `
  a.id, a.name, a.description,
  min(p.visited_on)::text AS first_visit,
  max(p.visited_on)::text AS last_visit,
  count(DISTINCT p.id)::int AS place_count,
  count(DISTINCT m.id)::int AS photo_count,
  (SELECT m2.url FROM album_places ap2
     JOIN places p2 ON p2.id = ap2.place_id
     JOIN media m2 ON m2.place_id = p2.id AND m2.kind = 'photo'
     WHERE ap2.album_id = a.id
     ORDER BY p2.visited_on ASC, m2.position ASC, m2.id ASC
     LIMIT 1) AS cover_url`;

api.get('/albums', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.json({ albums: [] });
    const { rows } = await pool.query(
      `SELECT ${ALBUM_LIST_COLUMNS} FROM albums a
       LEFT JOIN album_places ap ON ap.album_id = a.id
       LEFT JOIN places p ON p.id = ap.place_id
       LEFT JOIN media m ON m.place_id = p.id AND m.kind = 'photo'
       WHERE a.owner_id = $1
       GROUP BY a.id
       ORDER BY max(p.visited_on) DESC NULLS LAST, a.created_at DESC`,
      [owner]
    );
    res.json({ albums: rows });
  } catch (err) { next(err); }
});

api.post('/albums', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return bad(res, 'name', 'Donnez un nom à l’album.');
    if (name.length > 80) return bad(res, 'name', 'Le nom est trop long.');
    const description = typeof body.description === 'string' ? body.description : '';
    if (description.length > 1000) return bad(res, 'description', 'Texte trop long.');
    const { rows: [album] } = await pool.query(
      `INSERT INTO albums (owner_id, name, description, created_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [owner, name, description, now_(req)]
    );
    res.status(201).json({ album: await getAlbumPayload(req, album.id) });
  } catch (err) { next(err); }
});

async function getAlbumPayload(req, id) {
  const owner = ownerId(req);
  if (!owner) return null;
  const { rows: [album] } = await pool.query(
    `SELECT a.id, a.name, a.description FROM albums a WHERE a.id = $1 AND a.owner_id = $2`,
    [id, owner]
  );
  if (!album) return null;
  const { rows: places } = await pool.query(
    `SELECT ${PLACE_LIST_COLUMNS} FROM places p
     JOIN album_places ap ON ap.place_id = p.id
     WHERE ap.album_id = $1 AND p.owner_id = $2
     ORDER BY p.visited_on DESC, p.created_at DESC`,
    [id, owner]
  );
  const { rows: [{ countries }] } = await pool.query(
    `SELECT count(DISTINCT lower(p.country))::int AS countries
     FROM places p JOIN album_places ap ON ap.place_id = p.id
     WHERE ap.album_id = $1 AND p.owner_id = $2 AND p.country <> ''`,
    [id, owner]
  );
  const photo_count = places.reduce((n, pl) => n + pl.photo_count, 0);
  return {
    ...album,
    places,
    place_count: places.length,
    photo_count,
    countries,
    first_visit: places.length ? places[places.length - 1].visited_on : null,
    last_visit: places.length ? places[0].visited_on : null,
  };
}

api.get('/albums/:id', async (req, res, next) => {
  try {
    const album = await getAlbumPayload(req, req.params.id);
    if (!album) return res.status(404).json({ error: 'Not found' });
    res.json({ album });
  } catch (err) { next(err); }
});

api.patch('/albums/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const fields = {};
    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return bad(res, 'name', 'Donnez un nom à l’album.');
      if (name.length > 80) return bad(res, 'name', 'Le nom est trop long.');
      fields.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const d = typeof body.description === 'string' ? body.description : '';
      if (d.length > 1000) return bad(res, 'description', 'Texte trop long.');
      fields.description = d;
    }
    const keys = Object.keys(fields);
    if (!keys.length) return bad(res, 'name', 'Rien à enregistrer.');
    const params = [req.params.id, ...keys.map((k) => fields[k]), owner];
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rowCount } = await pool.query(
      `UPDATE albums SET ${sets} WHERE id = $1 AND owner_id = $${params.length}`, params
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ album: await getAlbumPayload(req, req.params.id) });
  } catch (err) { next(err); }
});

api.delete('/albums/:id', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    // The album's memberships cascade; its places stay.
    const { rowCount } = await pool.query(
      `DELETE FROM albums WHERE id = $1 AND owner_id = $2`, [req.params.id, owner]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

api.put('/albums/:id/places', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: 'Not found' });
    const ids = Array.isArray((req.body || {}).place_ids)
      ? req.body.place_ids.filter(Number.isInteger) : [];
    const owned = await pool.query(
      `SELECT 1 FROM albums WHERE id = $1 AND owner_id = $2`, [req.params.id, owner]
    );
    if (!owned.rowCount) return res.status(404).json({ error: 'Not found' });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM album_places WHERE album_id = $1`, [req.params.id]);
      if (ids.length) {
        // Places another person owns are ignored, not an error.
        await c.query(
          `INSERT INTO album_places (album_id, place_id)
           SELECT $1, p.id FROM places p WHERE p.owner_id = $2 AND p.id = ANY($3::int[])
           ON CONFLICT DO NOTHING`,
          [req.params.id, owner, ids]
        );
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    res.json({ album: await getAlbumPayload(req, req.params.id) });
  } catch (err) { next(err); }
});

// ── The staging demo (?demo=1) ──────────────────────────────────────────────
// The first version's populated preview: on the viewer's first POST /api/demo
// in staging, their own journal is written once — 13 places over 2023-2026 in
// 6 countries, drawn illustrations as photos, 3 albums. Reloads change
// nothing (demo_seeded), and edits and deletes the viewer makes stay.

// Small drawn SVG illustrations standing in for photos: a sky, a sun and two
// land/sea bands, coloured per scene with a little variation per index.
function demoArt(scene, variant) {
  const palettes = {
    sea: { sky: ['#b9d3ea', '#e8f1f8'], main: '#2f6f9f', base: '#3f86b5' },
    sand: { sky: ['#bfe0f0', '#eaf5fa'], main: '#3a8fb5', base: '#e8d6a8' },
    city: { sky: ['#f2d3b0', '#faeeda'], main: '#c97b4a', base: '#7b4a33' },
    green: { sky: ['#cfe3ee', '#eef5f2'], main: '#6f9a5a', base: '#3f6b3c' },
    mount: { sky: ['#dfe8f2', '#f2f6fa'], main: '#7d8ea3', base: '#4e6176' },
    stone: { sky: ['#cfe0ee', '#e9f1f8'], main: '#d9c7a3', base: '#2f6f9f' },
    red: { sky: ['#e9c79a', '#f6e8d2'], main: '#c0583a', base: '#9c4530' },
    blue: { sky: ['#e6eef5', '#f4f8fb'], main: '#2a5d8f', base: '#e2c48a' },
  };
  const p = palettes[scene] || palettes.city;
  const v = (variant || 0) % 3;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/>` +
    `</linearGradient></defs>` +
    `<rect width="400" height="400" fill="url(#s)"/>` +
    `<circle cx="${110 + v * 70}" cy="${84 + v * 12}" r="${30 + v * 4}" fill="#ffffff" opacity=".75"/>` +
    `<path d="M0 ${232 + v * 12} Q ${100 + v * 25} ${176 + v * 12} 205 ${224 + v * 10} T 400 ${214 + v * 10} V400 H0 Z" fill="${p.main}"/>` +
    `<path d="M0 ${286 + v * 8} Q ${128 - v * 28} ${252 + v * 10} 242 ${296 + v * 6} T 400 ${280 + v * 6} V400 H0 Z" fill="${p.base}"/>` +
    `</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const DEMO_PLACES = [
  { key: 'calanques', name: 'Calanque de Sormiou', city: 'Marseille', country: 'France', kind: 'nature', visited_on: '2026-09-14', address: '', scene: 'sea', photos: 6, videos: 0, about: 'Une crique entre les falaises blanches, eau turquoise et pins au-dessus. L’accès se fait par une piste poussiéreuse, mieux à pied.', notes: 'On s’est baignés tôt le matin, l’eau était encore fraîche. Apéritif sur les rochers en descendant.' },
  { key: 'belem', name: 'Tour de Belém', city: 'Lisbonne', country: 'Portugal', kind: 'monument', visited_on: '2026-05-12', address: 'Av. Brasília, Belém', scene: 'stone', photos: 8, videos: 1, about: 'Tour fortifiée du XVIe siècle posée au bord du Tage, d’où partaient les navigateurs. On monte par un escalier en colimaçon très étroit jusqu’à la terrasse, avec une vue sur l’estuaire.', notes: 'Arrivés tôt pour éviter la file. Le vent soufflait fort en haut de la tour, et on a fini par un pique-nique sur les marches du quai.' },
  { key: 'pasteis', name: 'Pastéis de Belém', city: 'Lisbonne', country: 'Portugal', kind: 'restaurant', visited_on: '2026-05-12', address: 'R. de Belém 84-92', scene: 'red', photos: 2, videos: 0, about: 'La pâtisserie d’origine des pasteis de nata, ouverte depuis 1837. Les paceños se mangent tièdes, saupoudrés de sucre et de cannelle.', notes: 'File d’attente jusqu’à la rue, mais ça avance vite. Trois nata chacun, et un café.' },
  { key: 'alfama', name: 'Quartier de l’Alfama', city: 'Lisbonne', country: 'Portugal', kind: 'ville', visited_on: '2026-05-11', address: '', scene: 'city', photos: 5, videos: 0, about: 'Le vieux quartier au-dessous du château : ruelles escarpées, façades d’azulejos, lessive aux fenêtres et tramway 28 qui klaxonne au tournant.', notes: 'Perdus une heure dans les ruelles, on a suivi le son d’un fado jusqu’à une petite place.' },
  { key: 'skye', name: 'Île de Skye', city: 'Écosse', country: 'Royaume-Uni', kind: 'nature', visited_on: '2025-08-23', address: '', scene: 'green', photos: 12, videos: 2, about: 'Paysages de lave et de tourbe : falaises de Neist Point, old man of Storr, lochs mauves sous une lumière qui change d’heure en heure.', notes: 'Quatre saisons en une journée, comme dit la météo locale. Le Pont noir valait le détour malgré la pluie.' },
  { key: 'eilean', name: 'Château d’Eilean Donan', city: 'Dornie', country: 'Royaume-Uni', kind: 'monument', visited_on: '2025-08-21', address: '', scene: 'blue', photos: 4, videos: 0, about: 'Le château sur son îlot à la jonction de trois lochs, reconstruit au XXe siècle. Photogénique à marée haute comme à marée basse.', notes: 'Photo faite depuis le pont au lever du jour, avant les cars. Café dans le village d’à côté.' },
  { key: 'edinburgh', name: 'Vieille ville d’Édimbourg', city: 'Édimbourg', country: 'Royaume-Uni', kind: 'ville', visited_on: '2025-08-18', address: 'Royal Mile', scene: 'city', photos: 7, videos: 0, about: 'La Royal Mile descend du château au palais de Holyrood entre hauts immeubles noirs d’or, cours cachées et ruelles (closes) en pente.', notes: 'Le château à l’ouverture, puis marche le long de la Mile jusqu’au palais. Nuit tombée, la ville est magnifique.' },
  { key: 'aiguille', name: 'Aiguille du Midi', city: 'Chamonix', country: 'France', kind: 'montagne', visited_on: '2025-03-02', address: '', scene: 'mount', photos: 3, videos: 0, about: 'Téléphérique jusqu’à 3 842 m, face au mont Blanc. Le pas dans le vide, une cage de verre au-dessus du vide, vaut d’avoir le cœur bien accroché.', notes: 'Froid polaire, ciel parfait. On a vu les alpinistes partir sur l’arête, corde en main.' },
  { key: 'balos', name: 'Lagon de Balos', city: 'Crète', country: 'Grèce', kind: 'plage', visited_on: '2024-07-09', address: '', scene: 'sand', photos: 9, videos: 1, about: 'Un lagon aux eaux peu profondes, rose et turquoise, au bout d’une piste de poussière et d’un sentier de chèvres. Venir tôt ou en fin de journée.', notes: 'L’eau était incroyable, chaude comme un bain. La piste de poussière, à refaire en 4x4 la prochaine fois.' },
  { key: 'knossos', name: 'Palais de Cnossos', city: 'Héraklion', country: 'Grèce', kind: 'monument', visited_on: '2024-07-06', address: '', scene: 'red', photos: 5, videos: 0, about: 'Le centre de la civilisation minoenne, daté de plus de 3 500 ans. Les fresques reconstituées divisent les archéologues, mais les salles des taureaux ne se discutent pas.', notes: 'Chaleur écrasante à midi, visite ombre à ombre. Le musée d’Héraklion le soir complète bien.' },
  { key: 'guggenheim', name: 'Musée Guggenheim', city: 'Bilbao', country: 'Espagne', kind: 'musee', visited_on: '2024-04-19', address: '', scene: 'city', photos: 0, videos: 0, about: 'Les volutes de titane de Frank Gehry au bord de la Nervion, et le puppy de fleurs devant l’entrée. La collection tourne autour de l’art contemporain.', notes: 'Le bâtiment est aussi la visite. On est ressortis par la lumière du soir sur les rives.' },
  { key: 'verdon', name: 'Gorges du Verdon', city: 'Provence', country: 'France', kind: 'nature', visited_on: '2023-10-15', address: '', scene: 'sea', photos: 6, videos: 0, about: 'Le grand canyon d’Europe : falaises calcaires de 700 m au-dessus d’une rivière émeraude. La route des crêtes offre des belvédères tous les deux kilomètres.', notes: 'Kayak sur le lac de Sainte-Croix l’après-midi. Les routes en lacets demandent un bon conducteur.' },
  { key: 'majorelle', name: 'Jardin Majorelle', city: 'Marrakech', country: 'Maroc', kind: 'nature', visited_on: '2023-02-03', address: '', scene: 'green', photos: 4, videos: 0, about: 'Le jardin bleu de Yves Saint Laurent et Pierre Bergé : bambous, cactus et ce bleu cobalt qui porte le nom du peintre qui l’a bâti.', notes: 'Billets pris en ligne la veille, entrée immédiate. Le bleu vaut tous les filtres.' },
];

const DEMO_ALBUMS = [
  { key: 'lisbonne', name: 'Week-end à Lisbonne', description: 'Trois jours à Lisbonne en mai : Belém, l’Alfama et les pastéis.', places: ['belem', 'pasteis', 'alfama'] },
  { key: 'ecosse', name: 'Road trip en Écosse', description: 'Une semaine de route entre lochs et falaises, en août.', places: ['skye', 'eilean', 'edinburgh'] },
  { key: 'crete', name: 'Été en Crète', description: 'Lagon de Balos, palais minoen et tavernes.', places: ['balos', 'knossos'] },
];

async function seedDemo(req, owner) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `INSERT INTO demo_seeded (owner_id, seeded_at) VALUES ($1, $2)
       ON CONFLICT (owner_id) DO NOTHING RETURNING owner_id`,
      [owner, now_(req)]
    );
    if (!rows.length) {
      await c.query('ROLLBACK');
      return { seeded: false };
    }
    const ids = {};
    for (const dp of DEMO_PLACES) {
      const { rows: [place] } = await c.query(
        `INSERT INTO places (owner_id, name, city, country, address, about, notes, visited_on, kind, demo_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (owner_id, demo_key) DO NOTHING RETURNING id`,
        [owner, dp.name, dp.city, dp.country, dp.address, dp.about, dp.notes,
          dp.visited_on, dp.kind, dp.key, now_(req)]
      );
      if (!place) continue;
      ids[dp.key] = place.id;
      const media = [];
      for (let i = 0; i < dp.photos; i++) {
        media.push({ kind: 'photo', url: demoArt(dp.scene, i + 1) });
      }
      // Videos as links: the platform's file storage holds images only.
      for (let i = 0; i < dp.videos; i++) {
        media.splice(Math.max(1, Math.floor(dp.photos / 2)), 0,
          { kind: 'video', url: `https://example.com/videos/${dp.key}-${i + 1}` });
      }
      for (let i = 0; i < media.length; i++) {
        await c.query(
          `INSERT INTO media (place_id, owner_id, kind, url, caption, position, created_at)
           VALUES ($1, $2, $3, $4, '', $5, $6)`,
          [place.id, owner, media[i].kind, media[i].url, i, now_(req)]
        );
      }
    }
    for (const al of DEMO_ALBUMS) {
      const { rows: [album] } = await c.query(
        `INSERT INTO albums (owner_id, name, description, demo_key, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_id, demo_key) DO NOTHING RETURNING id`,
        [owner, al.name, al.description, al.key, now_(req)]
      );
      if (!album) continue;
      for (const key of al.places) {
        if (!ids[key]) continue;
        await c.query(
          `INSERT INTO album_places (album_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [album.id, ids[key]]
        );
      }
    }
    await c.query('COMMIT');
    return { seeded: true };
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

api.post('/demo', async (req, res, next) => {
  try {
    const owner = ownerId(req);
    if (!IS_STAGING || !owner) return res.json({ seeded: false });
    res.json(await seedDemo(req, owner));
  } catch (err) { next(err); }
});

api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erreur serveur.' });
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/tripto-f420db/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/tripto-f420db/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await ensureSchema();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;
  // Stop accepting, drain the in-flight requests, close the pool, exit.
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => pool.end().then(() => process.exit(0)));
    // Keep-alive sockets that never drain still end the process.
    setTimeout(() => pool.end().then(() => process.exit(0)), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch(err => { console.error(err); process.exit(1); });
