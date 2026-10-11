/* Tripto — the whole front end.
 *
 * Screens: / (Mes lieux), /albums, /albums/:id, /lieux/:id,
 * /lieux/:id/modifier, /nouveau. History API routing; the server's catch-all
 * serves index.html for every GET path, so deep links work on reload.
 * Everything the app shows is in French.
 */
(() => {
  'use strict';

  const app = document.getElementById('app');

  // ── Boot parameters ──────────────────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const TOKEN = params.get('token');
  const DEMO = params.get('demo') === '1';
  let ME = { signedIn: false, staging: false, today: new Date().toISOString().slice(0, 10) };
  let demoSeeded = false;

  // ── API client ───────────────────────────────────────────────────────────
  // The token read from ?token= once on load is forwarded on every call; at
  // the app's own address the edge adds the header itself.
  function withDemo(path) {
    if (!DEMO) return path;
    return path + (path.includes('?') ? '&' : '?') + 'demo=1';
  }

  async function api(path, opts = {}) {
    const headers = {};
    if (TOKEN) headers['x-usernode-token'] = TOKEN;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(withDemo(path), {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'HTTP ' + res.status);
      err.status = res.status;
      err.field = data && data.field;
      throw err;
    }
    return data;
  }

  // ── Small helpers ────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const svg = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

  const ICONS = {
    mark: svg('<rect x="4" y="3" width="16" height="18" rx="1" stroke-dasharray="2 2"/><path d="M12 16s-4-3.4-4-6.4a4 4 0 0 1 8 0c0 3-4 6.4-4 6.4z"/><circle cx="12" cy="9.6" r="1.3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    play: svg('<path d="M8 5l11 7-11 7z"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    trash: svg('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5"/>'),
    edit: svg('<path d="M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20z"/>'),
    link: svg('<path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>'),
    check: svg('<path d="M5 13l4 4L19 7"/>'),
    map: svg('<path d="M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z"/><circle cx="12" cy="10.6" r="2"/>'),
    ville: svg('<path d="M4 21V8l5-3v16M9 21V11l6-3v13M15 21v-8h5v8M3 21h18"/><path d="M6 11h1M6 15h1M12 12h1M12 16h1M17 16h1"/>'),
    monument: svg('<path d="M9 21V9l3-5 3 5v12"/><path d="M6 21h12"/><path d="M9 13h6"/>'),
    musee: svg('<path d="M4 10h16M12 3l8 7H4l8-7z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8M3 21h18"/>'),
    nature: svg('<path d="M12 3l5 7h-3l4 6H6l4-6H7l5-7z"/><path d="M12 16v5"/>'),
    plage: svg('<path d="M12 4a9 9 0 0 1 9 8H3a9 9 0 0 1 9-8z"/><path d="M12 12v8"/><path d="M12 20c0 0-2 1-3.5 0"/>'),
    montagne: svg('<path d="M3 19l6-10 4 6 3-4 5 8H3z"/>'),
    restaurant: svg('<path d="M7 3v18M4 3v5a3 3 0 0 0 6 0V3"/><path d="M17 3c-1.5 1.5-1.5 5 0 6.5V21"/>'),
    autre: svg('<path d="M4 4h7l9 9-7 7-9-9V4z"/><circle cx="8" cy="8" r="1.3"/>'),
  };
  const icon = (name, cls) => `<span class="${cls || 'ic-20'}">${ICONS[name] || ICONS.autre}</span>`;

  const KINDS = ['ville', 'monument', 'musee', 'nature', 'plage', 'montagne', 'restaurant', 'autre'];
  const KIND_LABELS = {
    ville: 'Ville', monument: 'Monument', musee: 'Musée', nature: 'Nature',
    plage: 'Plage', montagne: 'Montagne', restaurant: 'Restaurant', autre: 'Autre',
  };

  // ── French dates, without time-zone shifts ───────────────────────────────
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtFull = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtMonthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const asUTC = (d) => new Date(d + 'T12:00:00Z');
  const dayLabel = (d) => fmtDay.format(asUTC(d));
  const fullLabel = (d) => fmtFull.format(asUTC(d));
  const monthYear = (d) => cap(fmtMonthYear.format(asUTC(d)));

  // Album span: one month gives "Mai 2026", one year gives "2025",
  // otherwise "2024 à 2025".
  function albumSpan(a) {
    if (!a.first_visit || !a.last_visit) return '';
    const f = a.first_visit, l = a.last_visit;
    if (f.slice(0, 7) === l.slice(0, 7)) return monthYear(f);
    if (f.slice(0, 4) === l.slice(0, 4)) return f.slice(0, 4);
    return f.slice(0, 4) + ' à ' + l.slice(0, 4);
  }

  const pl = (n, one, many) => (n === 1 ? '1 ' + one : n + ' ' + many);
  function countsText(p) {
    const bits = [];
    if (p.photo_count > 0) bits.push(pl(p.photo_count, 'photo', 'photos'));
    if (p.video_count > 0) bits.push(pl(p.video_count, 'vidéo', 'vidéos'));
    return bits.length ? bits.join(', ') : 'Aucune photo';
  }
  function locationText(p) {
    return [p.city, p.country].filter(Boolean).join(', ');
  }

  const mapUrl = (p) => 'https://www.openstreetmap.org/search?query=' +
    encodeURIComponent([p.address, p.city, p.country].filter(Boolean).join(', '));

  // ── Native kit wrappers (with plain fallbacks outside the shell) ─────────
  const hasNative = () => !!(window.unNative && window.unNative.alert);
  function toast(msg) {
    if (window.unNative && window.unNative.toast) window.unNative.toast(msg);
  }
  async function confirmDialog(title, message, confirmLabel) {
    if (window.unNative && window.unNative.alert) {
      const r = await window.unNative.alert({
        title, message,
        buttons: [
          { label: 'Annuler', style: 'cancel' },
          { label: confirmLabel, style: 'destructive' },
        ],
      });
      return !!(r && r.button && r.button.label === confirmLabel);
    }
    return window.confirm((title ? title + ' ' : '') + (message || ''));
  }

  // ── Routing ──────────────────────────────────────────────────────────────
  let routeSeq = 0;

  function href(path) {
    // data-nav values are built here, so a path that already carries the
    // query (a router link) must not grow a second one.
    return path.includes('?') ? path : path + location.search;
  }
  function nav(path, type = 'push', replace = false) {
    const url = href(path);
    if (replace) history.replaceState({}, '', url);
    else history.pushState({}, '', url);
    render(type);
  }
  function render(type) {
    const seq = ++routeSeq;
    const run = () => route(seq);
    if (window.unNative && window.unNative.transition) window.unNative.transition(run, { type });
    else run();
  }
  window.addEventListener('popstate', () => render('pop'));

  // Clicks on [data-nav] links go through the router, keeping ?demo=1.
  // The target lives in data-nav; these anchors carry no href attribute.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a) return;
    e.preventDefault();
    const to = a.dataset.nav;
    if (to) nav(to, a.dataset.transition || 'push');
  });

  function route(seq) {
    const path = location.pathname;
    let m;
    if ((m = path.match(/^\/lieux\/(\d+)\/modifier$/))) return screenForm(seq, m[1]);
    if ((m = path.match(/^\/lieux\/(\d+)$/))) return screenPlace(seq, m[1]);
    if ((m = path.match(/^\/albums\/(\d+)$/))) return screenAlbum(seq, m[1]);
    if (path === '/albums') return screenAlbums(seq);
    if (path === '/nouveau') return screenForm(seq, null);
    return screenHome(seq);
  }

  // ── Shared pieces ────────────────────────────────────────────────────────
  const demoBanner = () => (DEMO && ME.staging
    ? `<div class="border-b border-line bg-raised px-4 py-2.5 text-small text-fg"><strong class="font-semibold">Staging demo</strong>&nbsp;: ces lieux, photos et albums sont inventés pour l’aperçu.</div>`
    : '');

  const brand = (rightHtml) => `
    <div class="flex items-center justify-between px-4 pb-1 pt-3">
      <span class="flex items-center gap-1.5 text-body font-semibold text-accent">${icon('mark', 'ic-22')}Tripto</span>
      ${rightHtml || ''}
    </div>`;

  const segSwitch = (active) => `
    <nav class="seg mx-4 my-3" aria-label="Lieux ou albums">
      <a ${active === 'lieux' ? 'aria-current="true" ' : ''}class="seg-btn" data-transition="none" data-nav="${esc(href('/'))}">Lieux</a>
      <a ${active === 'albums' ? 'aria-current="true" ' : ''}class="seg-btn" data-transition="none" data-nav="${esc(href('/albums'))}">Albums</a>
    </nav>`;

  function backBar(label, target) {
    return `<div class="px-2 pt-2">
      <a class="btn-link" data-transition="pop" data-nav="${esc(href(target))}">${icon('back', 'ic-24')}${esc(label)}</a>
    </div>`;
  }

  const skeletonRows = (n) => `<div class="px-4">
    ${Array.from({ length: n }, (_, i) => `
      <div class="mb-3 flex items-center gap-3.5">
        <div class="skeleton h-14 w-12"></div>
        <div class="flex-1">
          <div class="skeleton mb-2 h-4 ${i % 2 ? 'w-2/3' : 'w-1/2'}"></div>
          <div class="skeleton h-3 w-1/3"></div>
        </div>
      </div>`).join('')}
  </div>`;

  // Mes lieux' own skeleton: a grey year bar over a white grouped list whose
  // rows stand where the stamp-framed rows will be.
  const skeletonHome = () => `
    <div class="px-5 pt-6"><div class="skeleton h-5 w-20"></div></div>
    <ul class="list mx-4 mt-3">
      ${Array.from({ length: 5 }, (_, i) => `
        <li class="list-row list-row-tall">
          <div class="skeleton h-[58px] w-[50px]"></div>
          <div class="flex-1">
            <div class="skeleton mb-1.5 h-4 ${i % 2 ? 'w-2/3' : 'w-1/2'}"></div>
            <div class="skeleton mb-1.5 h-3 w-1/3"></div>
            <div class="skeleton h-3 w-2/5"></div>
          </div>
        </li>`).join('')}
    </ul>`;

  const stateError = (what) => `
    <div class="state-error">
      <p class="text-body font-medium text-fg">Impossible de charger ${esc(what)}.</p>
      <p class="text-small text-muted">Rien de ce que vous avez enregistré n’est perdu.</p>
      <button class="btn-secondary mt-2" data-retry>Réessayer</button>
    </div>`;

  // Delegated retry buttons.
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-retry]');
    if (b) render('none');
  });

  // ── Screen: Mes lieux ────────────────────────────────────────────────────
  // The shell (mark, button, title, count line and switch) is drawn at once,
  // and only what sits under the switch changes with the load, so the
  // header never moves between loading, populated, empty and error.
  function homeShell() {
    app.innerHTML = `
      ${demoBanner()}
      ${brand(`<a class="btn-primary" data-nav="${esc(href('/nouveau'))}">${icon('plus', 'ic-20')}Ajouter un lieu</a>`)}
      <div id="places-screen" class="pb-16">
        <h1 class="px-4 pt-3 font-serif text-title">Mes lieux</h1>
        <div class="px-4 pt-1 text-small text-muted" data-count><div class="skeleton h-4 w-32"></div></div>
        ${segSwitch('lieux')}
        <div data-body>${skeletonHome()}</div>
      </div>`;
    return {
      count: app.querySelector('#places-screen [data-count]'),
      body: app.querySelector('#places-screen [data-body]'),
    };
  }

  async function screenHome(seq) {
    const { count, body } = homeShell();
    try {
      if (DEMO && ME.staging && ME.signedIn && !demoSeeded) {
        demoSeeded = true;
        await api('/api/demo', { method: 'POST' });
      }
      const data = await api('/api/places');
      if (seq !== routeSeq) return;
      if (!data.places.length) {
        // Nothing to count yet: the empty message below says it already.
        count.textContent = '';
        body.innerHTML = `
          <div class="state-empty">
            <span class="stamp" aria-hidden="true"><i class="flex h-full items-center justify-center bg-raised text-muted">${icon('mark', 'ic-24')}</i></span>
            <p class="text-heading font-serif">Aucun lieu pour l’instant</p>
            <p class="text-body text-muted">Ajoutez le premier endroit que vous avez visité.</p>
            <a class="btn-primary mt-2" data-nav="${esc(href('/nouveau'))}">${icon('plus', 'ic-20')}Ajouter un lieu</a>
          </div>`;
        return;
      }
      count.textContent = `${pl(data.stats.places, 'lieu', 'lieux')}, ${pl(data.stats.countries, 'pays', 'pays')}`;
      const byYear = new Map();
      for (const p of data.places) {
        const y = p.visited_on.slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(p);
      }
      body.innerHTML = `${[...byYear.entries()].map(([year, places]) => `
          <div class="mb-2 mt-5 flex items-baseline justify-between px-5">
            <h2 class="font-serif text-heading">${year}</h2>
            <span class="text-small text-muted">${pl(places.length, 'lieu', 'lieux')}</span>
          </div>
          <ul class="list mx-4">
            ${places.map((p) => `
              <li>
                <a class="list-row list-row-tall w-full items-center" data-nav="${esc(href('/lieux/' + p.id))}">
                  <span class="stamp">
                    ${p.cover_url
                      ? `<img src="${esc(p.cover_url)}" alt="Photo de ${esc(p.name)}">`
                      : `<i class="flex h-full items-center justify-center bg-raised text-muted">${icon(p.kind, 'ic-24')}</i>`}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="row-name block truncate">${esc(p.name)}</span>
                    ${locationText(p) ? `<span class="row-sub block text-muted">${esc(locationText(p))}</span>` : ''}
                    <span class="flex justify-between pt-0.5 text-small text-muted">
                      <span>${esc(dayLabel(p.visited_on))}</span>
                      <span>${esc(countsText(p))}</span>
                    </span>
                  </span>
                </a>
              </li>`).join('')}
          </ul>`).join('')}`;
    } catch (err) {
      if (seq !== routeSeq) return;
      // Keep the count line's slot so the switch stays where it was.
      count.textContent = ' ';
      body.innerHTML = `
        <div class="state-error">
          <span class="stamp" aria-hidden="true"><i class="flex h-full items-center justify-center bg-raised text-muted">${icon('mark', 'ic-24')}</i></span>
          <p class="text-heading font-serif">Impossible de charger vos lieux.</p>
          <p class="text-body text-muted">Rien de ce que vous avez enregistré n’est perdu.</p>
          <button class="btn-secondary mt-2" data-retry>Réessayer</button>
        </div>`;
    }
  }

  // ── Screen: Albums ───────────────────────────────────────────────────────
  async function screenAlbums(seq) {
    app.innerHTML = `
      ${demoBanner()}
      ${brand(`<button class="btn-primary" id="new-album">${icon('plus', 'ic-20')}Nouvel album</button>`)}
      <div id="screen" class="pb-16">
        <h1 class="px-4 pt-3 font-serif text-title">Albums</h1>
        ${segSwitch('albums')}
        ${skeletonRows(4)}
      </div>`;
    app.querySelector('#new-album').addEventListener('click', () => newAlbumSheet(() => screenAlbums(++routeSeq), null));
    try {
      const data = await api('/api/albums');
      if (seq !== routeSeq) return;
      const el = app.querySelector('#screen');
      if (!data.albums.length) {
        el.innerHTML = `
          <h1 class="px-4 pt-3 font-serif text-title">Albums</h1>
          ${segSwitch('albums')}
          <div class="state-empty">
            <span class="envelope" aria-hidden="true"><i class="flex h-11 items-center justify-center bg-raised text-muted">${icon('plus', 'ic-20')}</i></span>
            <p class="text-heading font-serif">Aucun album pour l’instant</p>
            <p class="text-body text-muted">Regroupez vos lieux en voyages.</p>
            <button class="btn-primary mt-2" id="new-album-empty">Nouvel album</button>
          </div>`;
        el.querySelector('#new-album-empty').addEventListener('click', () => newAlbumSheet(() => screenAlbums(++routeSeq), null));
        return;
      }
      el.innerHTML = `
        <h1 class="px-4 pt-3 font-serif text-title">Albums</h1>
        ${segSwitch('albums')}
        <ul class="list mx-4 mt-4">
          ${data.albums.map((a) => `
            <li>
              <a class="list-row list-row-tall w-full items-center" data-nav="${esc(href('/albums/' + a.id))}">
                <span class="envelope">
                  ${a.cover_url
                    ? `<img src="${esc(a.cover_url)}" alt="Photo de l’album ${esc(a.name)}">`
                    : `<i class="flex items-center justify-center bg-raised text-muted" style="height:41px">${icon('plus', 'ic-20')}</i>`}
                  <span class="airmail"></span>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="row-name block truncate">${esc(a.name)}</span>
                  ${albumSpan(a) ? `<span class="row-sub block text-muted">${esc(albumSpan(a))}</span>` : ''}
                  <span class="block pt-0.5 text-small text-muted">${esc(pl(a.place_count, 'lieu', 'lieux') + ', ' + pl(a.photo_count, 'photo', 'photos'))}</span>
                </span>
              </a>
            </li>`).join('')}
        </ul>`;
    } catch (err) {
      if (seq !== routeSeq) return;
      app.querySelector('#screen').innerHTML = `
        <h1 class="px-4 pt-3 font-serif text-title">Albums</h1>
        ${segSwitch('albums')}
        ${stateError('vos albums')}`;
    }
  }

  // Sheet: create an album by name (+ optional description).
  function newAlbumSheet(after, unused) {
    void unused;
    const content = document.createElement('div');
    content.className = 'px-4 pb-6 pt-4';
    content.innerHTML = `
      <p class="text-heading font-serif">Nouvel album</p>
      <label class="section-label mt-3 block">Nom de l’album</label>
      <input class="field" name="name" placeholder="par ex. Week-end à Lisbonne">
      <label class="section-label mt-3 block">Description (facultatif)</label>
      <textarea class="field" name="description" rows="2" placeholder="par ex. trois jours en mai"></textarea>
      <p class="mt-2 hidden text-small text-danger" data-error></p>
      <div class="mt-4 flex gap-2">
        <button class="btn-primary flex-1" data-create>Créer</button>
        <button class="btn-secondary" data-cancel>Annuler</button>
      </div>`;
    const present = () => (window.unNative && window.unNative.presentSheet
      ? window.unNative.presentSheet({ content, onDismiss })
      : { dismiss() { onDismiss(); } });
    let dismissApi = null;
    function onDismiss() { dismissApi = null; }
    dismissApi = present();
    const done = () => { if (dismissApi) dismissApi.dismiss(); };
    content.querySelector('[data-cancel]').addEventListener('click', done);
    content.querySelector('[data-create]').addEventListener('click', async () => {
      const name = content.querySelector('[name=name]').value.trim();
      const description = content.querySelector('[name=description]').value;
      if (!name) {
        const err = content.querySelector('[data-error]');
        err.textContent = 'Donnez un nom à l’album.';
        err.classList.remove('hidden');
        return;
      }
      try {
        const data = await api('/api/albums', { method: 'POST', body: { name, description } });
        done();
        toast('Album créé');
        after(data.album && data.album.id);
      } catch (err) {
        const errEl = content.querySelector('[data-error]');
        errEl.textContent = err.field === 'name' ? (err.message || 'Donnez un nom à l’album.') : 'Création impossible pour le moment.';
        errEl.classList.remove('hidden');
      }
    });
  }

  // ── Screen: one album ────────────────────────────────────────────────────
  async function screenAlbum(seq, id) {
    app.innerHTML = `
      ${demoBanner()}
      ${backBar('Albums', '/albums')}
      <div id="screen" class="pb-16">
        <div class="px-4 pt-2"><div class="skeleton h-7 w-52"></div></div>
        ${skeletonRows(3)}
      </div>`;
    try {
      const data = await api('/api/albums/' + id);
      if (seq !== routeSeq) return;
      const a = data.album;
      const el = app.querySelector('#screen');
      const rows = a.places.length ? `
        <ul class="list mx-4">
          ${a.places.map((p) => `
            <li>
              <a class="list-row list-row-tall w-full items-center" data-nav="${esc(href('/lieux/' + p.id))}">
                <span class="stamp">
                  ${p.cover_url
                    ? `<img src="${esc(p.cover_url)}" alt="Photo de ${esc(p.name)}">`
                    : `<i class="flex h-full items-center justify-center bg-raised text-muted">${icon(p.kind, 'ic-24')}</i>`}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="row-name block truncate">${esc(p.name)}</span>
                  ${locationText(p) ? `<span class="row-sub block text-muted">${esc(locationText(p))}</span>` : ''}
                  <span class="flex justify-between pt-0.5 text-small text-muted">
                    <span>${esc(dayLabel(p.visited_on))}</span>
                    <span>${esc(countsText(p))}</span>
                  </span>
                </span>
              </a>
            </li>`).join('')}
        </ul>` : `
        <div class="state-empty">
          <p class="text-heading font-serif">Cet album est vide</p>
          <p class="text-body text-muted">Ajoutez des lieux de ce voyage.</p>
          <button class="btn-primary mt-2" data-add-places>Ajouter des lieux</button>
        </div>`;
      el.innerHTML = `
        <h1 class="px-4 pt-2 font-serif text-title">${esc(a.name)}</h1>
        <p class="px-4 pt-1 text-small text-muted">${albumSpan(a) ? esc(albumSpan(a)) + ', ' : ''}${esc(pl(a.place_count, 'lieu', 'lieux'))}, ${esc(pl(a.photo_count, 'photo', 'photos'))}</p>
        ${a.description ? `<p class="px-4 pt-2 text-body text-muted">${esc(a.description)}</p>` : ''}
        <div class="flex gap-2 px-4 pt-4">
          <button class="btn-secondary" data-add-places>${icon('plus', 'ic-20')}Ajouter des lieux</button>
          <button class="btn-secondary" data-edit>${icon('edit', 'ic-20')}Modifier</button>
        </div>
        <div class="mt-5">${rows}</div>`;
      el.querySelector('[data-add-places]').addEventListener('click', () => albumPlacesSheet(a, () => screenAlbum(++routeSeq, id)));
      el.querySelector('[data-edit]').addEventListener('click', () => editAlbumSheet(a, {
        onSave: () => screenAlbum(++routeSeq, id),
        onDelete: () => { toast('Album supprimé'); nav('/albums', 'pop', true); },
      }));
    } catch (err) {
      if (seq !== routeSeq) return;
      app.querySelector('#screen').innerHTML = err.status === 404
        ? `<div class="state-error"><p class="text-body font-medium">Cet album n’existe plus.</p><a class="btn-secondary mt-2" data-nav="${esc(href('/albums'))}">Retour aux albums</a></div>`
        : stateError('cet album');
    }
  }

  // Sheet: tick which places belong to the album.
  async function albumPlacesSheet(album, after) {
    let all;
    try { all = (await api('/api/places')).places; } catch (_) { return; }
    const inAlbum = new Set(album.places.map((p) => p.id));
    const content = document.createElement('div');
    content.className = 'px-4 pb-6 pt-4';
    content.innerHTML = `
      <p class="text-heading font-serif">Ajouter des lieux</p>
      <p class="section-label mt-1">Cochez les lieux de «&nbsp;${esc(album.name)}&nbsp;»</p>
      <div class="mt-2 max-h-80 overflow-y-auto" data-list>
        ${all.length ? all.map((p) => `
          <label class="flex min-h-11 items-center gap-3 py-1">
            <input type="checkbox" data-place="${p.id}" ${inAlbum.has(p.id) ? 'checked' : ''} class="check">
            <span class="stamp">${p.cover_url
              ? `<img src="${esc(p.cover_url)}" alt="">`
              : `<i class="flex h-full items-center justify-center bg-raised text-muted">${icon(p.kind, 'ic-24')}</i>`}</span>
            <span class="min-w-0 flex-1">
              <span class="row-name block truncate text-body font-semibold">${esc(p.name)}</span>
              <span class="block text-small text-muted">${esc(dayLabel(p.visited_on))}</span>
            </span>
          </label>`).join('') : '<p class="py-4 text-body text-muted">Aucun lieu à ajouter pour l’instant.</p>'}
      </div>
      <button class="btn-primary mt-4 w-full" data-ok>OK</button>`;
    let dismissApi = null;
    dismissApi = window.unNative && window.unNative.presentSheet
      ? window.unNative.presentSheet({ content })
      : { dismiss() {} };
    content.querySelector('[data-ok]').addEventListener('click', async () => {
      const ids = [...content.querySelectorAll('[data-place]')]
        .filter((c) => c.checked).map((c) => Number(c.dataset.place));
      try {
        await api('/api/albums/' + album.id + '/places', { method: 'PUT', body: { place_ids: ids } });
        dismissApi.dismiss();
        toast('Album enregistré');
        after();
      } catch (_) {
        toast('Enregistrement impossible pour le moment');
      }
    });
  }

  // Sheet: rename the album, or delete it (its places stay).
  function editAlbumSheet(album, { onSave, onDelete }) {
    const content = document.createElement('div');
    content.className = 'px-4 pb-6 pt-4';
    content.innerHTML = `
      <p class="text-heading font-serif">Modifier l’album</p>
      <label class="section-label mt-3 block">Nom de l’album</label>
      <input class="field" name="name" value="${esc(album.name)}">
      <label class="section-label mt-3 block">Description (facultatif)</label>
      <textarea class="field" name="description" rows="2">${esc(album.description || '')}</textarea>
      <p class="mt-2 hidden text-small text-danger" data-error></p>
      <div class="mt-4 flex gap-2">
        <button class="btn-primary flex-1" data-save>Enregistrer</button>
        <button class="btn-secondary" data-cancel>Annuler</button>
      </div>
      <button class="btn-secondary btn-danger mt-2 w-full" data-delete>${icon('trash', 'ic-20')}Supprimer l’album</button>`;
    let dismissApi = null;
    dismissApi = window.unNative && window.unNative.presentSheet
      ? window.unNative.presentSheet({ content })
      : { dismiss() {} };
    const done = () => { if (dismissApi) dismissApi.dismiss(); };
    content.querySelector('[data-cancel]').addEventListener('click', done);
    content.querySelector('[data-save]').addEventListener('click', async () => {
      try {
        await api('/api/albums/' + album.id, {
          method: 'PATCH',
          body: {
            name: content.querySelector('[name=name]').value.trim(),
            description: content.querySelector('[name=description]').value,
          },
        });
        done();
        toast('Album enregistré');
        onSave && onSave();
      } catch (err) {
        const errEl = content.querySelector('[data-error]');
        errEl.textContent = err.field === 'name' ? (err.message || 'Donnez un nom à l’album.') : 'Enregistrement impossible pour le moment.';
        errEl.classList.remove('hidden');
      }
    });
    content.querySelector('[data-delete]').addEventListener('click', async () => {
      done();
      const ok = await confirmDialog('Supprimer cet album ?',
        'Les lieux de l’album restent dans Mes lieux.', 'Supprimer');
      if (!ok) return;
      try {
        await api('/api/albums/' + album.id, { method: 'DELETE' });
        onDelete && onDelete();
      } catch (_) { toast('Suppression impossible pour le moment'); }
    });
  }

  // ── Screen: a place's showcase page ──────────────────────────────────────
  async function screenPlace(seq, id) {
    app.innerHTML = `
      ${demoBanner()}
      ${backBar('Mes lieux', '/')}
      <div id="screen" class="pb-16">
        <div class="px-4 pt-2"><div class="skeleton h-[250px] w-full"></div></div>
        <div class="px-4 pt-4">${skeletonRows(2)}</div>
      </div>`;
    try {
      const data = await api('/api/places/' + id);
      if (seq !== routeSeq) return;
      renderPlace(seq, data.place);
    } catch (err) {
      if (seq !== routeSeq) return;
      app.querySelector('#screen').innerHTML = err.status === 404
        ? `<div class="state-error"><p class="text-body font-medium">Ce lieu n’existe plus.</p><a class="btn-secondary mt-2" data-nav="${esc(href('/'))}">Retour à mes lieux</a></div>`
        : stateError('ce lieu');
    }
  }

  function renderPlace(seq, p) {
    const total = p.photo_count + p.video_count;
    const postmark = `
      <div class="postmark-pos">
        ${svg('<path d="M2 8c5-4 9 4 14 0s9 4 14 0 9 4 12 1"/><path d="M2 18c5-4 9 4 14 0s9 4 14 0 9 4 12 1"/><path d="M2 28c5-4 9 4 14 0s9 4 14 0 9 4 12 1"/>').replace('<svg', '<svg class="postmark-lines" style="width:44px;height:36px;left:-46px;top:30px"')}
        <div class="postmark">
          ${p.city ? `<small>${esc(p.city)}</small>` : ''}
          <b>${esc(fullLabel(p.visited_on).replace(/^\w+ /, ''))}</b>
          ${p.country ? `<small>${esc(p.country)}</small>` : ''}
        </div>
      </div>`;
    const cover = p.cover_url
      ? `<img src="${esc(p.cover_url)}" alt="Photo de couverture de ${esc(p.name)}">`
      : `<div class="flex h-[250px] items-center justify-center bg-raised text-muted">${icon(p.kind, 'ic-24')}</div>`;
    const mediaTiles = () => p.media.map((m) => m.kind === 'photo'
      ? `<button class="gallery-tile" data-photo="${m.id}"><img src="${esc(m.url)}" alt="${esc(m.caption || 'Photo de ' + p.name)}"></button>`
      : `<button class="gallery-tile video-tile" data-video="${esc(m.url)}" aria-label="Ouvrir la vidéo">${icon('play', 'ic-24')}<span>Vidéo</span></button>`
    ).join('');

    app.innerHTML = `
      ${demoBanner()}
      ${backBar('Mes lieux', '/')}
      <div id="screen" class="pb-16">
        <div class="envelope-lg mt-2">
          ${cover}
          <div class="airmail"></div>
          ${postmark}
        </div>
        <div class="px-4 pt-12">
          <span class="type-pill">${icon(p.kind, 'ic-18')}${esc(KIND_LABELS[p.kind] || 'Autre')}</span>
          <h1 class="pt-2 font-serif text-title">${esc(p.name)}</h1>
          ${locationText(p) ? `<p class="pt-1 text-body text-muted">${esc(locationText(p))}</p>` : ''}
          <div class="flex flex-wrap gap-2 pt-4">
            <button class="btn-secondary" data-add-photos>${icon('camera', 'ic-20')}Ajouter des photos</button>
            <a class="btn-secondary" data-nav="${esc(href('/lieux/' + p.id + '/modifier'))}">${icon('edit', 'ic-20')}Modifier</a>
          </div>

          ${p.about ? `
            <p class="section-label mt-7">À propos du lieu</p>
            <p class="px-1 text-body" style="line-height:26px">${esc(p.about)}</p>` : ''}

          <p class="section-label mt-7">Infos pratiques</p>
          <ul class="list">
            <li class="list-row justify-between gap-3">
              <span class="text-muted">Visité le</span>
              <span class="text-right">${esc(fullLabel(p.visited_on))}</span>
            </li>
            ${p.address ? `
              <li class="list-row justify-between gap-3">
                <span class="text-muted">Adresse</span>
                <span class="text-right">${esc(p.address)}<br>
                  <a class="inline-flex min-h-11 items-center font-medium text-accent" href="${esc(mapUrl(p))}" target="_blank" rel="noopener">${icon('map', 'ic-18')}Voir sur la carte</a>
                </span>
              </li>` : ''}
          </ul>

          ${p.notes ? `
            <p class="section-label mt-7">Mes notes</p>
            <div class="postcard whitespace-pre-wrap">${esc(p.notes)}</div>` : ''}

          <p class="section-label mt-7" data-media-count>Photos et vidéos${total ? ' (' + total + ')' : ''}</p>
          <div class="gallery" id="gallery">
            ${mediaTiles() || `<p class="col-span-3 px-1 py-2 text-body text-muted">Aucune photo pour l’instant.</p>`}
          </div>
          <input type="file" accept="image/*" multiple class="hidden" id="photo-input">

          <p class="section-label mt-7">Albums</p>
          <div class="flex flex-wrap items-center gap-2 px-1">
            ${p.albums.map((a) => `<a class="chip" data-nav="${esc(href('/albums/' + a.id))}">${esc(a.name)}</a>`).join('')}
            <button class="btn-link" data-add-album>Ajouter à un album</button>
          </div>
        </div>
      </div>`;

    const el = app.querySelector('#screen');
    el.querySelector('[data-add-photos]').addEventListener('click', () => el.querySelector('#photo-input').click());
    el.querySelector('#photo-input').addEventListener('change', (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const f of files) startPhotoUpload(p, f, el);
    });
    el.querySelector('[data-add-album]').addEventListener('click', () => placeAlbumsSheet(p, () => screenPlace(++routeSeq, p.id)));
    for (const b of el.querySelectorAll('[data-photo]')) {
      b.addEventListener('click', () => openViewer(p, Number(b.dataset.photo)));
    }
    for (const b of el.querySelectorAll('[data-video]')) {
      b.addEventListener('click', () => window.open(b.dataset.video, '_blank', 'noopener'));
    }
    // Photos picked while creating the place finish uploading here.
    drainPendingUploads(p, el);
  }

  // ── Photos: pick, shrink, upload ─────────────────────────────────────────
  // Large camera photos are made smaller before upload (longest side 2000 px,
  // JPEG quality 0.85). At most two uploads at a time; each tile shows its
  // progress, and a failed one stays with Réessayer.
  const queue = [];
  let uploading = 0;
  function enqueue(job) {
    queue.push(job);
    pump();
  }
  function pump() {
    while (uploading < 2 && queue.length) {
      uploading += 1;
      queue.shift()().catch(() => {}).finally(() => { uploading -= 1; pump(); });
    }
  }

  async function shrink(file) {
    if (file.type === 'image/gif' && file.size <= 5 * 1024 * 1024) return { blob: file, width: null, height: null };
    let src;
    try { src = await createImageBitmap(file); } catch (_) {
      src = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('invalid_image')); };
        img.src = url;
      });
    }
    const w0 = src.width, h0 = src.height;
    const scale = Math.min(1, 2000 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(src, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('invalid_image'))), 'image/jpeg', 0.85));
    return { blob, width: w, height: h };
  }

  function uploadErrorText(err) {
    const code = err && err.message;
    if (!(window.usernode && window.usernode.uploadFile)) {
      return 'L’envoi de photos ne fonctionne que dans Homeroom.';
    }
    switch (code) {
      case 'file_too_large': return 'Photo trop lourde, même réduite (5 Mo maximum).';
      case 'user_quota_exceeded': return 'Votre espace photos est plein (200 Mo).';
      case 'staging_quota_exceeded':
      case 'app_quota_exceeded': return 'Votre espace photos est plein.';
      case 'storage_unavailable': return 'L’envoi de photos est indisponible pour le moment.';
      case 'invalid_image': return 'Ce fichier n’est pas une image.';
      default: return 'L’envoi a échoué.';
    }
  }

  function uploadTile(status, extra) {
    return `<div class="gallery-tile upload-tile" ${extra || ''}>
      ${status === 'failed'
        ? `<span class="px-1 text-center text-small">Échec de l’envoi</span><button class="btn-link !min-h-0 py-1 text-small" data-retry-upload>Réessayer</button>`
        : `${icon('camera', 'ic-20')}<span>Envoi…</span>`}
    </div>`;
  }

  // Upload one picked file into place p, showing a tile in el's gallery.
  function startPhotoUpload(p, file, el, existingTile) {
    const gallery = el.querySelector('#gallery');
    if (!gallery) return;
    if (gallery.querySelector('[data-none]')) gallery.innerHTML = '';
    const tile = existingTile || (() => {
      const tpl = document.createElement('template');
      tpl.innerHTML = uploadTile('busy');
      const t = tpl.content.firstElementChild;
      gallery.appendChild(t);
      return t;
    })();
    const job = async () => {
      tile.innerHTML = `<span class="ic-20">${ICONS.camera}</span><span>Envoi…</span>`;
      try {
        const small = await shrink(file);
        if (!(window.usernode && window.usernode.uploadFile)) throw new Error('no_shell');
        const stored = await window.usernode.uploadFile(small.blob, { visibility: 'public' });
        const data = await api('/api/places/' + p.id + '/media', {
          method: 'POST',
          body: { kind: 'photo', url: stored.url, file_id: stored.id, width: small.width, height: small.height },
        });
        tile.remove();
        const gallery2 = el.querySelector('#gallery');
        if (gallery2) {
          const btn = document.createElement('button');
          btn.className = 'contents';
          const m = data.media;
          const img = document.createElement('img');
          img.className = 'gallery-tile';
          img.src = m.url;
          img.alt = m.caption || 'Photo de ' + p.name;
          img.dataset.photo = m.id;
          gallery2.appendChild(img);
          img.addEventListener('click', () => openViewer(refreshedPlace || p, m.id));
        }
        p.photo_count += 1;
        if (!p.cover_url) p.cover_url = data.media.url;
        if (!p.media.some((x) => x.id === data.media.id)) p.media.push(data.media);
        refreshedPlace = p;
        const label = el.querySelector('[data-media-count]');
        if (label) label.textContent = 'Photos et vidéos (' + (p.photo_count + p.video_count) + ')';
      } catch (err) {
        tile.innerHTML = uploadTile('failed');
        tile.querySelector('[data-retry-upload]').addEventListener('click', () => enqueue(job));
        console.warn('upload failed:', err && err.message);
        toast(uploadErrorText(err));
      }
    };
    enqueue(job);
  }

  let refreshedPlace = null;

  // Photos picked in the "Nouveau lieu" form finish uploading on the new
  // place's page, right after the place is created.
  function drainPendingUploads(p, el) {
    if (!pendingUploads.length) return;
    const tiles = [];
    const gallery = el.querySelector('#gallery');
    if (gallery) {
      gallery.innerHTML = '';
      for (const up of pendingUploads) {
        const tpl = document.createElement('template');
        tpl.innerHTML = `<div class="gallery-tile upload-tile"><img src="${esc(up.preview)}" alt="" class="gallery-tile absolute inset-0 h-full w-full object-cover opacity-40"><span class="relative">Envoi…</span></div>`;
        const t = tpl.content.firstElementChild;
        gallery.appendChild(t);
        tiles.push(t);
      }
    }
    const ups = pendingUploads.splice(0, pendingUploads.length);
    ups.forEach((up, i) => {
      const job = async () => {
        const tile = tiles[i];
        try {
          if (!(window.usernode && window.usernode.uploadFile)) throw new Error('no_shell');
          const small = await shrink(up.file);
          const stored = await window.usernode.uploadFile(small.blob, { visibility: 'public' });
          const data = await api('/api/places/' + p.id + '/media', {
            method: 'POST',
            body: { kind: 'photo', url: stored.url, file_id: stored.id, width: small.width, height: small.height },
          });
          tile.remove();
          const gallery2 = el.querySelector('#gallery');
          if (gallery2) {
            const img = document.createElement('img');
            img.className = 'gallery-tile';
            img.src = data.media.url;
            img.alt = 'Photo de ' + p.name;
            img.dataset.photo = data.media.id;
            gallery2.appendChild(img);
            img.addEventListener('click', () => openViewer(p, data.media.id));
          }
          p.photo_count += 1;
          if (!p.cover_url) p.cover_url = data.media.url;
          if (!p.media.some((x) => x.id === data.media.id)) p.media.push(data.media);
        } catch (err) {
          tile.innerHTML = uploadTile('failed');
          tile.querySelector('[data-retry-upload]').addEventListener('click', () => enqueue(job));
          toast(uploadErrorText(err));
        }
      };
      enqueue(job);
    });
  }
  let pendingUploads = [];

  // ── The full-screen photo viewer ─────────────────────────────────────────
  function openViewer(p, mediaId) {
    const photos = p.media.filter((m) => m.kind === 'photo');
    const startIdx = Math.max(0, photos.findIndex((m) => m.id === mediaId));
    if (!photos.length) return;
    let idx = startIdx;
    const content = document.createElement('div');
    content.className = 'flex flex-col items-center gap-3 p-4';
    const draw = () => {
      const m = photos[idx];
      content.innerHTML = `
        <img src="${esc(m.url)}" alt="${esc(m.caption || 'Photo de ' + p.name)}" class="max-h-[60vh] w-auto rounded-lg object-contain">
        <p class="text-small text-muted">${idx + 1} / ${photos.length}</p>
        <input class="field" data-caption value="${esc(m.caption)}" placeholder="Une légende pour cette photo">
        <div class="flex gap-2">
          <button class="btn-secondary" data-prev ${photos.length < 2 ? 'disabled' : ''}>Précédent</button>
          <button class="btn-secondary" data-next ${photos.length < 2 ? 'disabled' : ''}>Suivant</button>
        </div>
        <div class="flex gap-2">
          ${m.id !== (p.cover_media_id || null) && p.cover_url !== m.url ? `<button class="btn-secondary" data-cover>Choisir comme couverture</button>` : ''}
          <button class="btn-secondary btn-danger" data-delete>${icon('trash', 'ic-20')}Supprimer</button>
        </div>`;
      content.querySelector('[data-caption]').addEventListener('blur', async (e) => {
        const val = e.target.value;
        if (val === (m.caption || '')) return;
        try {
          const data = await api('/api/media/' + m.id, { method: 'PATCH', body: { caption: val } });
          m.caption = data.media.caption;
          const live = findLiveMedia(p, m.id);
          if (live) live.caption = data.media.caption;
        } catch (_) { toast('Légende non enregistrée'); }
      });
      content.querySelector('[data-prev]').addEventListener('click', () => { idx = (idx - 1 + photos.length) % photos.length; draw(); });
      content.querySelector('[data-next]').addEventListener('click', () => { idx = (idx + 1) % photos.length; draw(); });
      const coverBtn = content.querySelector('[data-cover]');
      if (coverBtn) coverBtn.addEventListener('click', async () => {
        try {
          await api('/api/places/' + p.id + '/cover', { method: 'PUT', body: { media_id: m.id } });
          p.cover_url = m.url;
          toast('Couverture choisie');
          api('/api/places/' + p.id).then((d) => { Object.assign(p, d.place); }).catch(() => {});
          dismissApi && dismissApi.dismiss();
          screenPlace(++routeSeq, p.id);
        } catch (_) { toast('Choix impossible pour le moment'); }
      });
      content.querySelector('[data-delete]').addEventListener('click', async () => {
        const ok = await confirmDialog('Supprimer cette photo ?', '', 'Supprimer');
        if (!ok) return;
        try {
          const del = await api('/api/media/' + m.id, { method: 'DELETE' });
          if (del.file_id && window.usernode && window.usernode.deleteFile) {
            window.usernode.deleteFile(del.file_id).catch((e) => console.warn('deleteFile failed:', e && e.message));
          }
          p.media = p.media.filter((x) => x.id !== m.id);
          photos.splice(idx, 1);
          p.photo_count = Math.max(0, p.photo_count - 1);
          if (p.cover_url === m.url) {
            const nextPhoto = p.media.find((x) => x.kind === 'photo');
            p.cover_url = nextPhoto ? nextPhoto.url : null;
          }
          toast('Photo supprimée');
          dismissApi && dismissApi.dismiss();
          screenPlace(++routeSeq, p.id);
        } catch (_) { toast('Suppression impossible pour le moment'); }
      });
    };
    draw();
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') content.querySelector('[data-prev]') && content.querySelector('[data-prev]').click();
      if (e.key === 'ArrowRight') content.querySelector('[data-next]') && content.querySelector('[data-next]').click();
    };
    document.addEventListener('keydown', onKey);
    let dismissApi = null;
    dismissApi = window.unNative && window.unNative.presentModal
      ? window.unNative.presentModal({ content, onDismiss: () => document.removeEventListener('keydown', onKey) })
      : { dismiss() { document.removeEventListener('keydown', onKey); } };
  }

  function findLiveMedia(p, id) {
    return p.media.find((m) => m.id === id);
  }

  // ── Sheet: the albums a place belongs to ─────────────────────────────────
  async function placeAlbumsSheet(p, after) {
    let albums;
    try { albums = (await api('/api/albums')).albums; } catch (_) { return; }
    const member = new Set(p.albums.map((a) => a.id));
    const content = document.createElement('div');
    content.className = 'px-4 pb-6 pt-4';
    content.innerHTML = `
      <p class="text-heading font-serif">Ajouter à un album</p>
      <p class="section-label mt-1">Cochez les albums de «&nbsp;${esc(p.name)}&nbsp;»</p>
      <div class="mt-2 max-h-64 overflow-y-auto" data-list>
        ${albums.length ? albums.map((a) => `
          <label class="flex min-h-11 items-center gap-3 py-1">
            <input type="checkbox" data-album="${a.id}" ${member.has(a.id) ? 'checked' : ''} class="check">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body font-medium">${esc(a.name)}</span>
              ${albumSpan(a) ? `<span class="block text-small text-muted">${esc(albumSpan(a))}</span>` : ''}
            </span>
          </label>`).join('') : '<p class="py-2 text-body text-muted">Aucun album pour l’instant.</p>'}
      </div>
      <div class="mt-3 flex items-end gap-2">
        <div class="flex-1">
          <label class="section-label block">Nouvel album</label>
          <input class="field" data-new placeholder="par ex. Été en Crète">
        </div>
        <button class="btn-secondary" data-create>Créer</button>
      </div>
      <button class="btn-primary mt-4 w-full" data-ok>OK</button>`;
    let dismissApi = null;
    dismissApi = window.unNative && window.unNative.presentSheet
      ? window.unNative.presentSheet({ content })
      : { dismiss() {} };
    const done = () => { if (dismissApi) dismissApi.dismiss(); };
    content.querySelector('[data-create]').addEventListener('click', async () => {
      const name = content.querySelector('[data-new]').value.trim();
      if (!name) return;
      try {
        const data = await api('/api/albums', { method: 'POST', body: { name, description: '' } });
        member.add(data.album.id);
        p.albums.push({ id: data.album.id, name: data.album.name });
        const list = content.querySelector('[data-list]');
        const empty = list.querySelector('p');
        if (empty) empty.remove();
        const row = document.createElement('label');
        row.className = 'flex min-h-11 items-center gap-3 py-1';
        row.innerHTML = `<input type="checkbox" data-album="${data.album.id}" checked class="check">
          <span class="min-w-0 flex-1"><span class="block truncate text-body font-medium">${esc(data.album.name)}</span></span>`;
        list.appendChild(row);
        content.querySelector('[data-new]').value = '';
        toast('Album créé');
      } catch (_) { toast('Création impossible pour le moment'); }
    });
    content.querySelector('[data-ok]').addEventListener('click', async () => {
      const ids = [...content.querySelectorAll('[data-album]')]
        .filter((c) => c.checked).map((c) => Number(c.dataset.album));
      try {
        await api('/api/places/' + p.id + '/albums', { method: 'PUT', body: { album_ids: ids } });
        done();
        toast('Lieu enregistré');
        after();
      } catch (_) { toast('Enregistrement impossible pour le moment'); }
    });
  }

  // ── Screen: the place form (new or edit) ─────────────────────────────────
  async function screenForm(seq, id) {
    let place = null;
    if (id) {
      try {
        place = (await api('/api/places/' + id)).place;
        if (seq !== routeSeq) return;
      } catch (err) {
        if (seq !== routeSeq) return;
        app.innerHTML = `${demoBanner()}${backBar('Mes lieux', '/')}`;
        app.insertAdjacentHTML('beforeend', `<div class="state-error"><p class="text-body font-medium">Ce lieu n’existe plus.</p><a class="btn-secondary mt-2" data-nav="${esc(href('/'))}">Retour à mes lieux</a></div>`);
        return;
      }
    }
    const editing = !!place;
    pendingUploads = [];
    const previews = []; // { file, preview } for a new place's photos
    let countries = [];
    try {
      if (!editing) countries = [...new Set(((await api('/api/places')).places || [])
        .map((x) => x.country).filter(Boolean))];
    } catch (_) { /* the datalist is only a convenience */ }

    const typeChips = KINDS.map((k) => `
      <button type="button" role="radio" aria-checked="${(place ? place.kind : 'autre') === k}" data-kind="${k}"
        class="type-chip">${icon(k, 'ic-20')}${esc(KIND_LABELS[k])}</button>`).join('');

    app.innerHTML = `
      ${demoBanner()}
      <div class="flex items-center justify-between px-3 pt-2">
        <button class="btn-link" data-cancel>Annuler</button>
        <span class="text-small text-muted">${editing ? 'Modifier le lieu' : 'Nouveau lieu'}</span>
      </div>
      <div id="screen" class="pb-24">
        <h1 class="px-4 pt-1 font-serif text-title">${editing ? 'Modifier le lieu' : 'Nouveau lieu'}</h1>
        <form id="place-form" class="px-4 pt-4" novalidate>
          <label class="section-label" for="f-name">Nom du lieu</label>
          <input class="field" id="f-name" name="name" value="${esc(place ? place.name : '')}" placeholder="par ex. Tour de Belém">
          <p class="hidden px-1 pt-1 text-small text-danger" data-err="name"></p>

          <div class="grid grid-cols-2 gap-3 pt-3">
            <div>
              <label class="section-label" for="f-city">Ville ou région</label>
              <input class="field" id="f-city" name="city" value="${esc(place ? place.city : '')}" placeholder="par ex. Lisbonne">
            </div>
            <div>
              <label class="section-label" for="f-country">Pays</label>
              <input class="field" id="f-country" name="country" value="${esc(place ? place.country : '')}" placeholder="par ex. Portugal" list="countries-dl">
              <datalist id="countries-dl">${countries.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
            </div>
          </div>

          <label class="section-label pt-3" for="f-date">Date de visite</label>
          <input class="field" id="f-date" name="visited_on" type="date" value="${esc(place ? place.visited_on : ME.today)}" max="${esc(ME.today)}">
          <p class="hidden px-1 pt-1 text-small text-danger" data-err="visited_on"></p>

          <label class="section-label pt-4">Type de lieu</label>
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Type de lieu">${typeChips}</div>

          <label class="section-label pt-4" for="f-address">Adresse (facultatif)</label>
          <input class="field" id="f-address" name="address" value="${esc(place ? place.address : '')}" placeholder="par ex. Avenida Brasília, Lisbonne">

          <label class="section-label pt-3" for="f-about">À propos du lieu (facultatif)</label>
          <textarea class="field" id="f-about" name="about" rows="3" placeholder="par ex. histoire, horaires, prix d’entrée">${esc(place ? place.about : '')}</textarea>

          <label class="section-label pt-3" for="f-notes">Mes notes (facultatif)</label>
          <textarea class="field" id="f-notes" name="notes" rows="3" placeholder="par ex. ce que vous avez préféré">${esc(place ? place.notes : '')}</textarea>

          <p class="section-label pt-4">Photos</p>
          <div class="flex flex-wrap gap-2" id="form-photos"></div>
          <label class="btn-secondary mt-2 w-fit cursor-pointer">${icon('camera', 'ic-20')}Choisir des photos
            <input type="file" accept="image/*" multiple class="hidden" id="form-photo-input">
          </label>

          <p class="section-label pt-4">Vidéos</p>
          <div id="form-videos" class="flex flex-col gap-2">
            ${(place ? place.media.filter((m) => m.kind === 'video') : []).map((m) => `
              <div class="flex items-center gap-2" data-existing-video="${m.id}">
                <input class="field" value="${esc(m.url)}" readonly aria-label="Lien vidéo">
                <button type="button" class="btn-secondary px-3" data-remove-existing-video="${m.id}" aria-label="Supprimer la vidéo">${icon('close', 'ic-20')}</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn-link mt-1" data-add-video>${icon('plus', 'ic-20')}Ajouter un lien vidéo</button>

          <p class="mt-3 hidden px-1 text-small text-danger" data-err="form"></p>
          <button type="submit" class="btn-primary mt-5 w-full">Enregistrer le lieu</button>
          ${editing ? `<button type="button" class="btn-secondary btn-danger mt-2 w-full" data-delete-place>${icon('trash', 'ic-20')}Supprimer ce lieu</button>` : ''}
        </form>
      </div>`;

    const el = app.querySelector('#screen');
    const form = el.querySelector('#place-form');
    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('submit', (e) => e.preventDefault());

    // Type chips behave as one radio group.
    for (const chip of form.querySelectorAll('[data-kind]')) {
      chip.addEventListener('click', () => {
        for (const c of form.querySelectorAll('[data-kind]')) c.setAttribute('aria-checked', String(c === chip));
        dirty = true;
      });
    }

    // Photos: new place keeps object-URL previews; editing deletes at once.
    const photosBox = el.querySelector('#form-photos');
    const drawPreviews = () => {
      photosBox.innerHTML = previews.map((up, i) => `
        <span class="relative inline-block h-16 w-16 overflow-hidden rounded-md border border-line">
          <img src="${esc(up.preview)}" alt="" class="h-full w-full object-cover">
          <button type="button" class="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-bl-md bg-surface text-fg" data-remove-pick="${i}" aria-label="Retirer cette photo">${icon('close', '')}</button>
        </span>`).join('');
    };
    drawPreviews();
    if (editing) {
      for (const m of place.media.filter((x) => x.kind === 'photo')) {
        const tile = document.createElement('span');
        tile.className = 'relative inline-block h-16 w-16 overflow-hidden rounded-md border border-line';
        tile.innerHTML = `<img src="${esc(m.url)}" alt="" class="h-full w-full object-cover">
          <button type="button" class="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-bl-md bg-surface text-fg" data-remove-media="${m.id}" aria-label="Supprimer cette photo">${icon('close', '')}</button>`;
        photosBox.appendChild(tile);
      }
    }
    photosBox.addEventListener('click', async (e) => {
      const rmPick = e.target.closest('[data-remove-pick]');
      if (rmPick) {
        const i = Number(rmPick.dataset.removePick);
        URL.revokeObjectURL(previews[i].preview);
        previews.splice(i, 1);
        drawPreviews();
        dirty = true;
        return;
      }
      const rmMedia = e.target.closest('[data-remove-media]');
      if (rmMedia) {
        const mid = Number(rmMedia.dataset.removeMedia);
        try {
          const del = await api('/api/media/' + mid, { method: 'DELETE' });
          if (del.file_id && window.usernode && window.usernode.deleteFile) {
            window.usernode.deleteFile(del.file_id).catch(() => {});
          }
          rmMedia.closest('span').remove();
          place.media = place.media.filter((x) => x.id !== mid);
          if (place.cover_url && place.media.every((x) => x.url !== place.cover_url)) {
            const next = place.media.find((x) => x.kind === 'photo');
            place.cover_url = next ? next.url : null;
          }
          dirty = true;
        } catch (_) { toast('Suppression impossible pour le moment'); }
      }
    });
    el.querySelector('#form-photo-input').addEventListener('change', (e) => {
      for (const f of [...e.target.files]) {
        previews.push({ file: f, preview: URL.createObjectURL(f) });
      }
      e.target.value = '';
      drawPreviews();
      dirty = true;
    });

    // Video links.
    const videosBox = el.querySelector('#form-videos');
    el.querySelector('[data-add-video]').addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      row.innerHTML = `<input class="field" data-video-url placeholder="par ex. https://youtu.be/…" aria-label="Lien vidéo">
        <button type="button" class="btn-secondary px-3" aria-label="Retirer ce lien">${icon('close', 'ic-20')}</button>`;
      row.querySelector('button').addEventListener('click', () => { row.remove(); dirty = true; });
      videosBox.appendChild(row);
      dirty = true;
    });
    videosBox.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-remove-existing-video]');
      if (!rm) return;
      const mid = Number(rm.dataset.removeExistingVideo);
      try {
        const del = await api('/api/media/' + mid, { method: 'DELETE' });
        void del;
        rm.closest('div').remove();
        place.media = place.media.filter((x) => x.id !== mid);
        dirty = true;
      } catch (_) { toast('Suppression impossible pour le moment'); }
    });

    // Leaving with unsaved changes asks first.
    async function leaveIfDirty(leaving) {
      if (!dirty) { leaving(); return true; }
      const ok = await (window.unNative && window.unNative.alert
        ? window.unNative.alert({
            title: 'Abandonner les modifications ?',
            buttons: [
              { label: 'Continuer', style: 'cancel' },
              { label: 'Abandonner', style: 'destructive' },
            ],
          }).then((r) => !!(r && r.button && r.button.label === 'Abandonner'))
        : Promise.resolve(window.confirm('Abandonner les modifications ?')));
      if (ok) { dirty = false; leaving(); }
      return false;
    }
    app.querySelector('[data-cancel]').addEventListener('click', () => {
      leaveIfDirty(() => nav(editing ? '/lieux/' + id : '/', 'pop'));
    });

    // Save.
    form.addEventListener('submit', async () => {
      const body = {
        name: form.elements.namedItem('name').value,
        city: form.elements.namedItem('city').value,
        country: form.elements.namedItem('country').value,
        address: form.elements.namedItem('address').value,
        about: form.elements.namedItem('about').value,
        notes: form.elements.namedItem('notes').value,
        visited_on: form.elements.namedItem('visited_on').value,
        kind: form.querySelector('[data-kind][aria-checked="true"]').dataset.kind,
      };
      let badField = null;
      const showErr = (field, msg) => {
        const p = el.querySelector(`[data-err="${field}"]`);
        if (p) { p.textContent = msg; p.classList.remove('hidden'); }
        badField = badField || field;
      };
      for (const f of ['name', 'visited_on', 'form']) {
        const p = el.querySelector(`[data-err="${f}"]`);
        if (p) { p.classList.add('hidden'); p.textContent = ''; }
      }
      if (!body.name.trim()) showErr('name', 'Donnez un nom au lieu.');
      if (!body.visited_on || body.visited_on > ME.today) {
        showErr('visited_on', 'Choisissez une date passée ou d’aujourd’hui.');
      }
      const videoRows = [...videosBox.querySelectorAll('[data-video-url]')]
        .map((inp) => inp.value.trim()).filter(Boolean);
      if (videoRows.some((u) => !/^https:\/\//.test(u))) {
        showErr('form', 'Collez une adresse qui commence par https://');
      }
      if (badField) return;

      try {
        if (editing) {
          for (const u of videoRows) {
            if (!place.media.some((m) => m.kind === 'video' && m.url === u)) {
              await api('/api/places/' + id + '/media', { method: 'POST', body: { kind: 'video', url: u } });
            }
          }
          const data = await api('/api/places/' + id, { method: 'PATCH', body });
          dirty = false;
          toast('Modifications enregistrées');
          nav('/lieux/' + id, 'pop', true);
          void data;
        } else {
          const data = await api('/api/places', { method: 'POST', body });
          const newId = data.place.id;
          pendingUploads = previews.splice(0, previews.length);
          dirty = false;
          toast('Lieu enregistré');
          // The form screen is replaced by the new place's page, where the
          // chosen photos finish uploading.
          history.replaceState({}, '', href('/lieux/' + newId));
          render('push');
        }
      } catch (err) {
        if (err.field) showErr(err.field === 'form' ? 'form' : err.field, err.message || 'Champ invalide.');
        else {
          showErr('form', 'Enregistrement impossible pour le moment.');
        }
      }
    });

    // Delete (editing only).
    const delBtn = el.querySelector('[data-delete-place]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const nPhotos = place.photo_count, nVideos = place.video_count;
      const withMedia = nPhotos || nVideos
        ? `${nPhotos ? pl(nPhotos, 'photo', 'photos') : ''}${nPhotos && nVideos ? ' et ' : ''}${nVideos ? pl(nVideos, 'vidéo', 'vidéos') : ''} de ce lieu seront également supprimées.` : '';
      const ok = await confirmDialog('Supprimer ce lieu ?', withMedia, 'Supprimer');
      if (!ok) return;
      try {
        const del = await api('/api/places/' + id, { method: 'DELETE' });
        if (window.usernode && window.usernode.deleteFile) {
          for (const fid of del.file_ids || []) {
            window.usernode.deleteFile(fid).catch((e) => console.warn('deleteFile failed:', e && e.message));
          }
        }
        dirty = false;
        toast('Lieu supprimé');
        nav('/', 'pop', true);
      } catch (_) { toast('Suppression impossible pour le moment'); }
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  // The Mes lieux shell goes up at once, before /api/me answers, so the
  // screen never starts blank.
  (async () => {
    if (location.pathname === '/') homeShell();
    try { ME = await api('/api/me'); } catch (_) { /* keep the local default */ }
    render('none');
  })();
})();
