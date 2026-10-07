import { api, addFavorite, emit, refreshState, store } from '../app.js';
import { $, esc, icon, toast, runtime, bytes, ago, statusPill, prefsTags, askPrefs, cardHtml, posterHtml, confirmSheet } from '../ui.js';

let overlay;
let currentKey = null;
let navCount = 0;
window.addEventListener('hashchange', () => navCount++);

function closeNav() {
  if (navCount > 0) history.back();
  else location.replace('#/decouvrir');
}

export function close() {
  overlay = overlay || $('#overlay');
  if (!overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  overlay.innerHTML = '';
  overlay.setAttribute('aria-hidden', 'true');
  currentKey = null;
  if (!$('#sheets').children.length) document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentKey && !document.querySelector('.sheet-wrap')) closeNav();
});

export async function open(key) {
  overlay = $('#overlay');
  if (currentKey === key && overlay.classList.contains('open')) return;
  currentKey = key;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  overlay.innerHTML = `<div class="scrim" data-close></div><div class="detail" role="dialog" aria-modal="true">
    <button class="d-close" data-close aria-label="Fermer">${icon('x')}</button>
    <div class="d-back skel" style="border-radius:0"></div>
    <div class="d-body"><div class="d-top"><div class="d-poster skel"></div><div><div class="skel" style="height:34px;width:70%"></div><div class="skel" style="height:16px;width:40%;margin-top:12px"></div></div></div></div>
  </div>`;
  overlay.onclick = (e) => { if (e.target.closest('[data-close]')) closeNav(); };
  try {
    if (key.startsWith('lib:')) {
      const e = await api(`/library/${encodeURIComponent(key.slice(4))}`);
      if (currentKey === key) renderLibraryOnly(e);
    } else {
      const d = await api(`/item/${encodeURIComponent(key)}`);
      if (currentKey === key) render(d);
    }
  } catch (err) {
    if (currentKey !== key) return;
    $('.d-body', overlay).innerHTML = `<div class="empty"><div class="big">${icon('alert')}</div><h3>Fiche indisponible</h3><p>${esc(err.message)}</p></div>`;
  }
}

function scoresHtml(it) {
  const s = [];
  if (it.type === 'movie') {
    const r = it.ratings || {};
    if (r.imdb) s.push(`<span class="score"><i class="imdb">IMDb</i>${r.imdb.toFixed(1)}${r.imdbVotes ? ` <span class="faint small">(${r.imdbVotes >= 1000 ? `${Math.round(r.imdbVotes / 1000)} k` : r.imdbVotes})</span>` : ''}</span>`);
    if (r.tmdb) s.push(`<span class="score"><i class="tmdb">TMDb</i>${r.tmdb.toFixed(1)}</span>`);
    if (r.rt) s.push(`<span class="score"><i class="rt">RT</i>${r.rt} %</span>`);
    if (r.mc) s.push(`<span class="score"><i class="mz">MC</i>${r.mc}</span>`);
  } else if (it.rating) {
    s.push(`<span class="score"><i class="mz">TVmaze</i>${it.rating.toFixed(1)}</span>`);
  }
  return s.length ? `<div class="scores">${s.join('')}</div>` : '';
}

/** Nombre d'épisodes manquants d'une série présente sur le NAS (null si inconnu). */
function missingEpisodes(d) {
  const seasons = d.extras?.seasons || [];
  if (!d.library || !seasons.length || seasons.some((s) => !s.episodes)) return null;
  const total = seasons.filter((s) => s.year && s.year <= new Date().getFullYear()).reduce((a, s) => a + s.episodes, 0);
  const have = (d.library.seasons || []).filter((s) => s.number != null).reduce((a, s) => a + s.episodes, 0);
  return Math.max(0, total - have);
}

function statusBlock(d) {
  const it = d.item;
  const fav = d.favorite;
  const lib = d.library;
  let html = '';
  if (lib) {
    const missing = it.type === 'series' ? missingEpisodes(d) : null;
    const details = lib.type === 'series'
      ? `${lib.seasons?.length || 0} saison(s) · ${lib.episodes} épisodes · ${bytes(lib.size)}`
      : `${lib.files} fichier(s) · ${bytes(lib.size)}${lib.mainFile ? ` · <span class="faint">${esc(lib.mainFile)}</span>` : ''}`;
    html += `<div class="d-status ok"><div class="row-flex"><span class="pill available">${icon('check')}Déjà dans NETFLEX</span></div>
      <div class="small muted">${icon('folder')} ${esc(lib.path)}<br>${details}</div>
      ${it.type === 'series' && !fav && missing > 0 ? `<div class="small" style="color:var(--warn)">Il manque environ ${missing} épisode${missing > 1 ? 's' : ''} par rapport à la diffusion.</div><div class="row-flex"><button class="btn sm" data-d="fav">${icon('download')}Compléter la série</button></div>` : ''}</div>`;
  }
  if (fav) {
    html += `<div class="d-status"><div class="row-flex">${statusPill(fav)}<span class="small faint">favori ${ago(fav.addedAt)}${fav.addedBy ? ` par ${esc(fav.addedBy)}` : ''}</span></div>
      <div class="row-flex">${prefsTags(fav.prefs, fav.type)}</div>
      ${fav.status === 'downloading' && fav.progress != null ? `<div class="progress"><i style="width:${fav.progress}%"></i></div>` : ''}
      ${fav.message ? `<div class="small muted">${esc(fav.message)}</div>` : ''}
      ${fav.warning ? `<div class="small" style="color:var(--warn)">${esc(fav.warning)}</div>` : ''}
      ${fav.status === 'notfound' ? '<div class="small muted">Introuvable avec ces critères pour le moment — la recherche est relancée automatiquement. Assouplir la langue ou la qualité augmente les chances.</div>' : ''}
      <div class="row-flex">
        ${fav.status !== 'available' ? `<button class="btn sm" data-d="prefs">${icon('sliders')}Préférences</button><button class="btn sm" data-d="search">${icon('search')}Rechercher maintenant</button>` : ''}
        <a class="btn sm ghost" href="#/favoris">${icon('star')}Mes favoris</a>
        <button class="btn sm ghost danger" data-d="unfav">${icon('trash')}Retirer</button>
      </div>
      ${fav.events?.length ? `<details><summary class="small muted" style="cursor:pointer">Historique</summary><div class="timeline" style="margin-top:8px">${[...fav.events].reverse().map((ev) => `<div><time>${new Date(ev.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</time><span>${esc(ev.text)}</span></div>`).join('')}</div></details>` : ''}
    </div>`;
  }
  if (!lib && !fav) {
    html += `<div class="d-cta">
      <button class="btn primary lg" data-d="fav">${icon('star', 'fill')}Ajouter aux favoris</button>
      ${it.trailer ? `<a class="btn lg" href="https://www.youtube.com/watch?v=${esc(it.trailer)}" target="_blank" rel="noopener">${icon('play')}Bande-annonce</a>` : ''}
      ${d.dismissed ? `<button class="btn lg ghost" data-d="undismiss">${icon('undo')}Ne plus écarter</button>` : `<button class="btn lg ghost" data-d="dismiss">${icon('eyeoff')}Pas intéressé</button>`}
    </div>`;
  } else if (it.trailer) {
    html += `<div class="d-cta"><a class="btn" href="https://www.youtube.com/watch?v=${esc(it.trailer)}" target="_blank" rel="noopener">${icon('play')}Bande-annonce</a></div>`;
  }
  return html;
}

function castHtml(cast) {
  if (!cast?.length) return '';
  return `<div class="d-section"><h3>Distribution</h3><div class="cast">${cast.map((p) => `<div class="p">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<div class="ph">${esc((p.name || '?')[0])}</div>`}<b>${esc(p.name)}</b><span>${esc(p.role || '')}</span></div>`).join('')}</div></div>`;
}

function render(d) {
  const it = d.item;
  const ex = d.extras || {};
  const back = it.backdrop || ex.backdrop || it.posterHd || it.poster;
  const facts = it.type === 'movie'
    ? [it.year, runtime(it.runtime), it.cert ? (/^(U|TP|0)$/i.test(it.cert) ? 'Tous publics' : /^\d+$/.test(it.cert) ? `Interdit -${it.cert} ans` : it.cert) : null, (it.genres || []).join(', ')]
    : [it.endYear ? `${it.year}–${it.endYear}` : it.year ? `${it.year}${it.status === 'Running' ? ' – en cours' : ''}` : null, it.network, it.runtime ? `${it.runtime} min/ép.` : null, (it.genres || []).join(', ')];
  const libSeasons = new Set((d.library?.seasons || []).map((s) => s.number).filter((n) => n != null));
  const credits = it.type === 'movie'
    ? [it.director?.length ? `<b>Réalisation</b> ${esc(it.director.join(', '))}` : '', it.studio ? `<b>Studio</b> ${esc(it.studio)}` : '', it.collection ? `<b>Saga</b> ${esc(it.collection)}` : '']
    : [it.network ? `<b>Diffuseur</b> ${esc(it.network)}` : '', it.status ? `<b>Statut</b> ${esc({ Running: 'En cours', Ended: 'Terminée', 'To Be Determined': 'Avenir incertain', 'In Development': 'En développement' }[it.status] || it.status)}` : '', it.language ? `<b>Langue</b> ${esc(it.language)}` : ''];
  const body = `
    <div class="d-top">
      <div class="d-poster">${posterHtml(it.posterHd || it.poster, it.title, { eager: true })}</div>
      <div class="d-title">
        <h1>${esc(it.title)}</h1>
        ${it.originalTitle && it.originalTitle !== it.title ? `<div class="orig">${esc(it.originalTitle)}</div>` : ''}
        <div class="d-facts">${facts.filter(Boolean).map(esc).join('<span class="sep">•</span>')}</div>
        ${scoresHtml(it)}
      </div>
    </div>
    ${statusBlock(d)}
    ${it.overview ? `<div class="d-section"><h3>Synopsis</h3><p class="d-overview">${esc(it.overview)}</p>${it.type === 'series' ? '<p class="small faint" style="margin-top:6px">Résumé fourni par TVmaze (en anglais).</p>' : ''}</div>` : ''}
    ${credits.some(Boolean) ? `<div class="d-section small muted" style="display:flex;gap:18px;flex-wrap:wrap">${credits.filter(Boolean).map((c) => `<span>${c}</span>`).join('')}</div>` : ''}
    ${castHtml(it.cast || ex.cast)}
    ${ex.seasons?.length ? `<div class="d-section"><h3>Saisons</h3><div class="seasons">${ex.seasons.map((s) => `<span class="season ${libSeasons.has(s.number) ? 'have' : ''}">${libSeasons.has(s.number) ? '✓ ' : ''}Saison ${s.number}<small>${[s.year, s.episodes ? `${s.episodes} ép.` : ''].filter(Boolean).join(' · ')}</small></span>`).join('')}</div>${d.library ? '<p class="small faint" style="margin-top:8px">En vert : saisons présentes dans NETFLEX.</p>' : ''}</div>` : ''}
    ${d.similar?.length ? `<div class="d-section"><h3>Dans la même veine</h3><div class="strip" style="padding:0">${d.similar.map((s) => cardHtml(s)).join('')}</div></div>` : ''}
  `;
  const detail = $('.detail', overlay);
  detail.querySelector('.d-back').outerHTML = `<div class="d-back" style="background-image:url('${esc(back)}')${!it.backdrop && !ex.backdrop ? ';filter:blur(18px) brightness(.7);transform:scale(1.1)' : ''}"></div>`;
  $('.d-body', overlay).innerHTML = body;
  detail.scrollTop = 0;
  detail.onclick = (e) => onAction(e, d);
}

function renderLibraryOnly(e) {
  const detail = $('.detail', overlay);
  detail.querySelector('.d-back').outerHTML = `<div class="d-back" style="background:linear-gradient(160deg,hsl(220 35% 22%),var(--bg))"></div>`;
  const seasons = (e.seasons || []).map((s) => `<span class="season have">${esc(s.name)}<small>${s.episodes} ép.</small></span>`).join('');
  $('.d-body', overlay).innerHTML = `
    <div class="d-top"><div class="d-poster">${posterHtml(null, e.title)}</div>
      <div class="d-title"><h1>${esc(e.title)}</h1><div class="d-facts">${[e.year || e.yearStart, e.type === 'series' ? `${e.episodes} épisodes` : `${e.files} fichier(s)`, bytes(e.size)].filter(Boolean).map(esc).join('<span class="sep">•</span>')}</div></div></div>
    <div class="d-status ok"><span class="pill available">${icon('check')}Dans NETFLEX</span><div class="small muted">${icon('folder')} ${esc(e.path)}${e.mainFile ? `<br>${esc(e.mainFile)}` : ''}</div></div>
    ${seasons ? `<div class="d-section"><h3>Contenu</h3><div class="seasons">${seasons}</div></div>` : ''}
    <div class="d-section"><p class="muted small">Ce dossier n’a pas encore été associé à une fiche (affiche, résumé). L’identification se fait automatiquement en arrière-plan.</p>
    <a class="btn" href="#/recherche?q=${encodeURIComponent(e.searchTitle || e.title)}">${icon('search')}Chercher la fiche</a></div>`;
}

async function onAction(e, d) {
  const b = e.target.closest('[data-d]');
  if (!b) return;
  const it = d.item;
  const act = b.dataset.d;
  try {
    if (act === 'fav') {
      const defaults = d.library && it.type === 'series' ? { seasons: 'missing' } : {};
      if (Object.keys(defaults).length) {
        const answer = await askPrefs(it, { ...(store.defaults || {}), ...defaults });
        if (!answer) return;
        await api('/favorites', { method: 'POST', body: { key: it.key, prefs: answer.prefs } });
        toast('Demande envoyée pour compléter la série');
      } else {
        const fav = await addFavorite(it);
        if (!fav) return;
      }
    } else if (act === 'prefs') {
      const answer = await askPrefs(it, d.favorite.prefs, { editing: true });
      if (!answer) return;
      await api(`/favorites/${encodeURIComponent(it.key)}`, { method: 'PATCH', body: { prefs: answer.prefs } });
      toast('Préférences mises à jour');
    } else if (act === 'search') {
      b.disabled = true;
      await api(`/favorites/${encodeURIComponent(it.key)}/search`, { method: 'POST' });
      toast('Recherche relancée');
    } else if (act === 'unfav') {
      const ok = await confirmSheet(`Retirer « ${it.title} » des favoris ?`, 'La recherche automatique sera arrêtée. Rien n’est supprimé du NAS.', { ok: 'Retirer', danger: true });
      if (!ok) return;
      await api(`/favorites/${encodeURIComponent(it.key)}`, { method: 'DELETE' });
      toast('Retiré des favoris');
    } else if (act === 'dismiss') {
      await api('/dismiss', { method: 'POST', body: { key: it.key } });
      toast('Ce titre ne vous sera plus proposé', { action: 'Annuler', onAction: () => api(`/dismiss/${encodeURIComponent(it.key)}`, { method: 'DELETE' }) });
    } else if (act === 'undismiss') {
      await api(`/dismiss/${encodeURIComponent(it.key)}`, { method: 'DELETE' });
    }
    emit('favorites-changed');
    refreshState();
    const fresh = await api(`/item/${encodeURIComponent(it.key)}`);
    if (currentKey === it.key) render(fresh);
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}
