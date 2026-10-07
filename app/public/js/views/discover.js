import { api, addFavorite, bus, store } from '../app.js';
import { $, $$, esc, icon, rowHtml, skeletonRows, runtime } from '../ui.js';

let root;
let loadedAt = 0;
let heroTimer = null;
let heroItems = [];

export function mount(el) {
  root = el;
  root.innerHTML = `<div class="hero skel" style="border-radius:0"></div><div id="d-banner"></div><div class="rows" id="d-rows">${skeletonRows(3)}</div>`;
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hero]');
    if (!b) return;
    const it = heroItems[Number(b.dataset.idx)];
    if (b.dataset.hero === 'fav') {
      const fav = await addFavorite(it);
      if (fav) b.outerHTML = `<button class="btn lg" disabled>${icon('star', 'fill')}Dans vos favoris</button>`;
    } else if (b.dataset.hero === 'dot') {
      setHero(Number(b.dataset.idx));
    }
  });
  bus.addEventListener('state', () => banner());
}

export function show() {
  // Recharge si les données ont plus de 5 minutes (le catalogue évolue en arrière-plan).
  if (Date.now() - loadedAt > 5 * 60_000) load();
}

async function load() {
  loadedAt = Date.now();
  try {
    const data = await api('/discover');
    renderHero(data.hero);
    const rows = $('#d-rows', root);
    if (!data.rows.length) {
      rows.innerHTML = `<div class="empty"><div class="big">${icon('loader', 'spin')}</div><h3>Préparation du catalogue…</h3><p>Les films et séries populaires sont en cours de téléchargement. Revenez dans un instant.</p></div>`;
      loadedAt = 0;
      setTimeout(() => { if (root.classList.contains('active')) load(); }, 8000);
      return;
    }
    rows.innerHTML = data.rows.map(rowHtml).join('');
  } catch (err) {
    loadedAt = 0;
    $('#d-rows', root).innerHTML = `<div class="empty"><div class="big">${icon('alert')}</div><h3>Impossible de charger les suggestions</h3><p>${esc(err.message)}</p></div>`;
  }
}

function banner() {
  const s = store.state;
  const el = $('#d-banner', root);
  if (!s || !el) return;
  const missing = [!s.connections.radarr && 'Radarr', !s.connections.sonarr && 'Sonarr'].filter(Boolean);
  el.innerHTML = missing.length
    ? `<div class="banner">${icon('alert')}<div><b>${missing.join(' et ')} pas encore connecté${missing.length > 1 ? 's' : ''}.</b> Vos favoris sont bien enregistrés et seront envoyés au NAS dès la connexion.</div><a class="btn sm" href="#/reglages">Configurer</a></div>`
    : '';
}

function renderHero(items) {
  heroItems = items || [];
  const hero = $('.hero', root);
  clearInterval(heroTimer);
  if (!heroItems.length) {
    hero.remove();
    return;
  }
  hero.classList.remove('skel');
  hero.innerHTML = heroItems.map((m, i) => `
    <div class="hero-slide ${i === 0 ? 'active' : ''}">
      <div class="bg" style="background-image:url('${esc(m.backdrop)}')"></div>
      <div class="hero-body">
        <div class="hero-kicker">${icon('sparkles')}Tendance cette semaine</div>
        <h2>${esc(m.title)}</h2>
        <div class="facts">${[m.year, runtime(m.runtime), (m.genres || []).slice(0, 2).join(', ')].filter(Boolean).map(esc).join(' · ')}${m.rating ? ` · <span class="imdb">★ ${Number(m.rating).toFixed(1)}</span>` : ''}</div>
        <p class="ov">${esc(m.overview)}</p>
        <div class="row-flex">
          ${m.fav ? `<button class="btn lg" disabled>${icon('star', 'fill')}Dans vos favoris</button>` : `<button class="btn primary lg" data-hero="fav" data-idx="${i}">${icon('plus')}Ajouter aux favoris</button>`}
          <a class="btn lg" href="#/fiche/${encodeURIComponent(m.key)}">${icon('info')}Détails</a>
        </div>
      </div>
    </div>`).join('') + `<div class="hero-dots">${heroItems.map((_, i) => `<button data-hero="dot" data-idx="${i}" class="${i === 0 ? 'active' : ''}" aria-label="Affiche ${i + 1}"></button>`).join('')}</div>`;
  heroIdx = 0;
  heroTimer = setInterval(() => {
    if (!root.classList.contains('active') || document.hidden) return;
    setHero((heroIdx + 1) % heroItems.length);
  }, 8000);
}

let heroIdx = 0;
function setHero(i) {
  heroIdx = i;
  $$('.hero-slide', root).forEach((s, k) => s.classList.toggle('active', k === i));
  $$('.hero-dots button', root).forEach((s, k) => s.classList.toggle('active', k === i));
}
