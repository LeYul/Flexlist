// Petits utilitaires partagés : HTTP sortant, limitation de débit, normalisation de titres.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * fetch + JSON avec délai d'expiration et nouvelles tentatives sur 429 / 5xx / erreurs réseau.
 */
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 25000, retries = 2 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          attempt++;
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          await sleep(Math.max(retryAfter * 1000, 1500 * attempt));
          continue;
        }
        const msg = extractError(data) || `HTTP ${res.status}`;
        throw new HttpError(res.status, msg, data);
      }
      return data;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt < retries) {
        attempt++;
        await sleep(1500 * attempt);
        continue;
      }
      throw new HttpError(0, err.name === 'TimeoutError' ? 'Délai dépassé' : (err.cause?.code || err.message));
    }
  }
}

function extractError(data) {
  if (!data) return null;
  if (typeof data === 'string') return data.slice(0, 200);
  if (Array.isArray(data)) return data.map((e) => e.errorMessage || e.message).filter(Boolean).join(' · ').slice(0, 300) || null;
  return data.message || data.title || data.error || null;
}

/**
 * Limiteur de débit : garantit un intervalle minimal entre deux départs de requêtes.
 */
export function createLimiter(minIntervalMs) {
  let chain = Promise.resolve();
  let last = 0;
  return (fn) => {
    const slot = chain.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    chain = slot.catch(() => {});
    return slot.then(fn);
  };
}

/** Exécute fn sur chaque élément avec un parallélisme borné. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Normalise un titre pour comparaison : minuscules, sans accents ni ponctuation. */
export function normTitle(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Clé plus permissive : sans article initial, insensible au pluriel, sans espaces. */
export function looseKey(s) {
  return normTitle(s)
    .replace(/^(the|a|an|le|la|les|l|un|une|des|el|il|lo|der|die|das) /, '')
    .split(' ')
    .filter((w) => w && w !== 'and' && w !== 'et')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join('');
}

/** Titre sans article initial (utile pour relancer une recherche). */
export function withoutArticle(s) {
  return String(s || '').replace(/^\s*(the|a|an|le|la|les|l'|un|une|des|el|il|lo|der|die|das)\s+/i, '').replace(/^l['’]/i, '').trim();
}

export function titleKeys(titles) {
  const keys = new Set();
  for (const t of titles) {
    const k = looseKey(t);
    if (k && k.length >= 2) keys.add(k);
  }
  return [...keys];
}

export function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Similarité de Jaccard sur les mots (0..1). */
export function wordSimilarity(a, b) {
  const A = new Set(normTitle(a).split(' ').filter(Boolean));
  const B = new Set(normTitle(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const now = () => Date.now();
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export function log(scope, ...args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${scope}]`, ...args);
}

const GENRES_FR = {
  Action: 'Action',
  Adventure: 'Aventure',
  Animation: 'Animation',
  Anime: 'Anime',
  Comedy: 'Comédie',
  Crime: 'Crime',
  Documentary: 'Documentaire',
  Drama: 'Drame',
  Family: 'Familial',
  Fantasy: 'Fantastique',
  History: 'Histoire',
  Horror: 'Horreur',
  Music: 'Musique',
  Mystery: 'Mystère',
  Romance: 'Romance',
  'Science Fiction': 'Science-fiction',
  'Science-Fiction': 'Science-fiction',
  Thriller: 'Thriller',
  War: 'Guerre',
  Western: 'Western',
  'TV Movie': 'Téléfilm',
  Supernatural: 'Surnaturel',
  Espionage: 'Espionnage',
  Legal: 'Judiciaire',
  Medical: 'Médical',
  Sports: 'Sport',
  Food: 'Cuisine',
  Travel: 'Voyage',
  Nature: 'Nature',
  Children: 'Jeunesse',
  Adult: 'Adulte',
  DIY: 'Bricolage',
  Military: 'Militaire',
  Business: 'Économie',
  'Martial Arts': 'Arts martiaux',
};
export const genreFr = (g) => GENRES_FR[g] || g;
