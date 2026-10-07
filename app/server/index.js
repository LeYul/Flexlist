// Flexlist — serveur HTTP (API + application web installable).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JsonFile } from './store.js';
import { Catalog, movieScore, seriesScore } from './catalog.js';
import { Library } from './library.js';
import { Favorites, STATUS_LABELS } from './favorites.js';
import { ArrClient, LANGS, QUALITIES } from './arr.js';
import { log, HOUR, DAY } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

// ---------------------------------------------------------------- Réglages

const settings = new JsonFile(DATA_DIR, 'settings.json', {
  radarr: { url: process.env.RADARR_URL || '', apiKey: process.env.RADARR_API_KEY || '', rootFolder: '', enabled: true },
  sonarr: { url: process.env.SONARR_URL || '', apiKey: process.env.SONARR_API_KEY || '', rootFolder: '', enabled: true },
  defaults: { lang: 'multi', quality: 'balanced', seasons: 'all', searchNow: true },
  searchIntervalHours: 6,
  libraryScanMinutes: 30,
  catalogRefreshHours: 12,
  libraryPath: process.env.LIBRARY_PATH || '/netflex',
  passwordHash: null,
  secret: crypto.randomBytes(24).toString('hex'),
});
// Les variables d'environnement complètent les réglages vides (pratique pour le déploiement Docker).
for (const k of ['radarr', 'sonarr']) {
  const E = k.toUpperCase();
  if (!settings.data[k].url && process.env[`${E}_URL`]) settings.data[k].url = process.env[`${E}_URL`];
  if (!settings.data[k].apiKey && process.env[`${E}_API_KEY`]) settings.data[k].apiKey = process.env[`${E}_API_KEY`];
}
if (process.env.LIBRARY_PATH) settings.data.libraryPath = process.env.LIBRARY_PATH;
if (process.env.APP_PASSWORD && !settings.data.passwordHash) settings.data.passwordHash = hashPassword(process.env.APP_PASSWORD);
settings.saveNow();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
const sessionToken = () => crypto.createHmac('sha256', settings.data.secret).update(String(settings.data.passwordHash)).digest('hex');

// ---------------------------------------------------------------- Services

const catalog = new Catalog(DATA_DIR);
const library = new Library(DATA_DIR, () => settings.data.libraryPath);
const favorites = new Favorites(DATA_DIR, { settings, library, catalog });

const owned = (it) => !!library.match(it);

// ---------------------------------------------------------------- Tâches planifiées

const tasks = {
  scan: { label: 'Lecture de la vidéothèque NETFLEX', every: () => (Number(settings.data.libraryScanMinutes) || 30) * 60_000, fn: () => library.scan(), progress: () => library.progress.scan },
  identify: { label: 'Identification des titres (affiches)', every: () => 6 * HOUR, fn: () => identifyLibrary(), progress: () => library.progress.identify },
  movies: { label: 'Mise à jour des films populaires', every: () => (Number(settings.data.catalogRefreshHours) || 12) * HOUR, fn: () => catalog.refreshMovies(library.recoCounts(), owned), progress: () => catalog.progress.movies },
  trending: { label: 'Séries du moment', every: () => 12 * HOUR, fn: () => catalog.refreshSeriesTrending(), progress: () => catalog.progress.trending || catalog.progress.akas },
  crawl: { label: 'Index des séries populaires', every: () => 7 * DAY, fn: () => catalog.crawlSeries(), progress: () => catalog.progress.crawl || catalog.progress.akas },
  sync: { label: 'Suivi des favoris et recherches', every: () => 10 * 60_000, fn: () => favorites.syncAll(), progress: () => null },
};
const taskState = new JsonFile(DATA_DIR, 'tasks.json', { last: {} });

async function runTask(name) {
  const t = tasks[name];
  if (!t || t.running) return false;
  t.running = true;
  t.error = null;
  const start = Date.now();
  try {
    await t.fn();
    taskState.data.last[name] = Date.now();
    taskState.save();
  } catch (err) {
    t.error = err.message;
    log('tâche', `${name} : ${err.message}`);
  } finally {
    t.running = false;
    t.duration = Date.now() - start;
  }
  return true;
}

async function identifyLibrary() {
  if (!library.needsIdentify()) return;
  let radarrMovies = [];
  let sonarrSeries = [];
  const r = favorites.client('movie');
  const s = favorites.client('series');
  if (r) try { radarrMovies = await r.allItems(); } catch (err) { log('identify', `Radarr : ${err.message}`); }
  if (s) try { sonarrSeries = await s.allItems(); } catch (err) { log('identify', `Sonarr : ${err.message}`); }
  await library.identify({ radarrMovies, sonarrSeries, catalog });
}

const due = (name) => Date.now() - (taskState.data.last[name] || 0) >= tasks[name].every();

async function startup() {
  // Ordre pensé pour que l'application soit utile au plus vite.
  await runTask('scan');
  if (due('movies') || !catalog.d.lists.movies_trending) await runTask('movies');
  if (due('trending') || !catalog.d.lists.series_trending) await runTask('trending');
  await runTask('sync');
  await runTask('identify');
  if (due('crawl') || !catalog.d.lists.series_popular) await runTask('crawl');
  // Une fois la bibliothèque identifiée, les suggestions « Pour vous » deviennent possibles.
  if (!(catalog.d.lists.movies_forYou || []).length) await runTask('movies');
}

setInterval(async () => {
  for (const name of ['scan', 'sync', 'movies', 'trending', 'crawl', 'identify']) {
    if (due(name)) {
      await runTask(name);
      if (name === 'scan') {
        await runTask('identify');
        await runTask('sync');
      }
    }
  }
}, 60_000).unref();

// ---------------------------------------------------------------- Vues

const favMap = () => new Map(favorites.list.map((f) => [f.key, f]));

function card(it, fm = favMap()) {
  if (!it) return null;
  const fav = fm.get(it.key);
  return {
    key: it.key,
    type: it.type,
    title: it.title,
    originalTitle: it.originalTitle !== it.title ? it.originalTitle : null,
    year: it.year,
    endYear: it.endYear || null,
    poster: it.poster,
    genres: (it.genres || []).slice(0, 3),
    rating: it.type === 'movie' ? it.ratings?.imdb || it.ratings?.tmdb || null : it.rating,
    originalLanguage: it.originalLanguage || null,
    inLibrary: library.match(it),
    fav: fav ? fav.status : null,
  };
}

function swipeCard(it, fm) {
  return {
    ...card(it, fm),
    posterHd: it.posterHd,
    backdrop: it.backdrop || null,
    overview: it.overview,
    runtime: it.runtime,
    network: it.network || null,
    status: it.status || null,
    director: it.director || null,
    ratings: it.ratings || null,
  };
}

function moviePool() {
  const names = ['movies_trending', 'movies_popular', 'movies_imdbPopular', 'movies_forYou', 'movies_discover', 'movies_top250'];
  const seen = new Set();
  const out = [];
  for (const n of names) for (const m of catalog.list(n)) if (!seen.has(m.tmdbId)) { seen.add(m.tmdbId); out.push(m); }
  return out;
}

function seriesPool(limit = 900) {
  const seen = new Set();
  const out = [];
  for (const s of [...catalog.list('series_trending'), ...catalog.list('series_popular').slice(0, limit)]) {
    if (!seen.has(s.tvmazeId)) { seen.add(s.tvmazeId); out.push(s); }
  }
  return out;
}

function discover() {
  const fm = favMap();
  const isFresh = (it) => it && !owned(it) && !favorites.isDismissed(it.key);
  const rows = [];
  const used = new Set(); // un titre n'apparaît que dans une seule rangée
  const add = (id, title, subtitle, items, limit = 30) => {
    const list = [];
    for (const it of items) {
      if (!isFresh(it) || used.has(it.key)) continue;
      used.add(it.key);
      list.push(card(it, fm));
      if (list.length >= limit) break;
    }
    if (list.length >= 3) rows.push({ id, title, subtitle, items: list });
  };

  const hero = catalog.list('movies_trending').filter((m) => isFresh(m) && m.backdrop && m.overview).slice(0, 6).map((m) => swipeCard(m, fm));

  const mAff = library.genreAffinity('movie');
  const sAff = library.genreAffinity('series');
  const affinityScore = (aff) => (it) => (it.genres || []).reduce((a, g) => a + (aff.get(g) || 0), 0);

  add('movies_trending', 'Films tendance de la semaine', 'Ce dont tout le monde parle', catalog.list('movies_trending'));
  add('series_trending', 'Séries du moment', 'Diffusées ces 7 derniers jours', catalog.list('series_trending'));
  add('movies_forYou', 'Pour vous', 'D’après les films de votre NETFLEX', catalog.list('movies_forYou'), 40);
  add('movies_popular', 'Films populaires', 'TMDb & IMDb', [...catalog.list('movies_popular'), ...catalog.list('movies_imdbPopular')].sort((a, b) => movieScore(b) - movieScore(a)), 40);
  const sPop = catalog.list('series_popular').slice(0, 400);
  add('series_popular', 'Séries les plus suivies', null, sPop, 40);
  const sAffScore = affinityScore(sAff);
  add('series_forYou', 'Séries pour vous', 'Selon les genres de votre collection', [...sPop].sort((a, b) => sAffScore(b) * 4 + seriesScore(b) - (sAffScore(a) * 4 + seriesScore(a))), 40);
  add('movies_top250', 'Grands classiques à rattraper', 'Top 250 IMDb', [...catalog.list('movies_top250')].sort((a, b) => (b.ratings?.imdbVotes || 0) - (a.ratings?.imdbVotes || 0)), 50);
  add('series_ended', 'Séries terminées à dévorer', 'Intégrales notées 8+ ', sPop.filter((s) => s.status === 'Ended' && (s.rating || 0) >= 8), 40);

  const pool = moviePool();
  const topGenres = [...mAff.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g);
  for (const g of topGenres) {
    add(`genre_${g}`, g, 'Parce que c’est un de vos genres favoris', pool.filter((m) => m.genres.includes(g)).sort((a, b) => movieScore(b) - movieScore(a)), 30);
  }
  return { hero, rows };
}

function swipeDeck({ type = 'all', genre = '', exclude = [] }) {
  const fm = favMap();
  const ex = new Set(exclude);
  const ok = (it) => it && it.poster && !owned(it) && !fm.has(it.key) && !favorites.isDismissed(it.key) && !ex.has(it.key) && (!genre || (it.genres || []).includes(genre));
  const cands = [];
  if (type !== 'series') for (const m of moviePool()) if (ok(m)) cands.push([m, movieScore(m) / 14]);
  if (type !== 'movie') for (const s of seriesPool()) if (ok(s)) cands.push([s, seriesScore(s) / 19]);
  return cands
    .map(([it, sc]) => [it, sc * (0.55 + Math.random() * 0.9)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([it]) => swipeCard(it, fm));
}

function genres() {
  const set = new Map();
  for (const it of [...moviePool(), ...seriesPool(400)]) for (const g of it.genres || []) set.set(g, (set.get(g) || 0) + 1);
  return [...set.entries()].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

async function resolveItem(key) {
  const [type, id] = String(key).split(':');
  if (type === 'movie') return catalog.getMovie(Number(id));
  if (type === 'series') return catalog.getShow(Number(id));
  throw Object.assign(new Error('Clé invalide'), { status: 400 });
}

async function itemDetail(key) {
  const it = await resolveItem(key);
  const fm = favMap();
  const libId = library.match(it);
  const libEntry = libId ? library.view(library.byId.get(libId)) : null;
  let extras = null;
  let similar = [];
  if (it.type === 'movie') {
    const missing = (it.recos || []).filter((id) => !catalog.d.movies[id]);
    if (missing.length) await catalog.fetchMoviesBulk(missing.slice(0, 15));
    similar = (it.recos || []).map((id) => catalog.d.movies[id]).filter(Boolean).map((m) => card(m, fm));
    catalog.file.save();
  } else {
    try { extras = await catalog.getShowExtras(it.tvmazeId); } catch {}
  }
  const fav = fm.get(it.key);
  return {
    item: { ...it, keys: undefined },
    extras,
    similar,
    library: libEntry,
    favorite: fav ? favorites.view(fav) : null,
    dismissed: favorites.isDismissed(it.key),
  };
}

function libraryList(type) {
  const src = type === 'series' ? library.d.series : library.d.movies;
  const favByLib = new Map(favorites.list.filter((f) => f.libraryId).map((f) => [f.libraryId, f.status]));
  return src.map((e) => {
    const v = library.view(e);
    return {
      id: v.id,
      key: v.key,
      type: v.type,
      title: v.displayTitle,
      folder: v.folder,
      originalTitle: v.originalTitle && v.originalTitle !== v.displayTitle ? v.originalTitle : null,
      year: v.year,
      yearEnd: v.yearEnd ?? null,
      running: v.running || false,
      poster: v.poster,
      genres: v.genres,
      rating: v.rating,
      size: v.size,
      files: v.files,
      episodes: v.episodes,
      seasons: v.seasons ? v.seasons.length : undefined,
      addedAt: v.addedAt,
      identified: v.identified,
      fromFavorite: favByLib.has(v.id),
    };
  });
}

function settingsView() {
  const s = settings.data;
  const mask = (k) => (k ? `••••••••${String(k).slice(-4)}` : '');
  return {
    radarr: { url: s.radarr.url, apiKey: mask(s.radarr.apiKey), hasKey: !!s.radarr.apiKey, rootFolder: s.radarr.rootFolder, enabled: s.radarr.enabled !== false },
    sonarr: { url: s.sonarr.url, apiKey: mask(s.sonarr.apiKey), hasKey: !!s.sonarr.apiKey, rootFolder: s.sonarr.rootFolder, enabled: s.sonarr.enabled !== false },
    defaults: s.defaults,
    searchIntervalHours: s.searchIntervalHours,
    libraryScanMinutes: s.libraryScanMinutes,
    catalogRefreshHours: s.catalogRefreshHours,
    libraryPath: s.libraryPath,
    passwordSet: !!s.passwordHash,
    options: {
      langs: Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.label])),
      qualities: Object.fromEntries(Object.entries(QUALITIES).map(([k, v]) => [k, v.label])),
    },
  };
}

function applySettings(body) {
  const s = settings.data;
  for (const k of ['radarr', 'sonarr']) {
    const b = body[k];
    if (!b) continue;
    if (typeof b.url === 'string') s[k].url = b.url.trim().replace(/\/+$/, '');
    if (typeof b.apiKey === 'string' && !b.apiKey.includes('•')) s[k].apiKey = b.apiKey.trim();
    if (typeof b.rootFolder === 'string') s[k].rootFolder = b.rootFolder;
    if (typeof b.enabled === 'boolean') s[k].enabled = b.enabled;
  }
  if (body.defaults) s.defaults = { ...s.defaults, ...body.defaults };
  for (const k of ['searchIntervalHours', 'libraryScanMinutes', 'catalogRefreshHours']) {
    if (body[k] !== undefined && Number(body[k]) > 0) s[k] = Number(body[k]);
  }
  if (typeof body.libraryPath === 'string' && body.libraryPath.trim()) s.libraryPath = body.libraryPath.trim();
  if (typeof body.password === 'string') s.passwordHash = body.password ? hashPassword(body.password) : null;
  settings.saveNow();
}

function stateView() {
  const fl = favorites.list;
  const count = (st) => fl.filter((f) => f.status === st).length;
  return {
    version: VERSION,
    connections: { radarr: !!favorites.client('movie'), sonarr: !!favorites.client('series') },
    library: { movies: library.d.movies.length, series: library.d.series.length, scannedAt: library.d.scannedAt, error: library.d.error },
    catalog: {
      movies: Object.keys(catalog.d.movies).length,
      series: Object.keys(catalog.d.series).length,
      updated: catalog.d.updated,
    },
    favorites: { total: fl.length, active: fl.filter((f) => f.status !== 'available').length, available: count('available'), notfound: count('notfound'), downloading: count('downloading') },
    tasks: Object.fromEntries(Object.entries(tasks).map(([k, t]) => [k, { label: t.label, running: !!t.running, last: taskState.data.last[k] || null, error: t.error || null, progress: t.running ? t.progress() : null }])),
    syncedAt: favorites.file.data.syncedAt || null,
    statusLabels: STATUS_LABELS,
  };
}

// ---------------------------------------------------------------- HTTP

const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler, open });
};

route('GET', '/api/auth', (req) => ({ required: !!settings.data.passwordHash, ok: authed(req) }), { open: true });
route('POST', '/api/login', (req, body, res) => {
  if (!settings.data.passwordHash) return { ok: true };
  if (!checkPassword(body.password || '', settings.data.passwordHash)) throw Object.assign(new Error('Mot de passe incorrect'), { status: 401 });
  res.setHeader('Set-Cookie', `flx=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
  return { ok: true };
}, { open: true });
route('POST', '/api/logout', (req, body, res) => {
  res.setHeader('Set-Cookie', 'flx=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/state', () => stateView());
route('GET', '/api/discover', () => discover());
route('GET', '/api/genres', () => genres());
route('GET', '/api/swipe', (req, body, res, q) => swipeDeck({ type: q.get('type') || 'all', genre: q.get('genre') || '', exclude: (q.get('exclude') || '').split(',').filter(Boolean) }));
route('POST', '/api/dismiss', (req, body) => { favorites.dismiss(body.key); return { ok: true }; });
route('DELETE', '/api/dismiss/:key', (req, body, res, q, p) => { favorites.undismiss(decodeURIComponent(p.key)); return { ok: true }; });

route('GET', '/api/search', async (req, body, res, q) => {
  const term = (q.get('q') || '').trim();
  if (term.length < 2) return { movies: [], series: [], library: [] };
  const fm = favMap();
  const r = await catalog.search(term);
  const needle = term.toLowerCase();
  const lib = [...libraryList('movie'), ...libraryList('series')].filter((e) => `${e.title} ${e.originalTitle || ''} ${e.folder}`.toLowerCase().includes(needle)).slice(0, 30);
  return { movies: r.movies.map((m) => card(m, fm)), series: r.series.map((s) => card(s, fm)), library: lib, errors: r.errors };
});

route('GET', '/api/item/:key', async (req, body, res, q, p) => itemDetail(decodeURIComponent(p.key)));

route('GET', '/api/favorites', () => ({ items: favorites.list.map((f) => favorites.view(f)), syncedAt: favorites.file.data.syncedAt || null }));
route('POST', '/api/favorites', async (req, body) => {
  const it = await resolveItem(body.key);
  const by = decodeURIComponent(req.headers['x-flexlist-user'] || '') || null;
  const fav = await favorites.add(it, { ...settings.data.defaults, ...(body.prefs || {}) }, by);
  if (body.prefs && body.rememberDefaults) {
    const { lang, quality, seasons, searchNow } = body.prefs;
    settings.data.defaults = { ...settings.data.defaults, lang, quality, ...(it.type === 'series' ? { seasons } : {}), searchNow };
    settings.save();
  }
  return favorites.view(fav);
});
route('PATCH', '/api/favorites/:key', async (req, body, res, q, p) => {
  const fav = await favorites.updatePrefs(decodeURIComponent(p.key), body.prefs || {});
  if (!fav) throw Object.assign(new Error('Favori introuvable'), { status: 404 });
  return favorites.view(fav);
});
route('DELETE', '/api/favorites/:key', async (req, body, res, q, p) => ({ ok: await favorites.remove(decodeURIComponent(p.key), { unmonitor: q.get('unmonitor') !== 'false' }) }));
route('POST', '/api/favorites/:key/search', async (req, body, res, q, p) => {
  const fav = await favorites.searchNow(decodeURIComponent(p.key));
  if (!fav) throw Object.assign(new Error('Favori introuvable'), { status: 404 });
  return favorites.view(fav);
});
route('POST', '/api/favorites/sync', async () => {
  await runTask('sync');
  return { ok: true };
});

route('GET', '/api/library', (req, body, res, q) => ({
  scannedAt: library.d.scannedAt,
  error: library.d.error,
  movies: q.get('type') === 'series' ? undefined : libraryList('movie'),
  series: q.get('type') === 'movie' ? undefined : libraryList('series'),
}));
route('GET', '/api/library/:id', (req, body, res, q, p) => {
  const e = library.byId?.get(p.id);
  if (!e) throw Object.assign(new Error('Élément introuvable'), { status: 404 });
  return library.view(e);
});

route('GET', '/api/settings', () => settingsView());
route('PUT', '/api/settings', (req, body) => {
  applySettings(body);
  if (body.password !== undefined) {
    // Le mot de passe vient de changer : on garde la session de la personne qui l'a modifié.
    return { ...settingsView(), _cookie: true };
  }
  return settingsView();
});
route('POST', '/api/settings/test', async (req, body) => {
  const conf = settings.data[body.service];
  if (!conf) throw Object.assign(new Error('Service inconnu'), { status: 400 });
  const apiKey = body.apiKey && !body.apiKey.includes('•') ? body.apiKey : conf.apiKey;
  const c = new ArrClient(body.service, { url: body.url || conf.url, apiKey });
  if (!c.ok) throw Object.assign(new Error('Adresse et clé API requises'), { status: 400 });
  return c.test();
});
route('POST', '/api/tasks/:name', (req, body, res, q, p) => {
  if (!tasks[p.name]) throw Object.assign(new Error('Tâche inconnue'), { status: 404 });
  runTask(p.name).then(() => (p.name === 'scan' ? runTask('identify') : null));
  return { started: true };
});

function authed(req) {
  if (!settings.data.passwordHash) return true;
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)flx=([a-f0-9]+)/);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(sessionToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(req, res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  const gzip = body.length > 4096 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    ...headers,
  });
  res.end(gzip ? zlib.gzipSync(body) : body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    const ext = path.extname(file);
    const compressible = /\.(html|js|css|json|svg|webmanifest)$/.test(ext);
    const gzip = compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': /\.(png|ico)$/.test(ext) ? 'public, max-age=604800' : 'no-cache',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(gzip ? zlib.gzipSync(buf) : buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) return send(req, res, 404, { error: 'Route inconnue' });
  if (!r.open && !authed(req)) return send(req, res, 401, { error: 'Authentification requise', auth: true });

  let body = {};
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try { body = JSON.parse(raw); } catch { return send(req, res, 400, { error: 'JSON invalide' }); }
    }
  }
  const m = url.pathname.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
  try {
    const out = await r.handler(req, body, res, url.searchParams, params);
    if (out && out._cookie) {
      delete out._cookie;
      res.setHeader('Set-Cookie', `flx=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
    }
    send(req, res, 200, out ?? { ok: true });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) log('api', `${req.method} ${url.pathname} : ${err.message}`);
    send(req, res, status === 401 && !err.auth ? 400 : status, { error: err.message || 'Erreur interne' });
  }
});

server.listen(PORT, () => {
  log('flexlist', `v${VERSION} à l'écoute sur http://0.0.0.0:${PORT} — données : ${DATA_DIR} — vidéothèque : ${settings.data.libraryPath}`);
  startup().catch((err) => log('flexlist', `démarrage : ${err.message}`));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const f of [settings, catalog.file, library.file, library.ident, favorites.file, taskState]) {
      try { if (f.timer) f.saveNow(); } catch {}
    }
    process.exit(0);
  });
}
