// Favoris : envoi vers Radarr / Sonarr, suivi de l'état et relance périodique des recherches.
import { JsonFile } from './store.js';
import { ArrClient } from './arr.js';
import { log, HOUR } from './util.js';

export const STATUS_LABELS = {
  pending: 'En attente d’envoi',
  searching: 'Recherche en cours',
  notfound: 'Introuvable pour l’instant',
  upcoming: 'Pas encore sorti',
  downloading: 'Téléchargement',
  downloaded: 'Téléchargé — import en cours',
  partial: 'En partie disponible',
  available: 'Disponible dans NETFLEX',
  error: 'Erreur',
};

const ACTIVE = new Set(['pending', 'searching', 'notfound', 'upcoming', 'downloading', 'downloaded', 'partial', 'error']);

/** Fiche minimale conservée avec le favori (indépendante du cache catalogue). */
export function snapshot(item) {
  const keep = ['key', 'type', 'tmdbId', 'tvmazeId', 'tvdbId', 'imdbId', 'title', 'originalTitle', 'year', 'endYear', 'poster', 'posterHd', 'backdrop', 'genres', 'runtime', 'originalLanguage', 'language', 'showType', 'status', 'network', 'keys', 'ratings', 'rating'];
  const out = {};
  for (const k of keep) if (item[k] !== undefined) out[k] = item[k];
  return out;
}

export class Favorites {
  constructor(dataDir, { settings, library, catalog }) {
    this.file = new JsonFile(dataDir, 'favorites.json', { items: [], dismissed: {}, history: [] });
    this.settings = settings;
    this.library = library;
    this.catalog = catalog;
    this.busy = false;
  }

  get list() {
    return this.file.data.items;
  }

  get(key) {
    return this.list.find((f) => f.key === key) || null;
  }

  client(type) {
    const s = this.settings.data;
    const conf = type === 'movie' ? s.radarr : s.sonarr;
    const c = new ArrClient(type === 'movie' ? 'radarr' : 'sonarr', conf || {});
    return c.ok && conf.enabled !== false ? c : null;
  }

  event(fav, text) {
    fav.events = [...(fav.events || []), { at: Date.now(), text }].slice(-20);
  }

  async add(item, prefs, by) {
    let fav = this.get(item.key);
    if (!fav) {
      fav = { key: item.key, type: item.type, item: snapshot(item), addedAt: Date.now(), addedBy: by || null, status: 'pending', arr: null, events: [] };
      this.list.unshift(fav);
      this.event(fav, 'Ajouté aux favoris');
    }
    fav.prefs = { lang: 'multi', quality: 'balanced', seasons: 'all', searchNow: true, note: '', ...prefs };
    fav.item = { ...fav.item, ...snapshot(item) };
    delete this.file.data.dismissed[item.key];
    this.file.save();
    await this.process(fav, { forceSend: true });
    this.file.save();
    return fav;
  }

  async updatePrefs(key, prefs) {
    const fav = this.get(key);
    if (!fav) return null;
    fav.prefs = { ...fav.prefs, ...prefs };
    this.event(fav, 'Préférences modifiées');
    await this.process(fav, { forceSend: true });
    this.file.save();
    return fav;
  }

  async remove(key, { unmonitor = true } = {}) {
    const fav = this.get(key);
    if (!fav) return false;
    if (unmonitor && fav.arr?.id && fav.arr.created && fav.status !== 'available') {
      try {
        await this.client(fav.type)?.unmonitor(fav.arr.id);
      } catch (err) {
        log('favorites', `désactivation du suivi impossible pour ${fav.item.title} : ${err.message}`);
      }
    }
    this.file.data.items = this.list.filter((f) => f.key !== key);
    this.file.data.history = [{ key, title: fav.item.title, removedAt: Date.now() }, ...this.file.data.history].slice(0, 200);
    this.file.save();
    return true;
  }

  async searchNow(key) {
    const fav = this.get(key);
    if (!fav) return null;
    if (!fav.arr?.id) {
      await this.process(fav, { forceSend: true });
    } else {
      const c = this.client(fav.type);
      if (!c) throw new Error('Connexion Radarr/Sonarr non configurée');
      await c.search(fav.arr.id);
      fav.arr.lastSearchAt = Date.now();
      fav.arr.searchCount = (fav.arr.searchCount || 0) + 1;
      this.event(fav, 'Recherche manuelle lancée');
    }
    this.file.save();
    return fav;
  }

  dismiss(key) {
    this.file.data.dismissed[key] = Date.now();
    this.file.save();
  }

  undismiss(key) {
    delete this.file.data.dismissed[key];
    this.file.save();
  }

  isDismissed(key) {
    return !!this.file.data.dismissed[key];
  }

  /** Envoi initial ou mise à jour d'un favori, puis contrôle de présence dans la bibliothèque. */
  async process(fav, { forceSend = false, queue = null } = {}) {
    // 1) Déjà dans NETFLEX ?
    const libId = this.library.match(fav.item);
    if (libId) fav.libraryId = libId;
    // Un film présent est terminé. Une série présente l'est aussi, sauf si on a demandé
    // à la compléter (dans ce cas c'est Sonarr qui dit s'il manque des épisodes).
    if (libId && (fav.type === 'movie' || (!fav.arr?.id && !forceSend))) {
      this.markAvailable(fav);
      return;
    }

    const client = this.client(fav.type);
    if (!client) {
      if (fav.status !== 'available') {
        fav.status = 'pending';
        fav.message = `Connexion ${fav.type === 'movie' ? 'Radarr' : 'Sonarr'} à configurer dans les réglages.`;
      }
      return;
    }

    // 2) Envoi (première fois, ou préférences modifiées).
    if (!fav.arr?.id || forceSend) {
      if (fav.status === 'available' && !forceSend) return;
      try {
        const conf = fav.type === 'movie' ? this.settings.data.radarr : this.settings.data.sonarr;
        let res;
        if (fav.type === 'movie') {
          res = await client.addMovie(fav, conf);
        } else {
          const tvdbId = fav.item.tvdbId || (await this.catalog.resolveTvdbId(fav.item));
          if (!tvdbId) throw new Error('Identifiant TVDB introuvable pour cette série');
          fav.item.tvdbId = tvdbId;
          // Série déjà (en partie) sur le NAS : Sonarr doit utiliser son dossier existant.
          const libFolder = libId ? this.library.byId.get(libId)?.folder : null;
          res = await client.addSeries(fav, conf, tvdbId, libFolder);
        }
        fav.arr = {
          id: res.arrId,
          created: res.created || fav.arr?.created || false,
          profile: res.profile,
          sentAt: Date.now(),
          lastSearchAt: res.searched ? Date.now() : fav.arr?.lastSearchAt || 0,
          searchCount: (fav.arr?.searchCount || 0) + (res.searched ? 1 : 0),
        };
        fav.warning = res.warning || null;
        fav.message = null;
        if (fav.status !== 'available') fav.status = 'searching';
        this.event(fav, `Requête envoyée à ${client.kind === 'radarr' ? 'Radarr' : 'Sonarr'} (profil « ${res.profile} »)`);
      } catch (err) {
        fav.status = fav.status === 'available' ? 'available' : 'error';
        fav.message = `Envoi impossible : ${err.message}`;
        this.event(fav, fav.message);
        return;
      }
    }

    // 3) État côté Radarr / Sonarr.
    await this.refreshArrState(fav, client, queue);
  }

  markAvailable(fav) {
    if (fav.status === 'available') return;
    fav.status = 'available';
    fav.availableAt = Date.now();
    fav.progress = null;
    fav.message = null;
    this.event(fav, 'Trouvé dans NETFLEX ✓');
  }

  async refreshArrState(fav, client, queue) {
    let it;
    try {
      it = await client.item(fav.arr.id);
    } catch (err) {
      if (err.status === 404) {
        // Supprimé de Radarr/Sonarr entre-temps : on renverra la requête.
        fav.arr = null;
        if (fav.status !== 'available') fav.status = 'pending';
        return;
      }
      throw err;
    }
    const q = (queue || []).filter((r) => (client.kind === 'radarr' ? r.movieId : r.seriesId) === fav.arr.id);
    if (fav.type === 'movie') {
      if (fav.status === 'available') return;
      if (q.length) {
        const size = q.reduce((a, r) => a + (r.size || 0), 0);
        const left = q.reduce((a, r) => a + (r.sizeleft || 0), 0);
        fav.status = 'downloading';
        fav.progress = size ? Math.round(((size - left) / size) * 100) : 0;
        fav.eta = q[0].timeleft || null;
        fav.message = q[0].trackedDownloadState === 'importPending' ? 'Import en attente' : null;
        return;
      }
      fav.progress = null;
      if (it.hasFile) {
        fav.message = null;
        if (fav.status !== 'downloaded') this.event(fav, 'Téléchargé par Radarr');
        fav.status = 'downloaded';
        return;
      }
      if (it.isAvailable === false) {
        fav.status = 'upcoming';
        fav.message = it.digitalRelease || it.physicalRelease ? `Sortie prévue le ${new Date(it.digitalRelease || it.physicalRelease).toLocaleDateString('fr-FR')}` : 'Sera recherché dès sa sortie.';
        return;
      }
      fav.message = null;
      fav.status = (fav.arr.searchCount || 0) >= 2 ? 'notfound' : 'searching';
      if (fav.status === 'notfound' && !fav.notFoundSince) fav.notFoundSince = Date.now();
      return;
    }

    // Séries : l'état vient de Sonarr (épisodes surveillés / présents).
    const st = it.statistics || {};
    fav.episodes = { have: st.episodeFileCount || 0, total: st.episodeCount || 0 };
    if (q.length) {
      const size = q.reduce((a, r) => a + (r.size || 0), 0);
      const left = q.reduce((a, r) => a + (r.sizeleft || 0), 0);
      fav.status = 'downloading';
      fav.progress = size ? Math.round(((size - left) / size) * 100) : 0;
      fav.message = `${q.length} épisode(s) en téléchargement`;
      return;
    }
    fav.progress = null;
    fav.message = null;
    if (st.episodeCount && st.episodeFileCount >= st.episodeCount) {
      if (fav.libraryId) this.markAvailable(fav);
      else fav.status = 'downloaded';
    } else if (st.episodeFileCount > 0) {
      fav.status = 'partial';
      fav.message = `${st.episodeFileCount}/${st.episodeCount} épisodes`;
    } else {
      fav.status = (fav.arr.searchCount || 0) >= 2 ? 'notfound' : 'searching';
      if (fav.status === 'notfound' && !fav.notFoundSince) fav.notFoundSince = Date.now();
    }
  }

  /**
   * Boucle de synchronisation : présence dans NETFLEX, état des téléchargements,
   * et relance régulière des recherches pour les titres introuvables.
   */
  async syncAll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const queues = {};
      for (const type of ['movie', 'series']) {
        const c = this.client(type);
        if (c) {
          try { queues[type] = await c.queue(); } catch (err) { queues[type] = []; log('favorites', `file d'attente ${c.kind} : ${err.message}`); }
        }
      }
      const intervalMs = Math.max(1, Number(this.settings.data.searchIntervalHours) || 6) * HOUR;
      let searches = 0;
      for (const fav of this.list) {
        if (!ACTIVE.has(fav.status) && fav.status !== 'available') continue;
        try {
          await this.process(fav, { queue: queues[fav.type] });
          // Relance périodique (max 5 par cycle pour ménager les indexeurs).
          const c = this.client(fav.type);
          if (c && fav.arr?.id && ['searching', 'notfound', 'partial'].includes(fav.status) && searches < 5) {
            if (Date.now() - (fav.arr.lastSearchAt || 0) >= intervalMs) {
              await c.search(fav.arr.id);
              fav.arr.lastSearchAt = Date.now();
              fav.arr.searchCount = (fav.arr.searchCount || 0) + 1;
              searches++;
              this.event(fav, `Nouvelle recherche automatique (n° ${fav.arr.searchCount})`);
            }
          }
        } catch (err) {
          fav.message = err.message;
          log('favorites', `${fav.item.title} : ${err.message}`);
        }
      }
      this.file.data.syncedAt = Date.now();
      this.file.save();
    } finally {
      this.busy = false;
    }
  }

  view(fav) {
    const interval = (Number(this.settings.data.searchIntervalHours) || 6) * HOUR;
    return {
      ...fav,
      statusLabel: STATUS_LABELS[fav.status] || fav.status,
      nextSearchAt: fav.arr?.id && ['searching', 'notfound', 'partial'].includes(fav.status) ? (fav.arr.lastSearchAt || 0) + interval : null,
    };
  }
}
