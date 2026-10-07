import { api, addFavorite, refreshState } from '../app.js';
import { $, $$, esc, icon, toast, runtime } from '../ui.js';

let root;
let deck = [];
let pos = 0;
let loading = false;
let filters = { type: 'all', genre: '' };
const seen = new Set();
const history = [];
const stats = { like: 0, nope: 0, later: 0 };

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="swipe-wrap">
      <div class="swipe-top">
        <div class="chips" id="sw-type">
          <button class="chip active" data-type="all">Tout</button>
          <button class="chip" data-type="movie">${icon('film')}Films</button>
          <button class="chip" data-type="series">${icon('tv')}Séries</button>
        </div>
        <select class="input" id="sw-genre" aria-label="Genre"><option value="">Tous les genres</option></select>
        <div class="swipe-stats" id="sw-stats"></div>
      </div>
      <div class="deck" id="deck"></div>
      <div class="swipe-actions">
        <button class="sbtn small undo" data-sw="undo" title="Annuler (Retour arrière)" aria-label="Annuler">${icon('undo')}</button>
        <button class="sbtn nope" data-sw="nope" title="Pas intéressé (←)" aria-label="Pas intéressé">${icon('x')}</button>
        <button class="sbtn like" data-sw="like" title="Ajouter aux favoris (→)" aria-label="Ajouter aux favoris">${icon('star', 'fill')}</button>
        <button class="sbtn later" data-sw="later" title="Plus tard (↑)" aria-label="Plus tard">${icon('up')}</button>
        <button class="sbtn small" data-sw="info" title="Détails (Entrée)" aria-label="Détails">${icon('info')}</button>
      </div>
      <div class="swipe-hint">→ favori · ← pas intéressé · ↑ plus tard</div>
    </div>`;

  $('#sw-type', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    $$('#sw-type .chip', root).forEach((c) => c.classList.toggle('active', c === b));
    filters.type = b.dataset.type;
    reset();
  });
  $('#sw-genre', root).addEventListener('change', (e) => {
    filters.genre = e.target.value;
    reset();
  });
  root.querySelector('.swipe-actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw]');
    if (!b) return;
    const a = b.dataset.sw;
    if (a === 'undo') undo();
    else if (a === 'info') openInfo();
    else decide(a);
  });
  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('active') || document.querySelector('.sheet-wrap') || document.querySelector('#overlay.open')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const map = { ArrowRight: 'like', ArrowLeft: 'nope', ArrowUp: 'later' };
    if (map[e.key]) { e.preventDefault(); decide(map[e.key]); }
    else if (e.key === 'Backspace' || e.key === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'Enter') openInfo();
  });

  api('/genres').then((g) => {
    $('#sw-genre', root).insertAdjacentHTML('beforeend', g.map((x) => `<option>${esc(x)}</option>`).join(''));
  }).catch(() => {});
  renderStats();
}

export function show() {
  if (!deck.length) fetchMore();
}

function reset() {
  deck = [];
  pos = 0;
  render();
  fetchMore();
}

async function fetchMore() {
  if (loading) return;
  loading = true;
  if (!deck.length) $('#deck', root).innerHTML = '<div class="scard skel"></div>';
  try {
    const exclude = [...seen].slice(-400).join(',');
    const items = await api(`/swipe?type=${filters.type}&genre=${encodeURIComponent(filters.genre)}&exclude=${encodeURIComponent(exclude)}`);
    for (const it of items) {
      if (seen.has(it.key)) continue;
      seen.add(it.key);
      deck.push(it);
    }
  } catch (err) {
    toast(err.message, { type: 'err' });
  } finally {
    loading = false;
  }
  render();
}

function current() {
  return deck[pos];
}

function render() {
  const box = $('#deck', root);
  const visible = deck.slice(pos, pos + 3);
  if (!visible.length) {
    box.innerHTML = loading
      ? '<div class="scard skel"></div>'
      : `<div class="deck-empty"><div><div class="empty" style="padding:0"><div class="big">${icon('sparkles')}</div><h3>Plus rien à proposer</h3><p>Changez de filtre, ou revenez quand le catalogue aura été mis à jour.</p></div></div></div>`;
    return;
  }
  box.innerHTML = visible
    .map((it, depth) => {
      const facts = [it.type === 'series' ? (it.endYear ? `${it.year}–${it.endYear}` : it.year) : it.year, it.type === 'movie' ? runtime(it.runtime) : it.network, (it.genres || []).slice(0, 2).join(', ')].filter(Boolean);
      return `<div class="scard" data-depth="${depth}" style="z-index:${10 - depth};transform:translateY(${depth * 12}px) scale(${1 - depth * 0.045});${depth > 1 ? 'opacity:.6' : ''}">
        <img class="poster-img" src="${esc(it.posterHd || it.poster)}" alt="" draggable="false">
        <div class="shade"></div>
        <div class="stamp like">Favori</div><div class="stamp nope">Non</div><div class="stamp later">Plus tard</div>
        <button class="more" data-more aria-label="Détails">${icon('info')}</button>
        <div class="info">
          <span class="kind">${icon(it.type === 'series' ? 'tv' : 'film')}${it.type === 'series' ? 'Série' : 'Film'}</span>
          <h3>${esc(it.title)}</h3>
          <div class="facts">${facts.map(esc).join(' · ')}${it.rating ? ` · <span class="imdb">★ ${Number(it.rating).toFixed(1)}</span>` : ''}</div>
          ${it.overview ? `<p>${esc(it.overview)}</p>` : ''}
        </div>
      </div>`;
    })
    .reverse()
    .join('');
  bindDrag($('.scard[data-depth="0"]', box));
  // Préchargement des affiches suivantes.
  for (const it of deck.slice(pos + 3, pos + 6)) new Image().src = it.posterHd || it.poster;
  if (deck.length - pos < 6) fetchMore();
}

function bindDrag(card) {
  if (!card) return;
  const like = card.querySelector('.stamp.like');
  const nope = card.querySelector('.stamp.nope');
  const later = card.querySelector('.stamp.later');
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, active = false;

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-more]') || e.button > 0) return;
    active = true;
    sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = Date.now();
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  card.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg)`;
    const vertical = dy < 0 && Math.abs(dy) > Math.abs(dx);
    like.style.opacity = !vertical ? Math.max(0, Math.min(1, dx / 100)) : 0;
    nope.style.opacity = !vertical ? Math.max(0, Math.min(1, -dx / 100)) : 0;
    later.style.opacity = vertical ? Math.max(0, Math.min(1, -dy / 100)) : 0;
  });
  const end = () => {
    if (!active) return;
    active = false;
    const dt = Math.max(1, Date.now() - t0);
    const vx = dx / dt;
    const vertical = dy < 0 && Math.abs(dy) > Math.abs(dx);
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      card.style.transform = '';
      openInfo();
      return;
    }
    if (!vertical && (dx > 110 || vx > 0.7)) return decide('like', { dx, dy });
    if (!vertical && (dx < -110 || vx < -0.7)) return decide('nope', { dx, dy });
    if (vertical && dy < -110) return decide('later', { dx, dy });
    card.style.transition = 'transform .35s cubic-bezier(.2,.9,.3,1.3)';
    card.style.transform = '';
    like.style.opacity = nope.style.opacity = later.style.opacity = 0;
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  card.querySelector('[data-more]').addEventListener('click', (e) => { e.stopPropagation(); openInfo(); });
}

function flyOut(action, from = {}) {
  const card = $('.scard[data-depth="0"]', root);
  if (!card) return Promise.resolve();
  const stamp = card.querySelector(`.stamp.${action}`);
  if (stamp) stamp.style.opacity = 1;
  const w = window.innerWidth;
  const to = action === 'like' ? `translate(${w}px, ${(from.dy || 0) + 40}px) rotate(28deg)`
    : action === 'nope' ? `translate(${-w}px, ${(from.dy || 0) + 40}px) rotate(-28deg)`
      : `translate(${from.dx || 0}px, ${-window.innerHeight}px) rotate(${(from.dx || 0) / 20}deg)`;
  card.style.transition = 'transform .32s ease-in, opacity .32s ease-in';
  card.style.transform = to;
  card.style.opacity = '0.4';
  return new Promise((r) => setTimeout(r, 300));
}

async function decide(action, from) {
  const it = current();
  if (!it) return;
  await flyOut(action, from);
  pos++;
  render();
  if (action === 'like') {
    const fav = await addFavorite(it);
    if (!fav) {
      // Ajout annulé : la carte revient sur le dessus.
      pos--;
      render();
      return;
    }
    stats.like++;
    history.push({ it, action });
    refreshState();
  } else if (action === 'nope') {
    stats.nope++;
    history.push({ it, action });
    api('/dismiss', { method: 'POST', body: { key: it.key } }).catch(() => {});
  } else {
    stats.later++;
    history.push({ it, action });
  }
  renderStats();
}

async function undo() {
  const last = history.pop();
  if (!last) {
    toast('Rien à annuler', { type: 'info', timeout: 1800 });
    return;
  }
  stats[last.action]--;
  if (last.action === 'nope') api(`/dismiss/${encodeURIComponent(last.it.key)}`, { method: 'DELETE' }).catch(() => {});
  if (last.action === 'like') {
    await api(`/favorites/${encodeURIComponent(last.it.key)}`, { method: 'DELETE' }).catch(() => {});
    last.it.fav = null;
    refreshState();
  }
  deck.splice(pos, 0, last.it);
  render();
  renderStats();
}

function openInfo() {
  const it = current();
  if (it) location.hash = `#/fiche/${encodeURIComponent(it.key)}`;
}

function renderStats() {
  $('#sw-stats', root).innerHTML = `<span>★ ${stats.like} ajouté${stats.like > 1 ? 's' : ''}</span><span>✕ ${stats.nope} écarté${stats.nope > 1 ? 's' : ''}</span><span>↑ ${stats.later} plus tard</span>`;
}
