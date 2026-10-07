// Flexlist — application web installable (PWA).
import { $, $$, esc, icon, toast, askPrefs } from './ui.js';
import * as discover from './views/discover.js';
import * as swipe from './views/swipe.js';
import * as search from './views/search.js';
import * as favorites from './views/favorites.js';
import * as library from './views/library.js';
import * as settings from './views/settings.js';
import * as detail from './views/detail.js';

export const store = { state: null, defaults: null, installPrompt: null, user: '' };
export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

try { store.user = localStorage.getItem('flexlist.user') || ''; } catch {}

// ---------------------------------------------------------------- API

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Flexlist-User': encodeURIComponent(store.user || '') },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && data.auth) {
    renderLogin();
    throw new Error('Authentification requise');
  }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export async function loadDefaults() {
  if (!store.defaults) {
    const s = await api('/settings');
    store.defaults = s.defaults;
  }
  return store.defaults;
}

// ---------------------------------------------------------------- Favoris (action partagée)

export async function addFavorite(item) {
  const defaults = await loadDefaults().catch(() => ({}));
  const answer = await askPrefs(item, defaults);
  if (!answer) return null;
  try {
    const fav = await api('/favorites', { method: 'POST', body: { key: item.key, prefs: answer.prefs, rememberDefaults: answer.rememberDefaults } });
    if (answer.rememberDefaults) store.defaults = { ...store.defaults, ...answer.prefs };
    markCards(item.key, fav.status);
    emit('favorites-changed', fav);
    const msg = fav.status === 'available'
      ? `« ${item.title} » est déjà dans NETFLEX`
      : fav.status === 'error'
        ? `« ${item.title} » ajouté, mais l’envoi a échoué`
        : fav.status === 'pending'
          ? `« ${item.title} » ajouté — en attente de connexion au NAS`
          : `« ${item.title} » ajouté et demandé au NAS`;
    toast(msg, { type: fav.status === 'error' ? 'err' : 'ok', action: 'Voir', onAction: () => (location.hash = '#/favoris') });
    refreshState();
    return fav;
  } catch (err) {
    toast(err.message, { type: 'err' });
    return null;
  }
}

/** Met à jour toutes les cartes affichées pour un élément devenu favori. */
export function markCards(key, status) {
  for (const card of $$(`.card[data-key="${CSS.escape(key)}"]`)) {
    const btn = card.querySelector('.quick-add');
    if (btn) { btn.classList.add('on'); btn.innerHTML = icon('star', 'fill'); btn.title = 'Déjà en favori'; }
    const holder = card.querySelector('.poster')?.parentNode;
    if (holder && !holder.querySelector('.badge.ok, .badge.fav')) holder.insertAdjacentHTML('beforeend', `<span class="badge ${status === 'available' ? 'ok' : 'fav'}">${status === 'available' ? `${icon('check')}NETFLEX` : `${icon('star', 'fill')}Favori`}</span>`);
  }
}

function itemFromCard(card) {
  const key = card.dataset.key;
  return {
    key,
    type: key.split(':')[0],
    title: card.querySelector('.t')?.textContent || '',
    poster: card.querySelector('.poster img')?.getAttribute('src') || null,
    year: (card.querySelector('.s')?.textContent || '').slice(0, 4),
  };
}

// ---------------------------------------------------------------- Coquille

const TABS = [
  { id: 'decouvrir', label: 'Découvrir', icon: 'compass', view: discover },
  { id: 'swipe', label: 'Swipe', icon: 'cards', view: swipe },
  { id: 'recherche', label: 'Rechercher', icon: 'search', view: search, desktopOnly: true },
  { id: 'favoris', label: 'Favoris', icon: 'star', view: favorites },
  { id: 'bibliotheque', label: 'NETFLEX', icon: 'library', view: library },
  { id: 'reglages', label: 'Réglages', icon: 'settings', view: settings },
];

const brand = `<div class="brand"><span class="brand-mark">${icon('star', 'fill')}</span><span>Flex<b>list</b></span></div>`;

function renderShell() {
  $('#app').innerHTML = `
    <aside class="sidebar">
      ${brand}
      ${TABS.map((t) => `<a class="sidelink" href="#/${t.id}" data-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span>${t.id === 'favoris' ? '<span class="count" data-count="fav" hidden></span>' : ''}</a>`).join('')}
      <div class="side-foot" id="side-foot"></div>
    </aside>
    <header class="topbar">
      ${brand}
      <span class="spacer"></span>
      <a class="icon-btn" href="#/recherche" aria-label="Rechercher">${icon('search')}</a>
    </header>
    <main class="main">
      ${TABS.map((t) => `<section class="view" data-view="${t.id}"></section>`).join('')}
    </main>
    <nav class="bottomnav">
      ${TABS.filter((t) => !t.desktopOnly).map((t) => `<a class="navlink" href="#/${t.id}" data-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span>${t.id === 'favoris' ? '<span class="dot-badge" data-count="fav" hidden></span>' : ''}</a>`).join('')}
    </nav>`;
}

const mounted = new Set();
let currentTab = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, qs] = raw.split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || '') };
}

function onRoute() {
  const { parts, params } = parseHash();
  if (parts[0] === 'fiche' && parts[1]) {
    if (!currentTab) showTab('decouvrir', new URLSearchParams());
    detail.open(parts[1]);
    return;
  }
  detail.close();
  showTab(parts[0] || 'decouvrir', params);
}

function showTab(id, params) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  const el = $(`.view[data-view="${tab.id}"]`);
  if (!mounted.has(tab.id)) {
    tab.view.mount(el);
    mounted.add(tab.id);
  }
  if (currentTab !== tab.id) {
    $$('.view').forEach((v) => v.classList.toggle('active', v === el));
    $$('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab.id));
    const restore = currentTab ? tab.scrollY || 0 : null;
    currentTab = tab.id;
    if (restore !== null) window.scrollTo({ top: restore });
  }
  tab.view.show?.(params);
}

// Mémorise la position de défilement de chaque onglet.
window.addEventListener('scroll', () => {
  const t = TABS.find((x) => x.id === currentTab);
  if (t && !$('#overlay').classList.contains('open')) t.scrollY = window.scrollY;
}, { passive: true });

// ---------------------------------------------------------------- État global

export async function refreshState() {
  try {
    store.state = await api('/state');
  } catch {
    return;
  }
  const s = store.state;
  for (const el of $$('[data-count="fav"]')) {
    const n = s.favorites.active;
    el.hidden = !n;
    el.textContent = n;
  }
  const foot = $('#side-foot');
  if (foot) {
    const running = Object.values(s.tasks).find((t) => t.running);
    foot.innerHTML = `
      <div class="conn"><span class="status-dot ${s.connections.radarr ? 'on' : 'off'}"></span>Radarr ${s.connections.radarr ? 'connecté' : 'non connecté'}</div>
      <div class="conn"><span class="status-dot ${s.connections.sonarr ? 'on' : 'off'}"></span>Sonarr ${s.connections.sonarr ? 'connecté' : 'non connecté'}</div>
      <div style="margin-top:8px">${s.library.movies} films · ${s.library.series} séries</div>
      ${running ? `<div style="margin-top:6px;color:var(--muted)">${icon('loader', 'spin')} ${esc(running.progress || running.label)}</div>` : ''}`;
  }
  emit('state', s);
}

// ---------------------------------------------------------------- Connexion

function renderLogin() {
  $('#app').innerHTML = `<div class="login"><form class="box" id="login-form">
    <div class="brand"><span class="brand-mark">${icon('star', 'fill')}</span><span>Flex<b>list</b></span></div>
    <div class="field"><input class="input" type="password" name="password" placeholder="Mot de passe" autocomplete="current-password" autofocus required></div>
    <button class="btn primary block lg">${icon('lock')}Entrer</button>
    <p class="faint small" style="margin-top:18px">Application privée — accès réservé à la maison.</p>
  </form></div>`;
  $('.bottomnav')?.remove();
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/login', { method: 'POST', body: { password: e.target.password.value } });
      location.reload();
    } catch (err) {
      toast(err.message, { type: 'err' });
    }
  };
}

// ---------------------------------------------------------------- Démarrage

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const action = a.dataset.action;
  if (action === 'quick-fav') {
    e.preventDefault();
    e.stopPropagation();
    if (a.classList.contains('on')) {
      location.hash = `#/fiche/${encodeURIComponent(a.dataset.key)}`;
      return;
    }
    const card = a.closest('.card');
    addFavorite(itemFromCard(card));
  } else if (action === 'scroll') {
    const strip = a.parentNode.querySelector('.strip');
    strip.scrollBy({ left: Number(a.dataset.dir) * strip.clientWidth * 0.85, behavior: 'smooth' });
  }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  store.installPrompt = e;
  emit('installable');
});

async function boot() {
  let auth = { required: false, ok: true };
  try { auth = await api('/auth'); } catch {}
  if (auth.required && !auth.ok) return renderLogin();
  renderShell();
  window.addEventListener('hashchange', onRoute);
  onRoute();
  refreshState();
  setInterval(refreshState, 30_000);
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
