// Catalogue de films et séries populaires, mis à jour régulièrement.
//  - Films  : API publique de métadonnées de Radarr (TMDb / IMDb), titres et résumés en français.
//  - Séries : TVmaze (popularité, programmes de diffusion, titres français via les « akas »).
import { JsonFile } from './store.js';
import { fetchJson, createLimiter, titleKeys, stripHtml, genreFr, log, DAY, HOUR } from './util.js';

const RADARR_META = 'https://api.radarr.video/v1';
const TVMAZE = 'https://api.tvmaze.com';
const SKYHOOK = 'https://skyhook.sonarr.tv/v1/tvdb';

const metaLimit = createLimiter(220);
const mazeLimit = createLimiter(560);

export const meta = {
  get: (p) => metaLimit(() => fetchJson(RADARR_META + p)),
  post: (p, body) => metaLimit(() => fetchJson(RADARR_META + p, { method: 'POST', body, timeout: 60000 })),
};
export const maze = { get: (p) => mazeLimit(() => fetchJson(TVMAZE + p)) };
const skyLimit = createLimiter(300);
/** Recherche TVDB (via le service de Sonarr) : reconnaît aussi les titres français. */
export const skyhookSearch = (term) => skyLimit(() => fetchJson(`${SKYHOOK}/search/en/?term=${encodeURIComponent(term)}`));

const SERIES_TYPES = new Set(['Scripted', 'Animation', 'Documentary']);
export const KEYS_VERSION = 2;
const tmdbImg = (url, size) => (url ? url.replace('/t/p/original/', `/t/p/${size}/`) : null);
const year = (d) => (d ? Number(String(d).slice(0, 4)) || null : null);

export function normalizeMovie(m) {
  const tr = m.Translations || [];
  const fr = tr.find((t) => t.Language === 'fr-FR') || tr.find((t) => /^fr/i.test(t.Language || ''));
  const poster = (m.Images || []).find((i) => i.CoverType === 'Poster')?.Url;
  const fanart = (m.Images || []).find((i) => i.CoverType === 'Fanart')?.Url;
  const r = m.MovieRatings || m.Ratings || {};
  const cast = (m.Credits?.Cast || []).slice(0, 8).map((c) => ({
    name: c.Name,
    role: c.Character,
    photo: tmdbImg((c.Images || [])[0]?.Url, 'w185'),
  }));
  const director = (m.Credits?.Crew || []).filter((c) => c.Job === 'Director').map((c) => c.Name).slice(0, 2);
  const titles = [m.Title, m.OriginalTitle, fr?.Title, ...(m.AlternativeTitles || []).slice(0, 40).map((a) => a.Title)];
  return {
    key: `movie:${m.TmdbId}`,
    type: 'movie',
    tmdbId: m.TmdbId,
    imdbId: m.ImdbId || null,
    title: fr?.Title?.trim() || m.Title,
    originalTitle: m.OriginalTitle || m.Title,
    year: m.Year || year(m.Premier) || null,
    overview: fr?.Overview?.trim() || m.Overview || '',
    genres: (m.Genres || []).map(genreFr),
    runtime: m.Runtime || null,
    poster: tmdbImg(poster, 'w342'),
    posterHd: tmdbImg(poster, 'w780'),
    backdrop: tmdbImg(fanart, 'w1280'),
    ratings: {
      imdb: r.Imdb?.Value || null,
      imdbVotes: r.Imdb?.Count || 0,
      tmdb: r.Tmdb?.Value || null,
      rt: r.RottenTomatoes?.Value || null,
      mc: r.Metacritic?.Value || null,
    },
    popularity: m.Popularity || 0,
    trailer: m.YoutubeTrailerId || null,
    cert: (m.Certifications || []).find((c) => c.Country === 'FR')?.Certification || null,
    studio: m.Studio || null,
    originalLanguage: m.OriginalLanguage || null,
    releaseDate: m.Premier || m.InCinema || null,
    digitalRelease: m.DigitalRelease || m.PhysicalRelease || null,
    collection: m.Collection?.Name || null,
    recos: (m.Recommendations || []).map((x) => x.TmdbId).slice(0, 15),
    cast,
    director,
    keys: titleKeys(titles),
    fetchedAt: Date.now(),
  };
}

export function normalizeShow(s, frTitle = null) {
  return {
    key: `series:${s.id}`,
    type: 'series',
    tvmazeId: s.id,
    tvdbId: s.externals?.thetvdb || null,
    imdbId: s.externals?.imdb || null,
    title: frTitle || s.name,
    originalTitle: s.name,
    year: year(s.premiered),
    endYear: s.status === 'Ended' ? year(s.ended) : null,
    status: s.status || null,
    network: s.network?.name || s.webChannel?.name || null,
    country: s.network?.country?.code || s.webChannel?.country?.code || null,
    language: s.language || null,
    genres: (s.genres || []).map(genreFr),
    showType: s.type || null,
    runtime: s.averageRuntime || s.runtime || null,
    rating: s.rating?.average || null,
    weight: s.weight || 0,
    poster: s.image?.medium || null,
    posterHd: s.image?.original || null,
    overview: stripHtml(s.summary),
    keys: titleKeys([s.name, frTitle]),
    fetchedAt: Date.now(),
  };
}

export const movieScore = (m) => Math.log10((m.popularity || 0) + 1) * 2 + (m.ratings?.imdb || m.ratings?.tmdb || 6) + Math.log10((m.ratings?.imdbVotes || 0) + 1) * 0.6;
export const seriesScore = (s) => (s.weight || 0) / 10 + (s.rating || 6.5);

function lastDays(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.now() - i * DAY);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

export class Catalog {
  constructor(dataDir) {
    this.file = new JsonFile(dataDir, 'catalog.json', {
      movies: {},
      series: {},
      lists: {},
      updated: {},
      akas: {},
      extras: {},
    });
    this.progress = {};
    this.busy = {};
    if (this.d.keysVersion !== KEYS_VERSION) {
      // Règle de correspondance des titres modifiée : on reconstruit le catalogue.
      Object.assign(this.d, { movies: {}, series: {}, lists: {}, updated: {}, keysVersion: KEYS_VERSION });
      this.file.save();
    }
  }

  get d() {
    return this.file.data;
  }

  putMovie(item) {
    if (!item?.tmdbId) return item;
    this.d.movies[item.tmdbId] = item;
    return item;
  }

  putShow(item) {
    if (!item?.tvmazeId) return item;
    const prev = this.d.series[item.tvmazeId];
    if (prev && prev.title !== prev.originalTitle && item.title === item.originalTitle) {
      item.title = prev.title;
      item.keys = titleKeys([item.originalTitle, item.title]);
    }
    this.d.series[item.tvmazeId] = item;
    return item;
  }

  list(name) {
    const ids = this.d.lists[name] || [];
    const src = name.startsWith('movies_') ? this.d.movies : this.d.series;
    return ids.map((id) => src[id]).filter(Boolean);
  }

  // ---------- Films ----------

  async fetchMoviesBulk(ids) {
    const todo = [...new Set(ids)].filter(Boolean);
    for (let i = 0; i < todo.length; i += 50) {
      const chunk = todo.slice(i, i + 50);
      try {
        const arr = await meta.post('/movie/bulk', chunk);
        for (const m of arr || []) if (m?.TmdbId) this.putMovie(normalizeMovie(m));
      } catch (err) {
        log('catalog', `bulk films échoué (${chunk.length}) : ${err.message}`);
      }
      this.progress.movies = `détails ${Math.min(i + 50, todo.length)}/${todo.length}`;
    }
  }

  /**
   * @param {Map<number, number>} libraryRecos  tmdbId -> nombre de films de la bibliothèque qui le recommandent
   * @param {(item) => boolean} owned            vrai si le film est déjà dans NETFLEX
   */
  async refreshMovies(libraryRecos = new Map(), owned = () => false) {
    if (this.busy.movies) return;
    this.busy.movies = true;
    try {
      const sources = {
        trending: '/list/tmdb/trending',
        popular: '/list/tmdb/popular',
        imdbPopular: '/list/imdb/popular',
        top250: '/list/imdb/top250',
      };
      for (const [name, p] of Object.entries(sources)) {
        this.progress.movies = `liste ${name}`;
        try {
          const arr = await meta.get(p);
          const ids = [];
          for (const m of arr || []) {
            if (!m?.TmdbId) continue;
            this.putMovie(normalizeMovie(m));
            ids.push(m.TmdbId);
          }
          if (ids.length) this.d.lists[`movies_${name}`] = ids;
        } catch (err) {
          log('catalog', `liste ${name} indisponible : ${err.message}`);
        }
      }

      // Recommandations (1 niveau) des films tendance / populaires : enrichit le pool à découvrir.
      const seed = new Map();
      for (const id of [...(this.d.lists.movies_trending || []), ...(this.d.lists.movies_popular || []), ...(this.d.lists.movies_imdbPopular || [])]) {
        for (const r of this.d.movies[id]?.recos || []) seed.set(r, (seed.get(r) || 0) + 1);
      }
      const seedIds = [...seed.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 300);
      const forYouIds = [...libraryRecos.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 400);

      const fresh = (id) => this.d.movies[id] && Date.now() - (this.d.movies[id].fetchedAt || 0) < 7 * DAY;
      await this.fetchMoviesBulk([...forYouIds, ...seedIds].filter((id) => !fresh(id)));

      this.d.lists.movies_discover = seedIds.filter((id) => this.d.movies[id]);
      this.d.lists.movies_forYou = forYouIds.filter((id) => this.d.movies[id] && !owned(this.d.movies[id])).slice(0, 250);

      // Ménage : on ne garde que ce qui est référencé ou récent.
      const keep = new Set(Object.entries(this.d.lists).filter(([k]) => k.startsWith('movies_')).flatMap(([, v]) => v));
      for (const [id, m] of Object.entries(this.d.movies)) {
        if (!keep.has(Number(id)) && Date.now() - (m.fetchedAt || 0) > 30 * DAY) delete this.d.movies[id];
      }
      this.d.updated.movies = Date.now();
      this.file.save();
      log('catalog', `films à jour : ${Object.keys(this.d.movies).length} fiches`);
    } finally {
      this.busy.movies = false;
      this.progress.movies = null;
    }
  }

  async getMovie(tmdbId, { refresh = false } = {}) {
    const cached = this.d.movies[tmdbId];
    if (cached && !refresh && Date.now() - (cached.fetchedAt || 0) < 14 * DAY) return cached;
    try {
      const m = await meta.get(`/movie/${tmdbId}`);
      const item = this.putMovie(normalizeMovie(m));
      this.file.save();
      return item;
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  }

  // ---------- Séries ----------

  async refreshSeriesTrending() {
    if (this.busy.trending) return;
    this.busy.trending = true;
    try {
      const shows = new Map();
      const hits = new Map();
      const days = lastDays(7);
      let done = 0;
      for (const day of days) {
        for (const src of [`/schedule/web?date=${day}`, `/schedule?country=US&date=${day}`, `/schedule?country=GB&date=${day}`, `/schedule?country=FR&date=${day}`]) {
          try {
            const eps = await maze.get(src);
            for (const ep of eps || []) {
              const s = ep._embedded?.show || ep.show;
              if (!s || !SERIES_TYPES.has(s.type) || !s.image) continue;
              shows.set(s.id, s);
              hits.set(s.id, (hits.get(s.id) || 0) + 1);
            }
          } catch (err) {
            log('catalog', `programme ${src} : ${err.message}`);
          }
          this.progress.trending = `programmes ${++done}/${days.length * 4}`;
        }
      }
      const ranked = [...shows.values()]
        .filter((s) => (s.weight || 0) >= 75)
        .sort((a, b) => (b.weight || 0) - (a.weight || 0) || (b.rating?.average || 0) - (a.rating?.average || 0));
      for (const s of ranked) this.putShow(normalizeShow(s, this.d.akas[s.id]?.fr));
      if (ranked.length) this.d.lists.series_trending = ranked.slice(0, 80).map((s) => s.id);
      this.d.updated.seriesTrending = Date.now();
      this.file.save();
      log('catalog', `séries du moment : ${ranked.length}`);
      await this.fetchAkas(this.d.lists.series_trending || []);
    } finally {
      this.busy.trending = false;
      this.progress.trending = null;
    }
  }

  /** Parcourt tout l'index TVmaze (≈ 370 pages) et garde les séries populaires. */
  async crawlSeries() {
    if (this.busy.crawl) return;
    this.busy.crawl = true;
    try {
      const keep = {};
      let page = 0;
      for (;;) {
        let arr;
        try {
          arr = await maze.get(`/shows?page=${page}`);
        } catch (err) {
          if (err.status === 404) break;
          log('catalog', `page séries ${page} : ${err.message}`);
          if (page > 0 && err.status) { page++; continue; }
          throw err;
        }
        for (const s of arr || []) {
          if (SERIES_TYPES.has(s.type) && (s.weight || 0) >= 90 && s.image) keep[s.id] = normalizeShow(s, this.d.akas[s.id]?.fr);
        }
        this.progress.crawl = `index séries page ${page}`;
        page++;
        if (page > 1000) break;
      }
      // On conserve aussi les séries du moment et les fiches récemment consultées.
      for (const [id, s] of Object.entries(this.d.series)) {
        if (!keep[id] && Date.now() - (s.fetchedAt || 0) < 30 * DAY) keep[id] = s;
      }
      this.d.series = keep;
      this.d.lists.series_popular = Object.values(keep)
        .filter((s) => (s.weight || 0) >= 90)
        .sort((a, b) => seriesScore(b) - seriesScore(a))
        .slice(0, 1500)
        .map((s) => s.tvmazeId);
      this.d.updated.seriesCrawl = Date.now();
      this.file.save();
      log('catalog', `index séries : ${Object.keys(keep).length} séries populaires (${page} pages)`);
      await this.fetchAkas(this.d.lists.series_popular.slice(0, 600));
    } finally {
      this.busy.crawl = false;
      this.progress.crawl = null;
    }
  }

  /** Récupère les titres français des séries (TVmaze « akas »), avec cache 30 jours. */
  async fetchAkas(ids) {
    const todo = ids.filter((id) => !this.d.akas[id] || Date.now() - this.d.akas[id].at > 30 * DAY);
    let n = 0;
    for (const id of todo) {
      try {
        const akas = await maze.get(`/shows/${id}/akas`);
        const pick = (code) => (akas || []).find((a) => a.country?.code === code)?.name;
        const fr = pick('FR') || null;
        this.d.akas[id] = { fr, at: Date.now() };
        const s = this.d.series[id];
        if (s && fr && fr !== s.title) {
          s.title = fr;
          s.keys = titleKeys([s.originalTitle, fr]);
        }
      } catch (err) {
        this.d.akas[id] = { fr: null, at: Date.now() - 25 * DAY };
      }
      this.progress.akas = `titres FR ${++n}/${todo.length}`;
      if (n % 50 === 0) this.file.save();
    }
    this.progress.akas = null;
    this.file.save();
  }

  async getShow(tvmazeId) {
    const cached = this.d.series[tvmazeId];
    if (cached && Date.now() - (cached.fetchedAt || 0) < 7 * DAY) return cached;
    const s = await maze.get(`/shows/${tvmazeId}`);
    if (!this.d.akas[tvmazeId]) await this.fetchAkas([tvmazeId]);
    const item = this.putShow(normalizeShow(s, this.d.akas[tvmazeId]?.fr));
    this.file.save();
    return item;
  }

  /** Infos complémentaires pour la fiche détaillée d'une série (casting, saisons, image de fond). */
  async getShowExtras(tvmazeId) {
    const cached = this.d.extras[`s${tvmazeId}`];
    if (cached && Date.now() - cached.at < 7 * DAY) return cached;
    const s = await maze.get(`/shows/${tvmazeId}?embed[]=cast&embed[]=seasons&embed[]=images`);
    const imgs = s._embedded?.images || [];
    const bg = imgs.find((i) => i.type === 'background' && i.main) || imgs.find((i) => i.type === 'background') || imgs.find((i) => i.type === 'banner');
    const extras = {
      at: Date.now(),
      backdrop: bg?.resolutions?.original?.url || null,
      cast: (s._embedded?.cast || []).slice(0, 8).map((c) => ({
        name: c.person?.name,
        role: c.character?.name,
        photo: c.person?.image?.medium || null,
      })),
      seasons: (s._embedded?.seasons || []).filter((x) => x.number > 0).map((x) => ({ number: x.number, episodes: x.episodeOrder || null, year: year(x.premiereDate) })),
    };
    this.d.extras[`s${tvmazeId}`] = extras;
    this.file.save();
    return extras;
  }

  async lookupShowByTvdb(tvdbId) {
    const s = await maze.get(`/lookup/shows?thetvdb=${tvdbId}`);
    return s ? this.putShow(normalizeShow(s, this.d.akas[s.id]?.fr)) : null;
  }

  /** Trouve l'identifiant TVDB d'une série (nécessaire pour Sonarr) si TVmaze ne le fournit pas. */
  async resolveTvdbId(show) {
    if (show.tvdbId) return show.tvdbId;
    try {
      const res = await skyhookSearch(show.originalTitle);
      const hit = (res || []).find((r) => !show.year || Math.abs((Number(String(r.firstAired || r.year || '').slice(0, 4)) || show.year) - show.year) <= 1) || (res || [])[0];
      return hit?.tvdbId || null;
    } catch {
      return null;
    }
  }

  // ---------- Recherche ----------

  async search(q) {
    const yearMatch = q.match(/\b(19|20)\d{2}\b/);
    const yr = yearMatch ? yearMatch[0] : null;
    const clean = yr ? q.replace(yr, '').trim() : q;
    const [mv, tv] = await Promise.allSettled([
      meta.get(`/search?q=${encodeURIComponent(clean || q)}${yr ? `&year=${yr}` : ''}`),
      maze.get(`/search/shows?q=${encodeURIComponent(clean || q)}`),
    ]);
    const movies = mv.status === 'fulfilled' ? (mv.value || []).slice(0, 24).map((m) => this.putMovie(normalizeMovie(m))) : [];
    const series = tv.status === 'fulfilled'
      ? (tv.value || []).map((r) => r.show).filter((s) => s && s.type !== 'News').slice(0, 24).map((s) => this.putShow(normalizeShow(s, this.d.akas[s.id]?.fr)))
      : [];
    this.file.save();
    return { movies, series, errors: [mv, tv].filter((r) => r.status === 'rejected').map((r) => r.reason?.message) };
  }
}
