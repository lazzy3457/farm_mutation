// =============================================================================
// dev-panel.js — Panneau latéral du mode dev (F2 ou ?dev=1).
//
// Chaque triche passe par une action pure explicite de js/logic/, qui marque
// state.dev.used et produit un événement [DEV] dans le journal.
// Étape 1 : sections Temps, Pièces, Journal. Les autres sections arrivent
// aux étapes 2 à 4.
// =============================================================================

import { setSpeed, setPaused, now, formatDuration } from '../logic/clock.js';
import { devAdvance, devMatureAll } from '../logic/grid.js';
import { devAddCoins } from '../logic/economy.js';

const $ = (id) => document.getElementById(id);

/** Affiche / masque le panneau (force = true/false pour imposer l'état). */
export function toggleDevPanel(ctx, force) {
  ctx.ui.devVisible = typeof force === 'boolean' ? force : !ctx.ui.devVisible;
  $('dev-panel').hidden = !ctx.ui.devVisible;
  $('btn-dev').hidden = !ctx.ui.devVisible;
  document.body.classList.toggle('dev-open', ctx.ui.devVisible && !ctx.ui.devCollapsed);
  document.body.classList.toggle('dev-collapsed', ctx.ui.devVisible && ctx.ui.devCollapsed);
  if (!ctx.ui.devVisible) ctx.ui.devTargetMode = false;
  renderDevPanel(ctx, true);
}

/** Construit le panneau une fois. */
export function initDevPanel(ctx) {
  const { config } = ctx;
  const panel = $('dev-panel');

  const speedButtons = config.dev.speedPresets
    .map((s) => `<button type="button" data-speed="${s}">x${s}</button>`).join('');
  const advanceButtons = config.dev.advanceButtonsSeconds
    .map((s) => `<button type="button" data-advance="${s}">+${formatDuration(s * 1000)}</button>`).join('');
  const coinButtons = config.dev.coinButtons
    .map((c) => `<button type="button" data-coins="${c}">+${c.toLocaleString('fr-FR')}</button>`).join('') +
    config.dev.coinButtons
      .map((c) => `<button type="button" data-coins="${-c}">−${c.toLocaleString('fr-FR')}</button>`).join('');

  panel.innerHTML = `
    <div class="dev-header">
      <strong>🛠 Mode dev</strong>
      <span id="dev-cheat-flag" class="small"></span>
      <span class="spacer"></span>
      <button type="button" id="dev-collapse" class="btn-ghost" title="Replier / déplier">⇥</button>
      <button type="button" id="dev-close" class="btn-ghost" title="Fermer (F2)">✕</button>
    </div>
    <div class="dev-body">
      <details open>
        <summary>Temps</summary>
        <div id="dev-time-status" class="small muted"></div>
        <div class="btn-row">${speedButtons}</div>
        <div class="btn-row">
          <input id="dev-speed-input" type="number" min="0.01" step="any" placeholder="Vitesse libre">
          <button type="button" id="dev-speed-apply">Appliquer</button>
        </div>
        <div class="btn-row"><button type="button" id="dev-pause"></button>${advanceButtons}</div>
        <div class="btn-row">
          <button type="button" id="dev-mature-target">Mûrir une case…</button>
          <button type="button" id="dev-mature-all">Mûrir toutes les graines</button>
        </div>
      </details>

      <details open>
        <summary>Pièces</summary>
        <div class="btn-row">${coinButtons}</div>
        <div class="btn-row">
          <input id="dev-coins-input" type="number" step="1" placeholder="Montant">
          <button type="button" id="dev-coins-add">Ajouter</button>
          <button type="button" id="dev-coins-remove">Retirer</button>
        </div>
      </details>

      <details open>
        <summary>Journal d'événements</summary>
        <div class="btn-row">
          <button type="button" id="dev-log-copy">Copier</button>
          <button type="button" id="dev-log-clear">Effacer</button>
        </div>
        <ol id="dev-log" class="log"></ol>
      </details>

      <p class="muted small">À venir : chance et fusions (étape 2), grille et encyclopédie (étape 3), boutique, réglages non tranchés, stats et sauvegardes (étape 4).</p>
    </div>`;

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.speed) return void ctx.dispatch(setSpeed, { speed: Number(b.dataset.speed) });
    if (b.dataset.advance) return void ctx.dispatch(devAdvance, { seconds: Number(b.dataset.advance) });
    if (b.dataset.coins) return void ctx.dispatch(devAddCoins, { amount: Number(b.dataset.coins) });
    switch (b.id) {
      case 'dev-speed-apply':
        ctx.dispatch(setSpeed, { speed: Number($('dev-speed-input').value) });
        break;
      case 'dev-pause':
        ctx.dispatch(setPaused, { paused: !ctx.state.clock.paused });
        break;
      case 'dev-mature-target':
        ctx.ui.devTargetMode = !ctx.ui.devTargetMode;
        ctx.ui.selectedSeed = null;
        ctx.refresh();
        break;
      case 'dev-mature-all':
        ctx.dispatch(devMatureAll, {});
        break;
      case 'dev-coins-add':
        ctx.dispatch(devAddCoins, { amount: Math.abs(Number($('dev-coins-input').value)) });
        break;
      case 'dev-coins-remove':
        ctx.dispatch(devAddCoins, { amount: -Math.abs(Number($('dev-coins-input').value)) });
        break;
      case 'dev-log-copy':
        copyText(ctx, ctx.log.toText());
        break;
      case 'dev-log-clear':
        ctx.log.clear();
        renderDevPanel(ctx, true);
        break;
      case 'dev-collapse':
        ctx.ui.devCollapsed = !ctx.ui.devCollapsed;
        toggleDevPanel(ctx, true);
        break;
      case 'dev-close':
        toggleDevPanel(ctx, false);
        break;
      default:
        break;
    }
  });

  $('btn-dev').addEventListener('click', () => toggleDevPanel(ctx));
}

/** Copie un texte dans le presse-papiers (avec repli si l'API est indisponible). */
function copyText(ctx, text) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ctx.toast('Journal copié', 'info'); } catch { ctx.toast('Copie impossible', 'error'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => ctx.toast('Journal copié', 'info'), fallback);
  } else {
    fallback();
  }
}

let lastLogVersion = -1;
let lastStatus = '';

/** Met à jour les parties dynamiques du panneau. */
export function renderDevPanel(ctx, force) {
  if (!ctx.ui.devVisible) return;
  const { state } = ctx;

  const status = `${state.clock.paused ? '⏸' : '▶'}|${state.clock.speed}|${ctx.ui.devTargetMode}|${state.dev.used}|${Math.floor(now(state) / 1000)}|${Math.floor(state.stats.realPlayMs / 1000)}`;
  if (force || status !== lastStatus) {
    lastStatus = status;
    $('dev-time-status').textContent =
      `Temps de jeu : ${formatDuration(now(state))} · réel joué : ${formatDuration(state.stats.realPlayMs)} · ` +
      `vitesse x${state.clock.speed}${state.clock.paused ? ' · EN PAUSE' : ''}`;
    $('dev-pause').textContent = state.clock.paused ? '▶ Reprendre' : '⏸ Pause';
    $('dev-mature-target').classList.toggle('active', ctx.ui.devTargetMode);
    $('dev-cheat-flag').textContent = state.dev.used ? '· triches utilisées' : '';
    for (const b of document.querySelectorAll('#dev-panel [data-speed]')) {
      b.classList.toggle('active', Number(b.dataset.speed) === state.clock.speed);
    }
  }

  if (force || ctx.log.version !== lastLogVersion) {
    lastLogVersion = ctx.log.version;
    const list = $('dev-log');
    // Plus récent en haut.
    list.innerHTML = '';
    const entries = ctx.log.entries;
    for (let i = entries.length - 1; i >= 0; i--) {
      const li = document.createElement('li');
      li.className = `log-${entries[i].kind}${entries[i].dev ? ' log-dev' : ''}`;
      li.textContent = ctx.log.line(entries[i]);
      list.appendChild(li);
    }
  }
}
