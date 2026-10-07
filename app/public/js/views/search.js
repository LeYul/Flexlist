import { api } from '../app.js';
import { $, esc, icon, cardHtml } from '../ui.js';

let root;
let timer = null;
let lastQ = '';
let seq = 0;

const recent = {
  get() { try { return JSON.parse(localStorage.getItem('flexlist.recent') || '[]'); } catch { return []; } },
  add(q) { try { localStorage.setItem('flexlist.recent', JSON.stringify([q, ...this.get().filter((x) => x !== q)].slice(0, 8))); } catch {} },
};

export function mount(el) {
  root = el;
  root.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>Rechercher</h1><p>Tous les films et séries existants — même ceux qui ne sont pas dans les tendances.</p></div></div>
    <div class="search-box">${icon('search')}<input class="input" id="q" type="search" placeholder="Titre de film ou de série… (ex. : Amélie, Dark, Dune 2021)" autocomplete="off" enterkeyhint="search"></div>
    <div id="s-res" style="margin-top:22px"></div>
  </div>`;
  const input = $('#q', root);
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value.trim()), 380);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(input.value.trim(), true); } });
  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-recent]');
    if (r) { input.value = r.dataset.recent; run(r.dataset.recent, true); }
  });
  showRecent();
}

export function show(params) {
  const q = params?.get('q');
  const input = $('#q', root);
  if (q && q !== input.value) { input.value = q; run(q, true); }
  if (window.matchMedia('(hover: hover)').matches) setTimeout(() => input.focus(), 50);
}

function showRecent() {
  const r = recent.get();
  $('#s-res', root).innerHTML = r.length
    ? `<div class="label" style="margin-bottom:10px">Recherches récentes</div><div class="chips" style="flex-wrap:wrap">${r.map((q) => `<button class="chip" data-recent="${esc(q)}">${icon('clock')}${esc(q)}</button>`).join('')}</div>`
    : `<div class="empty"><div class="big">${icon('search')}</div><h3>Que voulez-vous regarder ?</h3><p>Les titres français et originaux sont acceptés.</p></div>`;
}

async function run(q, save = false) {
  if (q === lastQ && !save) return;
  lastQ = q;
  const box = $('#s-res', root);
  if (q.length < 2) return showRecent();
  const my = ++seq;
  box.innerHTML = `<div class="grid">${Array.from({ length: 12 }, () => '<div class="skel" style="aspect-ratio:2/3"></div>').join('')}</div>`;
  try {
    const r = await api(`/search?q=${encodeURIComponent(q)}`);
    if (my !== seq) return;
    if (save) recent.add(q);
    const section = (title, items, ic) => (items.length ? `<h2 class="section" style="margin:6px 0 14px;display:flex;align-items:center;gap:8px">${icon(ic)}${title} <span class="faint small">${items.length}</span></h2><div class="grid" style="margin-bottom:30px">${items.map((it) => cardHtml(it)).join('')}</div>` : '');
    const lib = r.library.map((e) => ({ ...e, key: e.key || `lib:${e.id}`, inLibrary: true }));
    const html = section('Déjà dans NETFLEX', lib, 'library') + section('Films', r.movies, 'film') + section('Séries', r.series, 'tv');
    box.innerHTML = html || `<div class="empty"><div class="big">${icon('search')}</div><h3>Aucun résultat pour « ${esc(q)} »</h3><p>Essayez le titre original ou ajoutez l’année.</p></div>`;
    if (r.errors?.length) box.insertAdjacentHTML('afterbegin', `<div class="banner" style="margin:0 0 16px">${icon('alert')}<div>Une source n’a pas répondu : ${esc(r.errors.join(' · '))}</div></div>`);
  } catch (err) {
    if (my === seq) box.innerHTML = `<div class="empty"><div class="big">${icon('alert')}</div><h3>Recherche impossible</h3><p>${esc(err.message)}</p></div>`;
  }
}
