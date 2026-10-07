// Lecture de la vidéothèque NETFLEX (lecture seule) et identification des titres.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { JsonFile } from './store.js';
import { mapLimit, titleKeys, looseKey, withoutArticle, wordSimilarity, genreFr, log, DAY } from './util.js';
import { meta, maze, skyhookSearch, normalizeMovie, normalizeShow } from './catalog.js';

// À incrémenter quand les règles d'identification changent (déclenche une migration locale).
const IDENT_VERSION = 3;

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.m2ts', '.mpg', '.mpeg', '.webm', '.flv', '.divx', '.vob', '.iso']);
const SKIP = (name) => /^[@.#]/.test(name) || name === 'lost+found';
const nfc = (s) => s.normalize('NFC');
const hashId = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

export function parseMovieFolder(name) {
  const m = name.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1].trim(), year: Number(m[2]) };
  const y = name.match(/^(.*?)[\s._-]+(19\d{2}|20\d{2})(?:\D.*)?$/);
  if (y) return { title: y[1].replace(/[._]/g, ' ').trim(), year: Number(y[2]) };
  return { title: name.replace(/[._]/g, ' ').trim(), year: null };
}

export function parseSeriesFolder(name) {
  const m = name.match(/^(.*?)\s*\((\d{4})(?:\s*-\s*(\d{4}|en cours))?\)\s*$/i);
  let title = m ? m[1].trim() : name.trim();
  const yearStart = m ? Number(m[2]) : null;
  const yearEnd = m && m[3] && /^\d{4}$/.test(m[3]) ? Number(m[3]) : null;
  const running = !!(m && m[3] && /en cours/i.test(m[3]));
  const country = (title.match(/\((US|UK|FR|CA|AU)\)$/i) || [])[1] || null;
  const searchTitle = title.replace(/\s*\([^)]*\)\s*$/, '').trim() || title;
  return { title, searchTitle, yearStart, yearEnd, running, country };
}

async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function videoFilesIn(dir, depth = 0, maxDepth = 1) {
  const out = [];
  for (const e of await safeReaddir(dir)) {
    if (SKIP(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < maxDepth) {
      out.push(...(await videoFilesIn(full, depth + 1, maxDepth)));
    } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
      let size = 0;
      try { size = (await fs.stat(full)).size; } catch {}
      out.push({ name: nfc(e.name), size, rel: path.relative(dir, full) });
    }
  }
  return out;
}

export class Library {
  constructor(dataDir, getRoot) {
    this.getRoot = getRoot;
    this.file = new JsonFile(dataDir, 'library.json', { scannedAt: 0, root: null, movies: [], series: [], error: null });
    this.ident = new JsonFile(dataDir, 'identify.json', { movies: {}, series: {} });
    this.progress = {};
    this.busy = {};
    if (this.ident.data.identVersion !== IDENT_VERSION) {
      // Recalcule les clés de correspondance à partir des titres connus (sans requête réseau).
      // Les échecs sont oubliés pour être retentés avec la nouvelle règle.
      for (const src of [this.ident.data.movies, this.ident.data.series]) {
        for (const [k, rec] of Object.entries(src)) {
          const entry = (src === this.ident.data.movies ? this.d.movies : this.d.series).find((e) => e.folder === k);
          const fy = entry ? entry.year ?? entry.yearStart : null;
          // Échecs et associations dont l'année ne colle pas : à refaire.
          if (!rec || rec.fail || (fy && rec.year && Math.abs(fy - rec.year) > 2)) delete src[k];
          else rec.keys = titleKeys([rec.title, rec.originalTitle]);
        }
      }
      this.ident.data.identVersion = IDENT_VERSION;
      this.ident.save();
    }
    this.buildIndex();
  }

  get d() {
    return this.file.data;
  }

  // ---------- Scan ----------

  async findSubdir(root, wanted) {
    const entries = await safeReaddir(root);
    const keys = new Set(wanted.map((w) => looseKey(w)));
    return entries.find((e) => e.isDirectory() && keys.has(looseKey(nfc(e.name))))?.name || null;
  }

  async scan() {
    if (this.busy.scan) return;
    this.busy.scan = true;
    const root = this.getRoot();
    try {
      await fs.access(root);
      const filmsDir = await this.findSubdir(root, ['films', 'movies', 'film']);
      const seriesDir = await this.findSubdir(root, ['series', 'tv', 'seriestv', 'tvshows']);
      if (!filmsDir && !seriesDir) throw new Error(`Aucun dossier « Films » ou « Séries » dans ${root}`);

      const movies = [];
      if (filmsDir) {
        const base = path.join(root, filmsDir);
        const entries = (await safeReaddir(base)).filter((e) => !SKIP(e.name));
        let done = 0;
        await mapLimit(entries, 12, async (e) => {
          const name = nfc(e.name);
          const full = path.join(base, e.name);
          if (e.isDirectory()) {
            const files = await videoFilesIn(full, 0, 1);
            let mtime = 0;
            try { mtime = (await fs.stat(full)).mtimeMs; } catch {}
            const p = parseMovieFolder(name);
            movies.push({
              id: `m${hashId(name)}`,
              folder: name,
              ...p,
              path: `${filmsDir}/${name}`,
              files: files.length,
              size: files.reduce((a, f) => a + f.size, 0),
              mainFile: files.sort((a, b) => b.size - a.size)[0]?.name || null,
              addedAt: Math.round(mtime),
            });
          } else if (e.isFile() && VIDEO_EXT.has(path.extname(name).toLowerCase())) {
            let st = null;
            try { st = await fs.stat(full); } catch {}
            const p = parseMovieFolder(path.basename(name, path.extname(name)));
            movies.push({ id: `m${hashId(name)}`, folder: name, ...p, path: `${filmsDir}/${name}`, files: 1, size: st?.size || 0, mainFile: name, addedAt: Math.round(st?.mtimeMs || 0) });
          }
          this.progress.scan = `films ${++done}/${entries.length}`;
        });
      }

      const series = [];
      if (seriesDir) {
        const base = path.join(root, seriesDir);
        const entries = (await safeReaddir(base)).filter((e) => e.isDirectory() && !SKIP(e.name));
        let done = 0;
        await mapLimit(entries, 6, async (e) => {
          const name = nfc(e.name);
          const full = path.join(base, e.name);
          const seasons = [];
          let loose = 0;
          let size = 0;
          for (const s of await safeReaddir(full)) {
            if (SKIP(s.name)) continue;
            if (s.isDirectory()) {
              const files = await videoFilesIn(path.join(full, s.name), 0, 2);
              if (!files.length) continue;
              const sn = nfc(s.name);
              const num = (sn.match(/(?:saison|season|s)\s*0*(\d{1,3})/i) || [])[1];
              seasons.push({ name: sn, number: num ? Number(num) : null, episodes: files.length });
              size += files.reduce((a, f) => a + f.size, 0);
            } else if (s.isFile() && VIDEO_EXT.has(path.extname(s.name).toLowerCase())) {
              loose++;
              try { size += (await fs.stat(path.join(full, s.name))).size; } catch {}
            }
          }
          if (loose) seasons.push({ name: '(racine)', number: null, episodes: loose });
          let mtime = 0;
          try { mtime = (await fs.stat(full)).mtimeMs; } catch {}
          seasons.sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.name.localeCompare(b.name));
          series.push({
            id: `s${hashId(name)}`,
            folder: name,
            ...parseSeriesFolder(name),
            path: `${seriesDir}/${name}`,
            seasons,
            episodes: seasons.reduce((a, s) => a + s.episodes, 0),
            size,
            addedAt: Math.round(mtime),
          });
          this.progress.scan = `séries ${++done}/${entries.length}`;
        });
      }

      movies.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      series.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      Object.assign(this.d, { scannedAt: Date.now(), root, movies, series, error: null, folders: { films: filmsDir, series: seriesDir } });
      this.file.save();
      this.buildIndex();
      log('library', `scan terminé : ${movies.length} films, ${series.length} séries`);
    } catch (err) {
      this.d.error = err.message;
      this.file.save();
      log('library', `scan impossible : ${err.message}`);
    } finally {
      this.busy.scan = false;
      this.progress.scan = null;
    }
  }

  // ---------- Identification (affiches, ids TMDb / TVmaze) ----------

  /**
   * @param {object} hints  { radarrMovies: [{path, tmdbId}], sonarrSeries: [{path, tvdbId}], catalog }
   */
  async identify({ radarrMovies = [], sonarrSeries = [], catalog } = {}) {
    if (this.busy.identify) return;
    this.busy.identify = true;
    try {
      const im = this.ident.data.movies;
      const is = this.ident.data.series;
      const stale = (rec) => !rec || (rec.fail && Date.now() - rec.at > 30 * DAY);

      // 1) Films connus de Radarr (correspondance par nom de dossier) -> lot de métadonnées.
      const byFolder = new Map(radarrMovies.filter((m) => m.path && m.tmdbId).map((m) => [nfc(path.posix.basename(m.path.replace(/\\/g, '/'))), m.tmdbId]));
      const viaRadarr = this.d.movies.filter((m) => stale(im[m.folder]) && byFolder.has(m.folder));
      if (viaRadarr.length) {
        const ids = viaRadarr.map((m) => byFolder.get(m.folder));
        for (let i = 0; i < ids.length; i += 50) {
          try {
            const arr = await meta.post('/movie/bulk', ids.slice(i, i + 50));
            const got = new Map((arr || []).map((x) => [x.TmdbId, normalizeMovie(x)]));
            for (const m of viaRadarr.slice(i, i + 50)) {
              const item = got.get(byFolder.get(m.folder));
              if (item) im[m.folder] = this.compactMovie(item);
            }
          } catch (err) {
            log('library', `identification Radarr : ${err.message}`);
          }
          this.progress.identify = `films (Radarr) ${Math.min(i + 50, ids.length)}/${ids.length}`;
        }
        this.ident.save();
      }

      // 2) Films déjà présents dans le catalogue (titre + année).
      if (catalog) {
        const idx = new Map();
        for (const it of Object.values(catalog.d.movies)) for (const k of it.keys || []) {
          if (!idx.has(k)) idx.set(k, []);
          idx.get(k).push(it);
        }
        for (const m of this.d.movies) {
          if (!stale(im[m.folder])) continue;
          const cands = idx.get(looseKey(m.title)) || [];
          const hit = cands.find((c) => m.year && c.year && Math.abs(c.year - m.year) <= 1);
          if (hit) im[m.folder] = this.compactMovie(hit);
        }
      }

      // 3) Recherche individuelle pour le reste.
      const rest = this.d.movies.filter((m) => stale(im[m.folder]));
      let n = 0;
      for (const m of rest) {
        try {
          im[m.folder] = await this.searchMovie(m);
        } catch (err) {
          // Erreur réseau : nouvel essai dans 24 h plutôt que 30 jours.
          im[m.folder] = { fail: true, at: Date.now() - 29 * DAY, error: err.message };
        }
        this.progress.identify = `films ${++n}/${rest.length}`;
        if (n % 25 === 0) { this.ident.save(); this.buildIndex(); }
      }
      this.ident.save();

      // 4) Séries.
      const byTvdb = new Map(sonarrSeries.filter((s) => s.path && s.tvdbId).map((s) => [nfc(path.posix.basename(s.path.replace(/\\/g, '/'))), s.tvdbId]));
      const srest = this.d.series.filter((s) => stale(is[s.folder]));
      n = 0;
      for (const s of srest) {
        try {
          let show = null;
          if (byTvdb.has(s.folder)) {
            try { show = await maze.get(`/lookup/shows?thetvdb=${byTvdb.get(s.folder)}`); } catch {}
          }
          if (!show) show = await this.searchShow(s);
          if (show) is[s.folder] = this.compactShow(normalizeShow(show, catalog?.d.akas[show.id]?.fr));
          else is[s.folder] = (await this.searchShowTvdb(s)) || { fail: true, at: Date.now() };
        } catch (err) {
          is[s.folder] = { fail: true, at: Date.now() - 29 * DAY, error: err.message };
        }
        this.progress.identify = `séries ${++n}/${srest.length}`;
        if (n % 20 === 0) { this.ident.save(); this.buildIndex(); }
      }
      this.ident.save();
      this.buildIndex();
      log('library', `identification terminée (${rest.length} films et ${srest.length} séries recherchés)`);
    } finally {
      this.busy.identify = false;
      this.progress.identify = null;
    }
  }

  /** Vrai si au moins un dossier n'a pas encore été identifié (ou un échec ancien est à retenter). */
  needsIdentify() {
    const fresh = (rec) => rec && !(rec.fail && Date.now() - rec.at > 30 * DAY);
    return this.d.movies.some((m) => !fresh(this.ident.data.movies[m.folder])) || this.d.series.some((s) => !fresh(this.ident.data.series[s.folder]));
  }

  compactMovie(it) {
    return {
      tmdbId: it.tmdbId,
      imdbId: it.imdbId,
      title: it.title,
      originalTitle: it.originalTitle,
      year: it.year,
      poster: it.poster,
      backdrop: it.backdrop,
      genres: it.genres,
      rating: it.ratings?.imdb || it.ratings?.tmdb || null,
      runtime: it.runtime,
      recos: it.recos,
      keys: it.keys,
      at: Date.now(),
    };
  }

  compactShow(it) {
    return {
      tvmazeId: it.tvmazeId,
      tvdbId: it.tvdbId,
      imdbId: it.imdbId,
      title: it.title,
      originalTitle: it.originalTitle,
      year: it.year,
      poster: it.poster,
      genres: it.genres,
      rating: it.rating,
      status: it.status,
      keys: it.keys,
      at: Date.now(),
    };
  }

  async searchMovie(m) {
    const score = (c) => {
      const keys = new Set(c.keys);
      const exact = keys.has(looseKey(m.title));
      const sim = Math.max(wordSimilarity(m.title, c.title), wordSimilarity(m.title, c.originalTitle));
      const dy = m.year && c.year ? Math.abs(m.year - c.year) : 5;
      return (exact ? 1 : sim) + (dy === 0 ? 0.35 : dy === 1 ? 0.2 : dy > 2 && m.year && c.year ? -0.6 : 0) + Math.min(c.popularity || 0, 100) / 2000;
    };
    const tryQuery = async (q, withYear) => {
      const res = await meta.get(`/search?q=${encodeURIComponent(q)}${withYear && m.year ? `&year=${m.year}` : ''}`);
      return (res || []).slice(0, 10).map(normalizeMovie);
    };
    let cands = await tryQuery(m.title, true);
    if (!cands.length) cands = await tryQuery(m.title, false);
    if (!cands.length && m.title.split(' ').length > 3) cands = await tryQuery(m.title.split(' ').slice(0, 4).join(' '), true);
    const best = cands.map((c) => [c, score(c)]).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 0.75) return { fail: true, at: Date.now() };
    return this.compactMovie(best[0]);
  }

  async searchShow(s) {
    let res = await maze.get(`/search/shows?q=${encodeURIComponent(s.searchTitle)}`);
    const alt = withoutArticle(s.searchTitle);
    if (alt && alt !== s.searchTitle) res = [...(res || []), ...((await maze.get(`/search/shows?q=${encodeURIComponent(alt)}`)) || [])];
    const cands = (res || []).map((r) => r.show).filter(Boolean);
    const yr = (x) => Number(String(x.premiered || '').slice(0, 4)) || null;
    const scored = cands.map((c) => {
      const exact = looseKey(c.name) === looseKey(s.searchTitle);
      const sim = wordSimilarity(c.name, s.searchTitle);
      const dy = s.yearStart && yr(c) ? Math.abs(s.yearStart - yr(c)) : 5;
      const ctry = s.country && (c.network?.country?.code || c.webChannel?.country?.code || '').replace('GB', 'UK') === s.country.toUpperCase() ? 0.2 : 0;
      return [c, (exact ? 1 : sim) + (dy === 0 ? 0.4 : dy === 1 ? 0.25 : dy > 2 && s.yearStart && yr(c) ? -0.6 : 0) + ctry + (c.weight || 0) / 1000];
    });
    const best = scored.sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 0.7 ? best[0] : null;
  }

  /** Repli : recherche TVDB (alias français compris), puis fiche TVmaze correspondante. */
  async searchShowTvdb(s) {
    let res = [];
    try { res = (await skyhookSearch(s.searchTitle)) || []; } catch { return null; }
    const yr = (x) => Number(String(x.firstAired || x.year || '').slice(0, 4)) || null;
    const hit = res.slice(0, 5).find((c) => (s.yearStart ? yr(c) && Math.abs(yr(c) - s.yearStart) <= 1 : wordSimilarity(c.title, s.searchTitle) >= 0.6));
    if (!hit) return null;
    try {
      const show = await maze.get(`/lookup/shows?thetvdb=${hit.tvdbId}`);
      const showYear = Number(String(show?.premiered || '').slice(0, 4)) || null;
      if (show && (!s.yearStart || !showYear || Math.abs(showYear - s.yearStart) <= 2)) return this.compactShow(normalizeShow(show));
    } catch {}
    return {
      tvmazeId: null,
      tvdbId: hit.tvdbId,
      title: hit.title,
      originalTitle: hit.title,
      year: yr(hit),
      poster: (hit.images || []).find((i) => /poster/i.test(i.coverType))?.url || null,
      genres: (hit.genres || []).map(genreFr),
      rating: null,
      status: hit.status || null,
      keys: titleKeys([hit.title, s.searchTitle]),
      at: Date.now(),
    };
  }

  // ---------- Index de correspondance ----------

  buildIndex() {
    const im = this.ident.data.movies;
    const is = this.ident.data.series;
    this.idx = { tmdb: new Map(), mkeys: new Map(), tvmaze: new Map(), tvdb: new Map(), skeys: new Map() };
    const add = (map, k, v) => {
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(v);
    };
    for (const m of this.d.movies) {
      const id = im[m.folder];
      const entry = { id: m.id, year: m.year ?? id?.year ?? null };
      if (id?.tmdbId) this.idx.tmdb.set(id.tmdbId, m.id);
      for (const k of new Set([looseKey(m.title), ...(id?.keys || [])])) add(this.idx.mkeys, k, entry);
    }
    for (const s of this.d.series) {
      const id = is[s.folder];
      const entry = { id: s.id, year: s.yearStart ?? id?.year ?? null };
      if (id?.tvmazeId) this.idx.tvmaze.set(id.tvmazeId, s.id);
      if (id?.tvdbId) this.idx.tvdb.set(id.tvdbId, s.id);
      for (const k of new Set([looseKey(s.searchTitle), looseKey(s.title), ...(id?.keys || [])])) add(this.idx.skeys, k, entry);
    }
    this.byId = new Map([...this.d.movies, ...this.d.series].map((x) => [x.id, x]));
  }

  /** Renvoie l'identifiant de l'entrée de bibliothèque correspondant à un élément du catalogue, ou null. */
  match(item) {
    if (!item) return null;
    if (item.type === 'movie') {
      if (item.tmdbId && this.idx.tmdb.has(item.tmdbId)) return this.idx.tmdb.get(item.tmdbId);
      for (const k of item.keys || []) {
        const hit = (this.idx.mkeys.get(k) || []).find((e) => !e.year || !item.year || Math.abs(e.year - item.year) <= 1);
        if (hit) return hit.id;
      }
      return null;
    }
    if (item.tvmazeId && this.idx.tvmaze.has(item.tvmazeId)) return this.idx.tvmaze.get(item.tvmazeId);
    if (item.tvdbId && this.idx.tvdb.has(item.tvdbId)) return this.idx.tvdb.get(item.tvdbId);
    for (const k of item.keys || []) {
      const hit = (this.idx.skeys.get(k) || []).find((e) => !e.year || !item.year || Math.abs(e.year - item.year) <= 1);
      if (hit) return hit.id;
    }
    return null;
  }

  /** Recommandations agrégées à partir des films possédés : tmdbId -> nombre de films qui le recommandent. */
  recoCounts() {
    const counts = new Map();
    for (const rec of Object.values(this.ident.data.movies)) {
      for (const id of rec?.recos || []) counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const id of this.idx.tmdb.keys()) counts.delete(id);
    return counts;
  }

  /** Genres les plus présents dans la bibliothèque (pour personnaliser les suggestions). */
  genreAffinity(type) {
    const src = type === 'movie' ? this.ident.data.movies : this.ident.data.series;
    const counts = new Map();
    let total = 0;
    for (const rec of Object.values(src)) {
      for (const g of rec?.genres || []) { counts.set(g, (counts.get(g) || 0) + 1); total++; }
    }
    const out = new Map();
    for (const [g, c] of counts) out.set(g, c / Math.max(total, 1));
    return out;
  }

  /** Vue enrichie (affiche, titre FR…) pour l'affichage. */
  view(entry) {
    const isMovie = entry.id.startsWith('m');
    const rec = (isMovie ? this.ident.data.movies : this.ident.data.series)[entry.folder];
    const ok = rec && !rec.fail;
    return {
      ...entry,
      type: isMovie ? 'movie' : 'series',
      key: ok && (isMovie ? rec.tmdbId : rec.tvmazeId) ? (isMovie ? `movie:${rec.tmdbId}` : `series:${rec.tvmazeId}`) : null,
      tmdbId: ok ? rec.tmdbId : undefined,
      tvmazeId: ok ? rec.tvmazeId : undefined,
      tvdbId: ok ? rec.tvdbId : undefined,
      displayTitle: ok ? rec.title : entry.title,
      originalTitle: ok ? rec.originalTitle : null,
      poster: ok ? rec.poster : null,
      genres: ok ? rec.genres : [],
      rating: ok ? rec.rating : null,
      identified: !!ok,
      year: entry.year ?? entry.yearStart ?? (ok ? rec.year : null),
    };
  }
}
