// Composants d'interface partagés.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = {
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  cards: '<rect x="3" y="5" width="12" height="16" rx="2"/><path d="M7 3h10a2 2 0 0 1 2 2v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  star: '<path d="M12 3.5 14.6 9l6 .7-4.5 4.1 1.2 5.9L12 16.8 6.7 19.7l1.2-5.9L3.4 9.7l6-.7z"/>',
  library: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  play: '<path d="m6 4 14 8-14 8z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="m17 2-5 5-5-5"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.5"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  eyeoff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a13 13 0 0 1-1.7 2.7M6.6 6.6A13 13 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const STATUS_ICON = {
  pending: 'clock',
  searching: 'search',
  notfound: 'alert',
  upcoming: 'clock',
  downloading: 'download',
  downloaded: 'download',
  partial: 'tv',
  available: 'check',
  error: 'alert',
};

export const LANG_LABEL = { vf: 'VF', multi: 'MULTi', vostfr: 'VOSTFR', vo: 'VO', any: 'Toutes langues' };
export const QUALITY_LABEL = { '720p': '720p', '1080p': '1080p', '2160p': '4K', balanced: '720p–1080p', any: 'Toutes qualités' };
export const SEASONS_LABEL = { all: 'Toutes les saisons', latest: 'Dernière saison', first: 'Première saison', future: 'Épisodes à venir', missing: 'Épisodes manquants' };

export function hue(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function posterHtml(src, title, { eager = false } = {}) {
  if (!src) return `<div class="poster ph" style="--h:${hue(title)}"><span>${esc(title)}</span></div>`;
  return `<div class="poster" style="--h:${hue(title)}" data-title="${esc(title)}"><img src="${esc(src)}" alt="" ${eager ? '' : 'loading="lazy"'} decoding="async"></div>`;
}

// Affiche introuvable : on la remplace par une vignette titrée.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const box = img.closest('.poster');
  if (!box) return;
  box.classList.add('ph');
  box.innerHTML = `<span>${esc(box.dataset.title || '')}</span>`;
}, true);

export function yearSpan(it) {
  if (it.type === 'series' && it.year) return it.endYear && it.endYear !== it.year ? `${it.year}–${it.endYear}` : `${it.year}`;
  return it.year || '';
}

/** Carte affiche cliquable (catalogue). */
export function cardHtml(it, { quickAdd = true } = {}) {
  const sub = it.sub ?? [yearSpan(it), (it.genres || [])[0]].filter(Boolean).join(' · ');
  const badge = it.inLibrary
    ? `<span class="badge ok">${icon('check')}NETFLEX</span>`
    : it.fav
      ? `<span class="badge fav">${icon('star', 'fill')}Favori</span>`
      : '';
  const typeBadge = it.type === 'series' ? `<span class="badge type">${icon('tv')}</span>` : '';
  const rating = it.rating ? `<span class="rating">★ ${Number(it.rating).toFixed(1)}</span>` : '';
  const add = quickAdd && !it.inLibrary
    ? `<button class="quick-add ${it.fav ? 'on' : ''}" data-action="quick-fav" data-key="${esc(it.key)}" aria-label="${it.fav ? 'Déjà en favori' : 'Ajouter aux favoris'}" title="${it.fav ? 'Déjà en favori' : 'Ajouter aux favoris'}">${icon(it.fav ? 'star' : 'plus', it.fav ? 'fill' : '')}</button>`
    : '';
  return `<a class="card" href="#/fiche/${encodeURIComponent(it.key)}" data-key="${esc(it.key)}">
    <div style="position:relative">${posterHtml(it.poster, it.title)}${badge}${typeBadge}${rating}${add}</div>
    <div class="meta"><div class="t">${esc(it.title)}</div><div class="s">${esc(sub)}</div></div>
  </a>`;
}

export function rowHtml(row) {
  return `<section class="row" data-row="${esc(row.id)}">
    <div class="row-head"><h2 class="section">${esc(row.title)}</h2>${row.subtitle ? `<span class="sub">${esc(row.subtitle)}</span>` : ''}</div>
    <div class="scroller">
      <button class="scroll-btn left" data-action="scroll" data-dir="-1" aria-label="Défiler à gauche">${icon('left')}</button>
      <div class="strip">${row.items.map((it) => cardHtml(it)).join('')}</div>
      <button class="scroll-btn right" data-action="scroll" data-dir="1" aria-label="Défiler à droite">${icon('right')}</button>
    </div>
  </section>`;
}

export function skeletonRows(n = 3) {
  const cards = Array.from({ length: 10 }, () => '<div><div class="skel" style="aspect-ratio:2/3"></div><div class="skel" style="height:12px;margin-top:10px;width:80%"></div></div>').join('');
  return Array.from({ length: n }, () => `<section><div class="row-head"><div class="skel" style="height:20px;width:220px"></div></div><div class="strip">${cards}</div></section>`).join('');
}

export function statusPill(fav) {
  const label = fav.status === 'downloading' && fav.progress != null ? `Téléchargement ${fav.progress} %` : fav.statusLabel || fav.status;
  return `<span class="pill ${esc(fav.status)}">${icon(STATUS_ICON[fav.status] || 'info')}${esc(label)}</span>`;
}

export function prefsTags(prefs, type) {
  if (!prefs) return '';
  const tags = [
    `<span class="tag">${icon('sliders')}${esc(LANG_LABEL[prefs.lang] || prefs.lang)}</span>`,
    `<span class="tag">${esc(QUALITY_LABEL[prefs.quality] || prefs.quality)}</span>`,
  ];
  if (type === 'series' && prefs.seasons) tags.push(`<span class="tag">${esc(SEASONS_LABEL[prefs.seasons] || prefs.seasons)}</span>`);
  if (prefs.note) tags.push(`<span class="tag" title="${esc(prefs.note)}">📝 ${esc(prefs.note.slice(0, 30))}</span>`);
  return tags.join('');
}

// ---------------------------------------------------------------- Dates

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ago(ts) {
  if (!ts) return 'jamais';
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function bytes(n) {
  if (!n) return '—';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i < 2 ? 0 : 1).replace('.', ',')} ${u[i]}`;
}

export function runtime(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

// ---------------------------------------------------------------- Toasts

export function toast(text, { type = 'ok', action, onAction, timeout = 3800 } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'check')}<span>${esc(text)}</span>${action ? `<button class="act">${esc(action)}</button>` : ''}`;
  box.appendChild(el);
  const close = () => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 200); };
  if (action) el.querySelector('.act').onclick = () => { onAction?.(); close(); };
  setTimeout(close, timeout);
}

// ---------------------------------------------------------------- Feuille modale générique

export function openSheet(html, { onMount } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
    $('#sheets').appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const done = (val) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      if (!$('#sheets').children.length && !$('#overlay').classList.contains('open')) document.body.style.overflow = '';
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.scrim').onclick = () => done(null);
    onMount?.(wrap.querySelector('.sheet'), done);
  });
}

function segHtml(name, options, value) {
  return `<div class="seg ${Object.keys(options).length > 3 ? 'wrap' : ''}" data-seg="${name}">${Object.entries(options)
    .map(([k, v]) => {
      const [label, hint] = Array.isArray(v) ? v : [v];
      return `<button type="button" data-v="${esc(k)}" class="${k === value ? 'active' : ''}">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</button>`;
    })
    .join('')}</div>`;
}

/**
 * Demande les préférences de téléchargement pour un favori.
 * Résout { prefs, rememberDefaults } ou null si annulé.
 */
export function askPrefs(item, defaults = {}, { editing = false } = {}) {
  const isSeries = item.type === 'series';
  const p = { lang: 'multi', quality: 'balanced', seasons: 'all', searchNow: true, note: '', ...defaults };
  const langOpts = {
    vf: ['VF', 'Version française'],
    multi: ['MULTi', 'VF + VO'],
    vostfr: ['VOSTFR', 'VO sous-titrée'],
    vo: ['VO', 'Version originale'],
    any: ['Peu importe', 'Toutes langues'],
  };
  const qOpts = {
    balanced: ['Équilibré', '720p à 1080p'],
    '1080p': ['1080p', 'Full HD'],
    '2160p': ['4K', 'Ultra HD'],
    '720p': ['720p', 'Léger'],
    any: ['Peu importe', 'Toutes'],
  };
  const sOpts = { all: 'Toutes', latest: 'Dernière', first: 'Première', future: 'À venir', missing: 'Manquants' };
  const frenchOriginal = item.originalLanguage === 'fr';
  const html = `
    <div class="sheet-head">
      ${item.poster ? `<img src="${esc(item.poster)}" alt="">` : '<div class="ph"></div>'}
      <div><h3>${esc(item.title)}</h3><p>${editing ? 'Modifier les préférences de téléchargement' : 'Préférences de téléchargement'}${item.year ? ` · ${esc(item.year)}` : ''}</p></div>
    </div>
    <div class="group"><span class="label">Langue</span>${segHtml('lang', langOpts, p.lang)}
      ${frenchOriginal ? '<div class="note">Film d’origine française : la VO est la VF.</div>' : ''}</div>
    <div class="group"><span class="label">Qualité</span>${segHtml('quality', qOpts, p.quality)}</div>
    ${isSeries ? `<div class="group"><span class="label">Saisons à récupérer</span>${segHtml('seasons', sOpts, p.seasons)}</div>` : ''}
    <div class="group"><label class="toggle"><input type="checkbox" data-f="searchNow" ${p.searchNow ? 'checked' : ''}><span class="track"></span><span>Lancer la recherche immédiatement</span></label></div>
    <div class="group"><label class="toggle"><input type="checkbox" data-f="remember"><span class="track"></span><span>Utiliser ces choix par défaut la prochaine fois</span></label></div>
    <div class="group"><span class="label">Note (facultatif)</span><input class="input" data-f="note" maxlength="120" placeholder="Ex. : version longue, pour les enfants…" value="${esc(p.note || '')}"></div>
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">Annuler</button>
      <button class="btn primary" data-act="ok">${icon('star', 'fill')}${editing ? 'Enregistrer' : 'Ajouter aux favoris'}</button>
    </div>`;
  return openSheet(html, {
    onMount(sheet, done) {
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-seg] button');
        if (b) {
          const seg = b.parentNode;
          seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
          p[seg.dataset.seg] = b.dataset.v;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') done(null);
        if (act === 'ok') {
          p.searchNow = sheet.querySelector('[data-f=searchNow]').checked;
          p.note = sheet.querySelector('[data-f=note]').value.trim();
          done({ prefs: p, rememberDefaults: sheet.querySelector('[data-f=remember]').checked });
        }
      });
      sheet.querySelector('[data-act=ok]').focus({ preventScroll: true });
    },
  });
}

export function confirmSheet(title, text, { ok = 'Confirmer', danger = false } = {}) {
  return openSheet(`<h3 style="margin:0 0 8px;font-size:19px">${esc(title)}</h3><p class="muted" style="margin:0">${esc(text)}</p>
    <div class="sheet-actions"><button class="btn" data-act="no">Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="yes">${esc(ok)}</button></div>`, {
    onMount(sheet, done) {
      sheet.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]')?.dataset.act;
        if (a) done(a === 'yes');
      });
    },
  });
}
