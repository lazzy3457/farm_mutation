// =============================================================================
// main.js — Point d'entrée : charge la config, la sauvegarde, lance la boucle
// de jeu et relie l'interface à la logique pure.
//
// Toute modification de l'état passe par dispatch(action, params), où `action`
// est une fonction pure de js/logic/ qui renvoie { state, events }.
// =============================================================================

import { createInitialState } from './logic/state.js';
import { tick, applyOffline } from './logic/grid.js';
import { loadGame, saveGame, clearSave, backupRaw, startAutosave } from './storage.js';
import { createLog } from './ui/log.js';
import { initRender, renderFrame, renderPanels, showToast } from './ui/render.js';
import { initDevPanel, renderDevPanel, toggleDevPanel } from './ui/dev-panel.js';

// Au-delà de ce délai réel entre deux images (onglet en arrière-plan), l'excédent
// est traité comme du hors ligne (vitesse x1), pas au multiplicateur dev.
const MAX_FRAME_REAL_MS = 1000;

/** Contexte partagé entre les modules d'interface. */
const ctx = {
  config: null,
  state: null,
  log: null,
  // État d'interface (non sauvegardé).
  ui: { selectedSeed: null, menuCell: null, devTargetMode: false, devVisible: false, devCollapsed: false },
  dispatch,
  toast: (msg, kind) => showToast(ctx, msg, kind),
  refresh: () => { renderPanels(ctx, true); renderDevPanel(ctx, true); }
};

/**
 * Applique une action pure et traite ses événements (journal + messages).
 * Renvoie la liste des événements.
 */
function dispatch(action, params, { quiet = false } = {}) {
  const result = action(ctx.state, ctx.config, params);
  ctx.state = result.state;
  if (result.events.length) {
    ctx.log.add(result.events, ctx.state);
    if (!quiet) {
      for (const ev of result.events) {
        if (ev.type === 'error') ctx.toast(ev.message, 'error');
      }
    }
    ctx.refresh();
  }
  return result.events;
}

/** Fenêtre de choix simple (remplace confirm(), qui bloque la page). */
export function askChoice(message, buttons) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    document.getElementById('modal-text').textContent = message;
    const box = document.getElementById('modal-buttons');
    box.innerHTML = '';
    for (const { label, value, primary } of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = () => { modal.hidden = true; resolve(value); };
      box.appendChild(b);
    }
    modal.hidden = false;
  });
}

/** Charge la config. Affiche une erreur claire si la page est ouverte sans serveur. */
async function loadConfig() {
  const res = await fetch('config/game-config.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Charge la sauvegarde ou propose une remise à zéro si elle est incompatible. */
async function loadOrCreateState(config) {
  const loaded = loadGame(config);
  if (loaded.status === 'ok') return loaded.state;
  if (loaded.status === 'none') return createInitialState(config);

  if (loaded.status === 'configChanged') {
    const choice = await askChoice(
      'La configuration du jeu a changé depuis ta dernière sauvegarde (configVersion différente). ' +
      'Tu peux continuer avec ta partie (les nouvelles valeurs s\'appliqueront) ou recommencer à zéro.',
      [{ label: 'Continuer ma partie', value: 'keep', primary: true }, { label: 'Recommencer à zéro', value: 'reset' }]
    );
    if (choice === 'keep') {
      return { ...loaded.state, configVersion: config.configVersion };
    }
  } else {
    await askChoice(
      loaded.status === 'corrupt'
        ? 'La sauvegarde est illisible. Une copie de secours est gardée et une nouvelle partie va commencer.'
        : 'Ta sauvegarde vient d\'une version incompatible du prototype. Une copie de secours est gardée et une nouvelle partie va commencer.',
      [{ label: 'Recommencer à zéro', value: 'reset', primary: true }]
    );
  }
  backupRaw(config, loaded.raw);
  clearSave(config);
  return createInitialState(config);
}

/** Boucle de jeu : mesure le temps réel écoulé et fait avancer la logique. */
function startLoop() {
  let last = performance.now();
  let lastPanels = 0;
  const frame = (t) => {
    const realMs = Math.max(0, t - last);
    last = t;
    const inFrame = Math.min(realMs, MAX_FRAME_REAL_MS);
    dispatch(tick, inFrame, { quiet: true });
    if (realMs > MAX_FRAME_REAL_MS) dispatch(applyOffline, realMs - MAX_FRAME_REAL_MS, { quiet: true });
    renderFrame(ctx);
    if (t - lastPanels >= ctx.config.ui.panelRefreshMs) {
      lastPanels = t;
      renderPanels(ctx, false);
      renderDevPanel(ctx, false);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    ctx.config = await loadConfig();
  } catch (err) {
    document.body.innerHTML =
      '<div class="fatal"><h1>Impossible de charger la configuration</h1>' +
      '<p>Le jeu doit être servi par un petit serveur web (les modules ES ne marchent pas en ouvrant le fichier directement).</p>' +
      '<p>Dans le dossier du jeu : <code>npx serve</code> ou <code>python -m http.server</code>, puis ouvre l\'adresse indiquée.</p>' +
      `<p class="muted">Détail : ${String(err.message || err)}</p></div>`;
    return;
  }

  ctx.log = createLog(ctx.config);
  let state = await loadOrCreateState(ctx.config);
  ctx.state = state;

  // Progression hors ligne depuis la dernière sauvegarde.
  if (state.lastRealMs) {
    const events = dispatch(applyOffline, Date.now() - state.lastRealMs, { quiet: true });
    const off = events.find((e) => e.type === 'offline');
    const matured = events.filter((e) => e.type === 'matured').length;
    if (off && off.realMs > 5000) {
      ctx.toast(`Bon retour ! ${matured} plante(s) ont mûri pendant ton absence.`, 'info');
    }
  }
  saveGame(ctx.config, ctx.state);

  initRender(ctx);
  initDevPanel(ctx);
  const params = new URLSearchParams(location.search);
  if (params.get('dev') === '1') toggleDevPanel(ctx, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); toggleDevPanel(ctx); }
  });

  startAutosave(ctx.config, () => ctx.state);
  ctx.refresh();
  startLoop();
}

boot();
