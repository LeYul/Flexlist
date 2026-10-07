import { api, bus, store, refreshState } from '../app.js';
import { $, $$, esc, icon, toast, ago, LANG_LABEL, QUALITY_LABEL, SEASONS_LABEL } from '../ui.js';

let root;
let conf = null;

export function mount(el) {
  root = el;
  root.innerHTML = `<div class="page"><div class="page-head"><div class="grow"><h1>Réglages</h1><p>Connexion au NAS, préférences et maintenance.</p></div></div><div class="settings" id="st"></div></div>`;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  bus.addEventListener('state', () => { if (root.classList.contains('active')) renderTasks(); });
  bus.addEventListener('installable', () => { if (conf) renderInstall(); });
}

export async function show() {
  try {
    conf = await api('/settings');
    store.defaults = conf.defaults;
    render();
    refreshState();
  } catch (err) {
    $('#st', root).innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function svcHtml(id, name, c, hint) {
  return `<div class="svc" data-svc="${id}">
    <div class="svc-head"><span class="status-dot ${c.hasKey && c.url ? 'on' : 'off'}" data-dot></span>${name}<span class="ver" data-ver>${c.hasKey && c.url ? 'Configuré' : 'Non configuré'}</span></div>
    <div class="two">
      <div class="field"><label>Adresse</label><input class="input" data-k="url" value="${esc(c.url)}" placeholder="${hint}" inputmode="url" autocomplete="off"></div>
      <div class="field"><label>Clé API</label><input class="input" data-k="apiKey" type="password" value="${esc(c.apiKey)}" placeholder="Réglages › Général › Clé API" autocomplete="off"></div>
    </div>
    <div class="field" data-roots ${c.rootFolder ? '' : 'hidden'}><label>Dossier de destination</label><select class="input" data-k="rootFolder"><option value="${esc(c.rootFolder)}">${esc(c.rootFolder || 'Automatique (dossier NETFLEX)')}</option></select></div>
    <div class="row-flex">
      <button class="btn sm" data-act="test">${icon('server')}Tester la connexion</button>
      <button class="btn sm primary" data-act="save-svc">${icon('check')}Enregistrer</button>
      <label class="toggle small" style="margin-left:auto"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''}><span class="track"></span>Actif</label>
    </div>
    <div class="small muted" data-msg style="margin-top:10px"></div>
  </div>`;
}

function segHtml(name, options, value) {
  return `<div class="seg ${Object.keys(options).length > 3 ? 'wrap' : ''}" data-def="${name}">${Object.entries(options).map(([k, v]) => `<button type="button" data-v="${k}" class="${k === value ? 'active' : ''}">${esc(v)}</button>`).join('')}</div>`;
}

function render() {
  const d = conf.defaults;
  let user = '';
  try { user = localStorage.getItem('flexlist.user') || ''; } catch {}
  $('#st', root).innerHTML = `
    <section class="panel span">
      <h2>${icon('server')}Connexion au NAS</h2>
      <p>Chaque favori est envoyé à <b>Radarr</b> (films) ou <b>Sonarr</b> (séries), installés sur le NAS, qui cherchent et téléchargent les fichiers puis les rangent dans NETFLEX. La clé API se trouve dans chaque application, menu <i>Settings › General › Security</i>.</p>
      <div class="two" style="gap:12px">
        ${svcHtml('radarr', 'Radarr — films', conf.radarr, 'http://192.168.1.54:17878')}
        ${svcHtml('sonarr', 'Sonarr — séries', conf.sonarr, 'http://192.168.1.54:18989')}
      </div>
    </section>

    <section class="panel">
      <h2>${icon('sliders')}Préférences par défaut</h2>
      <p>Pré-sélectionnées à chaque ajout ; la question vous est posée pour chaque favori.</p>
      <div class="field"><span class="label">Langue</span>${segHtml('lang', LANG_LABEL, d.lang)}</div>
      <div class="field"><span class="label">Qualité</span>${segHtml('quality', QUALITY_LABEL, d.quality)}</div>
      <div class="field"><span class="label">Saisons (séries)</span>${segHtml('seasons', SEASONS_LABEL, d.seasons)}</div>
      <label class="toggle"><input type="checkbox" data-def-check="searchNow" ${d.searchNow ? 'checked' : ''}><span class="track"></span>Lancer la recherche dès l’ajout</label>
    </section>

    <section class="panel">
      <h2>${icon('clock')}Automatismes</h2>
      <p>Les titres introuvables avec vos critères sont recherchés à nouveau régulièrement, jusqu’à leur arrivée dans NETFLEX.</p>
      <div class="field"><label>Relancer la recherche des introuvables toutes les</label>
        <select class="input" data-num="searchIntervalHours">${[1, 3, 6, 12, 24, 48].map((h) => `<option value="${h}" ${Number(conf.searchIntervalHours) === h ? 'selected' : ''}>${h} heure${h > 1 ? 's' : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Relire la vidéothèque NETFLEX toutes les</label>
        <select class="input" data-num="libraryScanMinutes">${[10, 15, 30, 60, 180].map((m) => `<option value="${m}" ${Number(conf.libraryScanMinutes) === m ? 'selected' : ''}>${m < 60 ? `${m} minutes` : `${m / 60} heure${m > 60 ? 's' : ''}`}</option>`).join('')}</select></div>
      <div class="field"><label>Mettre à jour les films populaires toutes les</label>
        <select class="input" data-num="catalogRefreshHours">${[6, 12, 24, 48].map((h) => `<option value="${h}" ${Number(conf.catalogRefreshHours) === h ? 'selected' : ''}>${h} heures</option>`).join('')}</select></div>
    </section>

    <section class="panel span">
      <h2>${icon('database')}Vidéothèque et base de données</h2>
      <p>Dossier lu (en lecture seule) : <code>${esc(conf.libraryPath)}</code></p>
      <div id="st-tasks"></div>
    </section>

    <section class="panel">
      <h2>${icon('user')}Sur cet appareil</h2>
      <p>Votre prénom apparaît à côté des favoris que vous ajoutez (pratique à plusieurs).</p>
      <div class="field"><label>Prénom</label><input class="input" id="st-user" value="${esc(user)}" placeholder="Ex. : Yul" maxlength="30"></div>
    </section>

    <section class="panel">
      <h2>${icon('lock')}Accès</h2>
      <p>${conf.passwordSet ? 'Un mot de passe protège l’application.' : 'Aucun mot de passe : toute personne du réseau local peut ouvrir l’application.'}</p>
      <div class="field"><label>${conf.passwordSet ? 'Nouveau mot de passe' : 'Définir un mot de passe'}</label><input class="input" id="st-pw" type="password" autocomplete="new-password" placeholder="Laisser vide pour ne rien changer"></div>
      <div class="row-flex">
        <button class="btn sm primary" data-act="pw">${icon('lock')}Enregistrer</button>
        ${conf.passwordSet ? `<button class="btn sm ghost danger" data-act="pw-off">Supprimer le mot de passe</button><button class="btn sm ghost" data-act="logout">${icon('logout')}Se déconnecter</button>` : ''}
      </div>
    </section>

    <section class="panel span" id="st-install"></section>`;
  renderTasks();
  renderInstall();
}

function renderTasks() {
  const s = store.state;
  const box = $('#st-tasks', root);
  if (!s || !box) return;
  const rows = [
    ['scan', 'Vidéothèque NETFLEX', `${s.library.movies.toLocaleString('fr-FR')} films · ${s.library.series} séries${s.library.error ? ` — ⚠ ${s.library.error}` : ''}`],
    ['identify', 'Identification des titres', 'Associe chaque dossier à sa fiche (affiche, genres)'],
    ['movies', 'Films populaires', `${s.catalog.movies.toLocaleString('fr-FR')} fiches en base`],
    ['trending', 'Séries du moment', 'Programmes des 7 derniers jours'],
    ['crawl', 'Index des séries populaires', `${s.catalog.series.toLocaleString('fr-FR')} séries en base · hebdomadaire`],
    ['sync', 'Suivi des favoris', `${s.favorites.total} favori(s) · ${s.favorites.notfound} introuvable(s)`],
  ];
  box.innerHTML = rows.map(([k, label, detail]) => {
    const t = s.tasks[k];
    const state = t.running ? `${icon('loader', 'spin')} ${esc(t.progress || 'en cours…')}` : t.error ? `<span style="color:var(--danger)">${esc(t.error)}</span>` : `mis à jour ${ago(t.last)}`;
    return `<div class="kv"><div><b>${label}</b><div class="small faint">${esc(detail)}</div></div><div class="small muted" style="text-align:right">${state}</div><button class="btn sm" data-task="${k}" ${t.running ? 'disabled' : ''} aria-label="Lancer maintenant">${icon('refresh')}</button></div>`;
  }).join('');
}

function renderInstall() {
  const box = $('#st-install', root);
  if (!box) return;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  box.innerHTML = `
    <h2>${icon('phone')}Installer l’application</h2>
    <p>${standalone ? 'Flexlist est installée sur cet appareil ✓' : 'Flexlist s’installe comme une vraie application sur téléphone, tablette et ordinateur — sans passer par un store.'}</p>
    ${store.installPrompt ? `<button class="btn primary" data-act="install" style="margin-bottom:16px">${icon('download')}Installer Flexlist</button>` : ''}
    <div class="two" style="gap:16px">
      <div class="install-steps">
        <div><span class="n">${icon('phone')}</span><span><b>iPhone / iPad (Safari)</b><br>Bouton Partager <b>⎙</b> › « Sur l’écran d’accueil ».</span></div>
        <div><span class="n">${icon('phone')}</span><span><b>Android (Chrome)</b><br>Menu <b>⋮</b> › « Installer l’application » ou « Ajouter à l’écran d’accueil ».</span></div>
      </div>
      <div class="install-steps">
        <div><span class="n">${icon('server')}</span><span><b>Ordinateur (Chrome / Edge)</b><br>Icône d’installation dans la barre d’adresse, ou menu › « Installer Flexlist ».</span></div>
        <div><span class="n">${icon('info')}</span><span>${ios ? 'Sur iOS, l’ajout à l’écran d’accueil fonctionne directement.' : 'L’installation complète sur Android et ordinateur demande une adresse HTTPS (voir le guide fourni) ; sinon, le raccourci d’écran d’accueil fonctionne.'}</span></div>
      </div>
    </div>
    <p class="small faint" style="margin:16px 0 0">Flexlist v${esc(store.state?.version || '')} — application privée, hébergée sur votre NAS.</p>`;
}

function readSvc(id) {
  const box = $(`[data-svc="${id}"]`, root);
  return {
    url: $('[data-k=url]', box).value.trim(),
    apiKey: $('[data-k=apiKey]', box).value.trim(),
    rootFolder: $('[data-k=rootFolder]', box).value,
    enabled: $('[data-k=enabled]', box).checked,
  };
}

async function onClick(e) {
  const seg = e.target.closest('[data-def] button');
  if (seg) {
    const name = seg.parentNode.dataset.def;
    $$('button', seg.parentNode).forEach((b) => b.classList.toggle('active', b === seg));
    await save({ defaults: { [name]: seg.dataset.v } }, 'Préférence enregistrée');
    return;
  }
  const task = e.target.closest('[data-task]');
  if (task) {
    task.disabled = true;
    await api(`/tasks/${task.dataset.task}`, { method: 'POST' }).catch((err) => toast(err.message, { type: 'err' }));
    setTimeout(refreshState, 600);
    return;
  }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const svcBox = b.closest('[data-svc]');
  try {
    if (act === 'test') {
      const id = svcBox.dataset.svc;
      const v = readSvc(id);
      const msg = $('[data-msg]', svcBox);
      msg.innerHTML = `${icon('loader', 'spin')} Test en cours…`;
      b.disabled = true;
      try {
        const r = await api('/settings/test', { method: 'POST', body: { service: id, url: v.url, apiKey: v.apiKey } });
        $('[data-dot]', svcBox).className = 'status-dot on';
        $('[data-ver]', svcBox).textContent = `${r.app} ${r.version}`;
        const sel = $('[data-k=rootFolder]', svcBox);
        sel.innerHTML = `<option value="">Automatique (dossier NETFLEX)</option>${r.rootFolders.map((f) => `<option value="${esc(f.path)}" ${f.path === v.rootFolder ? 'selected' : ''} ${f.accessible ? '' : 'disabled'}>${esc(f.path)}${f.accessible ? '' : ' (inaccessible)'}</option>`).join('')}`;
        $('[data-roots]', svcBox).hidden = false;
        msg.innerHTML = `<span style="color:var(--ok)">✓ Connexion réussie.</span> ${r.profiles.length} profils de qualité. Pensez à enregistrer.`;
      } catch (err) {
        $('[data-dot]', svcBox).className = 'status-dot off';
        msg.innerHTML = `<span style="color:var(--danger)">✗ ${esc(err.message)}</span>`;
      } finally {
        b.disabled = false;
      }
    } else if (act === 'save-svc') {
      const id = svcBox.dataset.svc;
      await save({ [id]: readSvc(id) }, `${id === 'radarr' ? 'Radarr' : 'Sonarr'} enregistré`);
      api('/favorites/sync', { method: 'POST' }).catch(() => {});
      render();
    } else if (act === 'pw') {
      const pw = $('#st-pw', root).value;
      if (!pw) return toast('Saisissez un mot de passe', { type: 'err' });
      await save({ password: pw }, 'Mot de passe enregistré');
      render();
    } else if (act === 'pw-off') {
      await save({ password: '' }, 'Mot de passe supprimé');
      render();
    } else if (act === 'logout') {
      await api('/logout', { method: 'POST' });
      location.reload();
    } else if (act === 'install' && store.installPrompt) {
      store.installPrompt.prompt();
      await store.installPrompt.userChoice;
      store.installPrompt = null;
      renderInstall();
    }
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.dataset.num) await save({ [t.dataset.num]: Number(t.value) }, 'Réglage enregistré');
  else if (t.dataset.defCheck) await save({ defaults: { [t.dataset.defCheck]: t.checked } }, 'Préférence enregistrée');
  else if (t.id === 'st-user') {
    try { localStorage.setItem('flexlist.user', t.value.trim()); } catch {}
    store.user = t.value.trim();
    toast('Prénom enregistré sur cet appareil');
  }
}

async function save(patch, msg) {
  conf = { ...(await api('/settings', { method: 'PUT', body: patch })) };
  store.defaults = conf.defaults;
  if (msg) toast(msg);
}
