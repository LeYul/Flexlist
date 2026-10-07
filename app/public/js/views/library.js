import { api, bus } from '../app.js';
import { $, $$, esc, icon, cardHtml, bytes, ago, STATUS_ICON } from '../ui.js';

let root;
let data = null;
let favs = [];
let tab = 'movies';
let q = '';
let sort = 'title';
let genre = '';
let list = [];
let shown = 0;
let observer = null;
let loadedAt = 0;
const CHUNK = 120;

export function mount(el) {
  root = el;
  root.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>NETFLEX</h1><p id="l-sub">Tout ce qui est déjà sur le NAS.</p></div>
      <button class="btn" data-l="rescan">${icon('refresh')}Relire le NAS</button></div>
    <div class="stat-row" id="l-stats"></div>
    <div class="lib-tools">
      <div class="seg" id="l-tabs" style="min-width:300px">
        <button data-tab="movies" class="active">Films</button><button data-tab="series">Séries</button><button data-tab="favs">Favoris</button>
      </div>
      <div class="search-box">${icon('search')}<input class="input" id="l-q" type="search" placeholder="Filtrer la collection…" autocomplete="off" style="height:44px;font-size:15px"></div>
      <select class="input" id="l-sort" aria-label="Trier">
        <option value="title">Titre (A → Z)</option>
        <option value="recent">Ajouts récents</option>
        <option value="year">Année (récent d’abord)</option>
        <option value="rating">Mieux notés</option>
        <option value="size">Taille</option>
      </select>
      <select class="input" id="l-genre" aria-label="Genre"><option value="">Tous les genres</option></select>
    </div>
    <div class="grid" id="l-grid"></div>
    <div id="l-sentinel" style="height:40px"></div>
  </div>`;

  $('#l-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    $$('#l-tabs button', root).forEach((x) => x.classList.toggle('active', x === b));
    genre = '';
    refresh();
  });
  let t = null;
  $('#l-q', root).addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); refresh(); }, 150);
  });
  $('#l-sort', root).addEventListener('change', (e) => { sort = e.target.value; refresh(); });
  $('#l-genre', root).addEventListener('change', (e) => { genre = e.target.value; refresh(); });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-l="rescan"]');
    if (!b) return;
    b.disabled = true;
    b.innerHTML = `${icon('loader', 'spin')}Lecture…`;
    await api('/tasks/scan', { method: 'POST' }).catch(() => {});
    setTimeout(async () => { await load(); b.disabled = false; b.innerHTML = `${icon('refresh')}Relire le NAS`; }, 4000);
  });

  observer = new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting)) more();
  }, { rootMargin: '800px' });
  observer.observe($('#l-sentinel', root));
  bus.addEventListener('favorites-changed', () => { loadedAt = 0; });
}

export function show(params) {
  if (params?.get('tab') && ['movies', 'series', 'favs'].includes(params.get('tab'))) {
    tab = params.get('tab');
    $$('#l-tabs button', root).forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  }
  if (Date.now() - loadedAt > 2 * 60_000) load();
}

async function load() {
  loadedAt = Date.now();
  if (!data) $('#l-grid', root).innerHTML = Array.from({ length: 18 }, () => '<div class="skel" style="aspect-ratio:2/3"></div>').join('');
  try {
    const [lib, f] = await Promise.all([api('/library'), api('/favorites')]);
    data = lib;
    favs = f.items;
    $('#l-sub', root).textContent = lib.error ? `⚠ ${lib.error}` : lib.scannedAt ? `Lu sur le NAS ${ago(lib.scannedAt)} · mise à jour automatique.` : 'Lecture du NAS en cours…';
    if (!lib.scannedAt) { loadedAt = 0; setTimeout(() => root.classList.contains('active') && load(), 5000); }
    refresh();
  } catch (err) {
    loadedAt = 0;
    $('#l-grid', root).innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">${icon('alert')}</div><h3>Lecture impossible</h3><p>${esc(err.message)}</p></div>`;
  }
}

function source() {
  if (!data) return [];
  if (tab === 'favs') {
    return favs.map((f) => ({
      key: f.key,
      type: f.type,
      title: f.item.title,
      year: f.item.year,
      endYear: f.item.endYear,
      poster: f.item.poster,
      genres: f.item.genres || [],
      rating: f.item.ratings?.imdb || f.item.rating || null,
      addedAt: f.addedAt,
      status: f.status,
      statusLabel: f.statusLabel,
      fav: f.status,
    }));
  }
  return (tab === 'series' ? data.series : data.movies) || [];
}

function refresh() {
  const src = source();
  // Genres disponibles pour l'onglet courant.
  const counts = new Map();
  for (const it of src) for (const g of it.genres || []) counts.set(g, (counts.get(g) || 0) + 1);
  const sel = $('#l-genre', root);
  sel.innerHTML = `<option value="">Tous les genres</option>${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `<option value="${esc(g)}" ${g === genre ? 'selected' : ''}>${esc(g)} (${n})</option>`).join('')}`;

  list = src.filter((it) => (!genre || (it.genres || []).includes(genre)) && (!q || `${it.title} ${it.originalTitle || ''} ${it.folder || ''} ${it.year || ''}`.toLowerCase().includes(q)));
  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
    recent: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    size: (a, b) => (b.size || 0) - (a.size || 0),
  }[sort];
  list.sort(cmp);

  stats(src);
  shown = 0;
  $('#l-grid', root).innerHTML = list.length ? '' : `<div class="empty" style="grid-column:1/-1"><p>${tab === 'favs' ? 'Aucun favori.' : 'Aucun titre ne correspond.'}</p></div>`;
  more();
}

function stats(src) {
  const box = $('#l-stats', root);
  if (!data) return (box.innerHTML = '');
  if (tab === 'favs') {
    const avail = src.filter((x) => x.status === 'available').length;
    box.innerHTML = `<div class="stat"><b>${src.length}</b><span>favoris</span></div><div class="stat"><b>${avail}</b><span>déjà arrivés</span></div><div class="stat"><b>${src.length - avail}</b><span>en attente</span></div>`;
    return;
  }
  const size = src.reduce((a, x) => a + (x.size || 0), 0);
  const ident = src.filter((x) => x.identified).length;
  const extra = tab === 'series' ? `<div class="stat"><b>${src.reduce((a, x) => a + (x.episodes || 0), 0).toLocaleString('fr-FR')}</b><span>épisodes</span></div>` : '';
  box.innerHTML = `<div class="stat"><b>${src.length.toLocaleString('fr-FR')}</b><span>${tab === 'series' ? 'séries' : 'films'}</span></div>${extra}<div class="stat"><b>${bytes(size)}</b><span>sur le NAS</span></div><div class="stat"><b>${src.length ? Math.round((ident / src.length) * 100) : 0} %</b><span>identifiés (affiches)</span></div>`;
}

function more() {
  if (!list.length || shown >= list.length) return;
  const slice = list.slice(shown, shown + CHUNK);
  shown += slice.length;
  const html = slice.map((it) => {
    if (tab === 'favs') {
      return cardHtml({ ...it, inLibrary: it.status === 'available', sub: it.statusLabel }, { quickAdd: false });
    }
    const sub = it.type === 'series'
      ? [it.year ? `${it.year}${it.running ? '–…' : it.yearEnd && it.yearEnd !== it.year ? `–${it.yearEnd}` : ''}` : '', it.seasons ? `${it.seasons} saison${it.seasons > 1 ? 's' : ''}` : '', `${it.episodes} ép.`].filter(Boolean).join(' · ')
      : [it.year, bytes(it.size)].filter(Boolean).join(' · ');
    return cardHtml({ ...it, key: it.key || `lib:${it.id}`, inLibrary: false, fav: null, sub }, { quickAdd: false });
  }).join('');
  $('#l-grid', root).insertAdjacentHTML('beforeend', html);
}
