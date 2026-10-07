// Intégration Radarr (films) et Sonarr (séries) via leur API v3.
// Rien n'est jamais supprimé : on ajoute des éléments, des formats personnalisés et des profils « Flexlist ».
import { fetchJson, log } from './util.js';

export const LANGS = {
  vf: { label: 'VF', scores: { VF: 100, MULTI: 80, VOSTFR: -1000 }, min: 80 },
  multi: { label: 'MULTi (VF + VO)', scores: { VF: 0, MULTI: 100, VOSTFR: -1000 }, min: 100 },
  vostfr: { label: 'VOSTFR', scores: { VF: -1000, MULTI: 50, VOSTFR: 100 }, min: 50 },
  vo: { label: 'VO', scores: { VF: -1000, MULTI: 50, VOSTFR: 30 }, min: 0 },
  any: { label: 'Toutes langues', scores: { VF: 20, MULTI: 50, VOSTFR: 10 }, min: 0 },
};

export const QUALITIES = {
  '720p': { label: '720p', res: [720] },
  '1080p': { label: '1080p', res: [1080] },
  '2160p': { label: '4K', res: [2160] },
  balanced: { label: '720p à 1080p', res: [720, 1080] },
  any: { label: 'Toutes qualités', res: [480, 540, 576, 720, 1080, 2160] },
};

const CUSTOM_FORMATS = {
  VF: {
    name: 'Flexlist · VF',
    specs: [
      { name: 'Titre VF', negate: false, required: true, value: '\\b(TRUEFRENCH|FRENCH|VFF|VFQ|VFI|VF2|VF)\\b' },
      { name: 'Pas MULTi', negate: true, required: true, value: '\\bMULTI\\b' },
    ],
  },
  MULTI: { name: 'Flexlist · MULTi', specs: [{ name: 'Titre MULTi', negate: false, required: true, value: '\\bMULTI\\b' }] },
  VOSTFR: { name: 'Flexlist · VOSTFR', specs: [{ name: 'Titre VOSTFR', negate: false, required: true, value: '\\b(VOSTFR|SUBFRENCH|VOST)\\b' }] },
};

const EXCLUDED_QUALITY = /remux|br-?disk|raw-?hd|cam|telesync|telecine|workprint|dvdscr|regional|unknown|dvd-r/i;

export class ArrClient {
  constructor(kind, { url, apiKey }) {
    this.kind = kind; // 'radarr' | 'sonarr'
    this.base = String(url || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  get ok() {
    return !!(this.base && this.apiKey);
  }

  req(method, p, body) {
    return fetchJson(`${this.base}/api/v3${p}`, {
      method,
      body,
      headers: { 'X-Api-Key': this.apiKey },
      retries: method === 'GET' ? 1 : 0,
      timeout: 45000,
    });
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b); }
  put(p, b) { return this.req('PUT', p, b); }

  async test() {
    const status = await this.get('/system/status');
    const [roots, profiles] = await Promise.all([this.get('/rootfolder'), this.get('/qualityprofile')]);
    return {
      app: status.appName || this.kind,
      version: status.version,
      rootFolders: roots.map((r) => ({ path: r.path, accessible: r.accessible !== false, freeSpace: r.freeSpace })),
      profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
    };
  }

  async pickRootFolder(preferred) {
    const roots = await this.get('/rootfolder');
    if (preferred && roots.some((r) => r.path === preferred)) return preferred;
    const re = this.kind === 'radarr' ? /NETFLEX[\\/]+Films[\\/]?$/i : /NETFLEX[\\/]+S[ée]ries[\\/]?$/i;
    const pick = roots.find((r) => r.accessible !== false && re.test(r.path.normalize('NFC')))
      || roots.find((r) => r.accessible !== false)
      || roots[0];
    if (!pick) throw new Error(`Aucun dossier racine configuré dans ${this.kind === 'radarr' ? 'Radarr' : 'Sonarr'}`);
    return pick.path;
  }

  async ensureTag() {
    if (this.tagId) return this.tagId;
    const tags = await this.get('/tag');
    let tag = tags.find((t) => t.label === 'flexlist');
    if (!tag) tag = await this.post('/tag', { label: 'flexlist' });
    this.tagId = tag.id;
    return tag.id;
  }

  async ensureCustomFormats() {
    const existing = await this.get('/customformat');
    const schema = await this.get('/customformat/schema');
    const tpl = schema.find((s) => s.implementation === 'ReleaseTitleSpecification');
    if (!tpl) throw new Error('Formats personnalisés non pris en charge par cette version');
    const ids = {};
    for (const [key, cf] of Object.entries(CUSTOM_FORMATS)) {
      let found = existing.find((e) => e.name === cf.name);
      if (!found) {
        found = await this.post('/customformat', {
          name: cf.name,
          includeCustomFormatWhenRenaming: false,
          specifications: cf.specs.map((s) => ({
            ...tpl,
            name: s.name,
            negate: s.negate,
            required: s.required,
            fields: tpl.fields.map((f) => (f.name === 'value' ? { ...f, value: s.value } : f)),
          })),
        });
        log('arr', `${this.kind} : format personnalisé créé « ${cf.name} »`);
      }
      ids[key] = found.id;
    }
    return ids;
  }

  /** Garantit l'existence d'un profil de qualité correspondant aux préférences et renvoie son id. */
  async ensureProfile(lang, quality) {
    const L = LANGS[lang] || LANGS.multi;
    const Q = QUALITIES[quality] || QUALITIES.balanced;
    const name = `Flexlist · ${L.label.replace(/ \(.*\)/, '')} · ${Q.label}`;
    const profiles = await this.get('/qualityprofile');
    const found = profiles.find((p) => p.name === name);
    if (found) return { id: found.id, name };

    const cfIds = await this.ensureCustomFormats();
    const tpl = await this.get('/qualityprofile/schema');
    const qualifies = (q) => q && !EXCLUDED_QUALITY.test(q.name) && Q.res.includes(Number(q.resolution));
    let cutoff = null;
    const items = (tpl.items || []).map((it) => {
      if (it.quality) {
        const allowed = qualifies(it.quality);
        if (allowed) cutoff = it.quality.id;
        return { ...it, allowed };
      }
      const children = (it.items || []).map((c) => ({ ...c, allowed: qualifies(c.quality) }));
      const allowed = children.some((c) => c.allowed);
      if (allowed) cutoff = it.id;
      return { ...it, items: children, allowed };
    });
    if (cutoff == null) throw new Error(`Aucune qualité ${Q.label} disponible dans ${this.kind}`);

    const scoreOf = (cfId) => {
      for (const [key, id] of Object.entries(cfIds)) if (id === cfId) return L.scores[key] ?? 0;
      return 0;
    };
    const formatItems = (tpl.formatItems || []).map((f) => ({ ...f, score: scoreOf(f.format) }));
    for (const id of Object.values(cfIds)) {
      if (!formatItems.some((f) => f.format === id)) formatItems.push({ format: id, name: '', score: scoreOf(id) });
    }
    const maxScore = Math.max(...Object.values(L.scores));
    const body = {
      ...tpl,
      name,
      upgradeAllowed: true,
      cutoff,
      items,
      minFormatScore: L.min,
      cutoffFormatScore: maxScore,
      minUpgradeFormatScore: 1,
      formatItems,
    };
    if ('language' in tpl) body.language = { id: -1, name: 'Any' };
    delete body.id;
    const created = await this.post('/qualityprofile', body);
    log('arr', `${this.kind} : profil créé « ${name} »`);
    return { id: created.id, name };
  }

  /** Profil de repli si la création échoue : on prend un profil existant proche. */
  async fallbackProfile(quality) {
    const profiles = await this.get('/qualityprofile');
    const want = { '720p': /720/, '1080p': /1080/, '2160p': /2160|4k|uhd/i, balanced: /720p\/1080p|1080|hd/i, any: /any|tout/i }[quality] || /1080/;
    return profiles.find((p) => want.test(p.name)) || profiles.find((p) => /any/i.test(p.name)) || profiles[0];
  }

  async resolveProfile(prefs) {
    try {
      return { ...(await this.ensureProfile(prefs.lang, prefs.quality)), warning: null };
    } catch (err) {
      const fb = await this.fallbackProfile(prefs.quality);
      if (!fb) throw err;
      return { id: fb.id, name: fb.name, warning: `Préférences de langue non appliquées (${err.message}) — profil « ${fb.name} » utilisé.` };
    }
  }

  // ---------- Films (Radarr) ----------

  async addMovie(fav, settings) {
    const prefs = { ...fav.prefs };
    if (fav.item.originalLanguage === 'fr' && (prefs.lang === 'vo' || prefs.lang === 'vostfr')) prefs.lang = 'vf';
    const profile = await this.resolveProfile(prefs);
    const tagId = await this.ensureTag().catch(() => null);
    const existing = await this.get(`/movie?tmdbId=${fav.item.tmdbId}`);
    let movie = Array.isArray(existing) ? existing.find((m) => m.tmdbId === fav.item.tmdbId) : null;
    let created = false;
    if (movie) {
      movie = await this.put(`/movie/${movie.id}`, {
        ...movie,
        monitored: true,
        qualityProfileId: profile.id,
        tags: [...new Set([...(movie.tags || []), ...(tagId ? [tagId] : [])])],
      });
      if (prefs.searchNow !== false && !movie.hasFile) await this.post('/command', { name: 'MoviesSearch', movieIds: [movie.id] });
    } else {
      const lookup = await this.get(`/movie/lookup/tmdb?tmdbId=${fav.item.tmdbId}`);
      const rootFolderPath = await this.pickRootFolder(settings.rootFolder);
      movie = await this.post('/movie', {
        ...lookup,
        qualityProfileId: profile.id,
        rootFolderPath,
        monitored: true,
        minimumAvailability: 'released',
        tags: tagId ? [tagId] : [],
        addOptions: { searchForMovie: prefs.searchNow !== false, monitor: 'movieOnly' },
      });
      created = true;
    }
    return { arrId: movie.id, created, profile: profile.name, warning: profile.warning, searched: prefs.searchNow !== false };
  }

  // ---------- Séries (Sonarr) ----------

  async addSeries(fav, settings, tvdbId, libraryFolder = null) {
    const prefs = fav.prefs;
    const profile = await this.resolveProfile(prefs);
    const tagId = await this.ensureTag().catch(() => null);
    const existing = await this.get(`/series?tvdbId=${tvdbId}`);
    let series = Array.isArray(existing) ? existing.find((s) => s.tvdbId === tvdbId) : null;
    let created = false;
    const monitor = { all: 'all', latest: 'lastSeason', first: 'firstSeason', future: 'future', missing: 'missing' }[prefs.seasons] || 'all';
    if (series) {
      series = await this.put(`/series/${series.id}`, {
        ...series,
        monitored: true,
        qualityProfileId: profile.id,
        tags: [...new Set([...(series.tags || []), ...(tagId ? [tagId] : [])])],
      });
      if (prefs.searchNow !== false) await this.post('/command', { name: 'SeriesSearch', seriesId: series.id });
    } else {
      const lookup = (await this.get(`/series/lookup?term=tvdb:${tvdbId}`))?.[0];
      if (!lookup) throw new Error(`Série introuvable dans Sonarr (TVDB ${tvdbId})`);
      const rootFolderPath = await this.pickRootFolder(settings.rootFolder);
      const anime = /anime/i.test((fav.item.genres || []).join(' ')) || (fav.item.showType === 'Animation' && fav.item.language === 'Japanese');
      series = await this.post('/series', {
        ...lookup,
        qualityProfileId: profile.id,
        rootFolderPath,
        // Série déjà présente dans NETFLEX : on réutilise son dossier pour ne compléter que les manques.
        ...(libraryFolder ? { path: `${rootFolderPath.replace(/[\\/]+$/, '')}/${libraryFolder}` } : {}),
        monitored: true,
        seasonFolder: true,
        seriesType: anime ? 'anime' : 'standard',
        monitorNewItems: prefs.seasons === 'first' ? 'none' : 'all',
        tags: tagId ? [tagId] : [],
        addOptions: { monitor, searchForMissingEpisodes: prefs.searchNow !== false, searchForCutoffUnmetEpisodes: false },
      });
      created = true;
    }
    return { arrId: series.id, created, profile: profile.name, warning: profile.warning, searched: prefs.searchNow !== false };
  }

  // ---------- Suivi ----------

  async queue() {
    const q = await this.get('/queue?page=1&pageSize=500&includeUnknownMovieItems=false&includeUnknownSeriesItems=false');
    return q.records || q || [];
  }

  async search(arrId) {
    if (this.kind === 'radarr') return this.post('/command', { name: 'MoviesSearch', movieIds: [arrId] });
    return this.post('/command', { name: 'SeriesSearch', seriesId: arrId });
  }

  async item(arrId) {
    return this.get(this.kind === 'radarr' ? `/movie/${arrId}` : `/series/${arrId}`);
  }

  async unmonitor(arrId) {
    const p = this.kind === 'radarr' ? `/movie/${arrId}` : `/series/${arrId}`;
    const cur = await this.get(p);
    return this.put(p, { ...cur, monitored: false });
  }

  async allItems() {
    return this.get(this.kind === 'radarr' ? '/movie' : '/series');
  }
}
