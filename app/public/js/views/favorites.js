import { api, bus, refreshState, loadDefaults } from '../app.js';
import { $, esc, icon, toast, ago, statusPill, prefsTags, askPrefs, confirmSheet, posterHtml } from '../ui.js';

let root;
let items = [];
let filter = 'all';
let poll = null;

const FILTERS = {
  all: { label: 'Tous', test: () => true },
  active: { label: 'En cours', test: (f) => ['pending', 'searching', 'downloading', 'downloaded', 'partial', 'upcoming'].includes(f.status) },
  notfound: { label: 'Introuvables', test: (f) => ['notfound', 'error'].includes(f.status) },
  available: { label: 'Disponibles', test: (f) => f.status === 'available' },
};

export function mount(el) {
  root = el;
  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div class="grow"><h1>Favoris</h1><p id="f-sub">Vos demandes de téléchargement et leur avancement.</p></div>
      <button class="btn" data-f="sync">${icon('refresh')}Actualiser</button>
    </div>
    <div class="chips" id="f-filters" style="margin-bottom:18px"></div>
    <div class="fav-list" id="f-list"><div class="skel" style="height:120px"></div><div class="skel" style="height:120px"></div></div>
  </div>`;

  root.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; render(); return; }
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const key = b.closest('[data-key]')?.dataset.key;
    const fav = items.find((x) => x.key === key);
    const act = b.dataset.f;
    try {
      if (act === 'sync') {
        b.disabled = true;
        b.innerHTML = `${icon('loader', 'spin')}Actualisation…`;
        await api('/favorites/sync', { method: 'POST' });
        await load();
        toast('Favoris synchronisés avec le NAS');
      } else if (act === 'search') {
        b.disabled = true;
        await api(`/favorites/${encodeURIComponent(key)}/search`, { method: 'POST' });
        toast(`Recherche relancée pour « ${fav.item.title} »`);
        await load();
      } else if (act === 'prefs') {
        const answer = await askPrefs({ ...fav.item, type: fav.type }, fav.prefs, { editing: true });
        if (!answer) return;
        await api(`/favorites/${encodeURIComponent(key)}`, { method: 'PATCH', body: { prefs: answer.prefs } });
        toast('Préférences mises à jour et renvoyées au NAS');
        await load();
      } else if (act === 'remove') {
        const ok = await confirmSheet(`Retirer « ${fav.item.title} » ?`, fav.status === 'available'
          ? 'Le titre reste dans NETFLEX, il est seulement retiré de la liste.'
          : 'La recherche automatique sera arrêtée. Rien n’est supprimé du NAS.', { ok: 'Retirer', danger: true });
        if (!ok) return;
        await api(`/favorites/${encodeURIComponent(key)}`, { method: 'DELETE' });
        toast('Retiré des favoris');
        await load();
        refreshState();
      }
    } catch (err) {
      toast(err.message, { type: 'err' });
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  });
  bus.addEventListener('favorites-changed', () => { if (root.classList.contains('active')) load(); else items = []; });
}

export function show() {
  load();
  clearInterval(poll);
  poll = setInterval(() => {
    if (!root.classList.contains('active')) return clearInterval(poll);
    if (!document.hidden) load(true);
  }, 20_000);
  loadDefaults().catch(() => {});
}

async function load(silent = false) {
  try {
    const data = await api('/favorites');
    items = data.items;
    $('#f-sub', root).textContent = data.syncedAt ? `Synchronisé avec le NAS ${ago(data.syncedAt)}.` : 'Vos demandes de téléchargement et leur avancement.';
    render();
  } catch (err) {
    if (!silent) $('#f-list', root).innerHTML = `<div class="empty"><div class="big">${icon('alert')}</div><h3>Chargement impossible</h3><p>${esc(err.message)}</p></div>`;
  }
}

function render() {
  $('#f-filters', root).innerHTML = Object.entries(FILTERS)
    .map(([k, f]) => `<button class="chip ${k === filter ? 'active' : ''}" data-filter="${k}">${f.label} <span class="n">${items.filter(f.test).length}</span></button>`)
    .join('');
  const list = items.filter(FILTERS[filter].test);
  const box = $('#f-list', root);
  if (!items.length) {
    box.innerHTML = `<div class="empty"><div class="big">${icon('star')}</div><h3>Aucun favori pour l’instant</h3><p>Parcourez les suggestions ou le mode Swipe et ajoutez ce qui vous fait envie : la demande part directement au NAS.</p>
      <div class="row-flex" style="justify-content:center;margin-top:18px"><a class="btn primary" href="#/decouvrir">${icon('compass')}Découvrir</a><a class="btn" href="#/swipe">${icon('cards')}Swipe</a></div></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty"><p>Rien dans cette catégorie.</p></div>`;
    return;
  }
  box.innerHTML = list.map(favHtml).join('');
}

function favHtml(f) {
  const it = f.item;
  const year = it.type === 'series' && it.endYear ? `${it.year}–${it.endYear}` : it.year;
  const when = [];
  if (f.status === 'available' && f.availableAt) when.push(`Arrivé dans NETFLEX ${ago(f.availableAt)}`);
  else {
    if (f.arr?.lastSearchAt) when.push(`Dernière recherche ${ago(f.arr.lastSearchAt)}`);
    if (f.nextSearchAt) when.push(f.nextSearchAt <= Date.now() ? 'nouvelle recherche imminente' : `prochaine ${ago(f.nextSearchAt)}`);
    if (f.arr?.searchCount) when.push(`${f.arr.searchCount} recherche${f.arr.searchCount > 1 ? 's' : ''}`);
  }
  when.push(`ajouté ${ago(f.addedAt)}${f.addedBy ? ` par ${esc(f.addedBy)}` : ''}`);
  const msg = f.status === 'notfound'
    ? 'Aucune version ne correspond encore à vos critères. Flexlist relance la recherche automatiquement ; vous pouvez aussi assouplir les préférences.'
    : f.message || (f.episodes && f.type === 'series' && f.episodes.total ? `${f.episodes.have}/${f.episodes.total} épisodes récupérés` : '');
  const canSearch = f.status !== 'available' && f.status !== 'pending';
  return `<article class="fav-item" data-key="${esc(f.key)}">
    <a class="thumb" href="#/fiche/${encodeURIComponent(f.key)}">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : posterHtml(null, it.title)}</a>
    <div style="min-width:0">
      <h3><a href="#/fiche/${encodeURIComponent(f.key)}">${esc(it.title)}</a> <span class="y">${esc(year || '')}</span></h3>
      <div class="prefs"><span class="tag">${icon(f.type === 'series' ? 'tv' : 'film')}${f.type === 'series' ? 'Série' : 'Film'}</span>${prefsTags(f.prefs, f.type)}</div>
      ${statusPill(f)}
      ${f.status === 'downloading' && f.progress != null ? `<div class="progress"><i style="width:${f.progress}%"></i></div>` : ''}
      ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
      ${f.warning ? `<div class="msg" style="color:var(--warn)">${icon('alert')} ${esc(f.warning)}</div>` : ''}
      <div class="when">${when.join(' · ')}</div>
    </div>
    <div class="acts">
      ${canSearch ? `<button class="btn sm" data-f="search">${icon('search')}Rechercher</button>` : ''}
      ${f.status !== 'available' ? `<button class="btn sm" data-f="prefs">${icon('sliders')}Préférences</button>` : ''}
      <button class="btn sm ghost danger" data-f="remove">${icon('trash')}Retirer</button>
    </div>
  </article>`;
}
