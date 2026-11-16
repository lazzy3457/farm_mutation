// =============================================================================
// render.js — Affichage : barre du haut, marché, inventaire, grille, menu de case,
// messages temporaires. Aucune règle de jeu ici : on lit l'état et on appelle
// ctx.dispatch(actionPure, params).
//
// Deux rythmes :
//   - renderFrame  : à chaque image (barres de pousse, minuteurs) ;
//   - renderPanels : quand quelque chose change (marché, inventaire, menu).
// =============================================================================

import { getPlant, plantName, parseCellId, cellId } from '../logic/state.js';
import { formatDuration, now } from '../logic/clock.js';
import { growthProgress, matureAt, plantSeed, harvest, harvestAndSell, devMatureCell } from '../logic/grid.js';
import { buySeed, sellCrop, sellValue, inventoryCount, inventoryCapacity } from '../logic/economy.js';

const $ = (id) => document.getElementById(id);

/** Change le texte d'un élément seulement s'il a changé (évite de refaire le DOM). */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/** Échappe le texte inséré dans du HTML. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Emoji + nom d'une plante. */
function plantLabel(ctx, plantId) {
  const plant = getPlant(ctx.config, plantId);
  return `${plant ? plant.emoji : '?'} ${plantName(ctx.state, ctx.config, plantId)}`;
}

/** Affiche un message temporaire. kind : info | success | error | fail */
export function showToast(ctx, message, kind = 'info') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  const ms = (ctx.config ? ctx.config.ui.toastSeconds : 2.5) * 1000;
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// -----------------------------------------------------------------------------
// Initialisation : écouteurs (délégation d'événements, robuste aux redessins).
// -----------------------------------------------------------------------------

export function initRender(ctx) {
  setText($('version'), ctx.config.gameVersion);

  $('grid').addEventListener('click', (e) => {
    const el = e.target.closest('.cell');
    if (el) onCellClick(ctx, el.dataset.id);
  });

  $('market').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-buy]');
    if (b) ctx.dispatch(buySeed, { plantId: b.dataset.buy, qty: Number(b.dataset.qty) });
  });

  $('inventory').addEventListener('click', (e) => {
    const seed = e.target.closest('[data-select]');
    if (seed) {
      ctx.ui.selectedSeed = ctx.ui.selectedSeed === seed.dataset.select ? null : seed.dataset.select;
      ctx.ui.devTargetMode = false;
      ctx.refresh();
      return;
    }
    const sell = e.target.closest('button[data-sell]');
    if (sell) ctx.dispatch(sellCrop, { plantId: sell.dataset.sell, qty: sell.dataset.qty === 'all' ? 'all' : Number(sell.dataset.qty) });
  });

  $('cell-menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-menu]');
    if (!b) return;
    const id = ctx.ui.menuCell;
    if (b.dataset.menu === 'harvest') ctx.dispatch(harvest, { cellId: id });
    if (b.dataset.menu === 'harvestSell') ctx.dispatch(harvestAndSell, { cellId: id });
    if (b.dataset.menu === 'close') { ctx.ui.menuCell = null; ctx.refresh(); }
  });

  // Clic hors de la grille et du menu : ferme le menu.
  document.addEventListener('click', (e) => {
    if (!ctx.ui.menuCell) return;
    if (e.target.closest('#cell-menu') || e.target.closest('.cell')) return;
    ctx.ui.menuCell = null;
    ctx.refresh();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ctx.ui.menuCell = null;
      ctx.ui.selectedSeed = null;
      ctx.ui.devTargetMode = false;
      ctx.refresh();
    }
  });
}

/** Clic sur une case de la grille. */
function onCellClick(ctx, id) {
  const { ui } = ctx;
  const cell = ctx.state.grid.cells[id];

  // Mode dev « mûrir une case ciblée ».
  if (ui.devTargetMode) {
    ui.devTargetMode = false;
    ctx.dispatch(devMatureCell, { cellId: id });
    return;
  }

  // Case vide : planter la graine sélectionnée.
  if (!cell) {
    ui.menuCell = null;
    if (!ui.selectedSeed) {
      ctx.toast('Sélectionne d\'abord une graine dans l\'inventaire', 'info');
      ctx.refresh();
      return;
    }
    ctx.dispatch(plantSeed, { cellId: id, plantId: ui.selectedSeed });
    if (!(ctx.state.inventory.seeds[ui.selectedSeed] > 0)) ui.selectedSeed = null;
    ctx.refresh();
    return;
  }

  // Graine ou plante : ouvrir / fermer le menu de la case.
  ui.menuCell = ui.menuCell === id ? null : id;
  ctx.refresh();
}

// -----------------------------------------------------------------------------
// Grille (à chaque image).
// -----------------------------------------------------------------------------

let builtSize = 0;

/** (Re)construit les cases quand la taille de la grille change. */
function buildGrid(ctx) {
  const n = ctx.state.grid.size;
  const grid = $('grid');
  grid.style.setProperty('--n', n);
  grid.innerHTML = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const el = document.createElement('div');
      el.className = 'cell empty';
      el.dataset.id = cellId(x, y);
      el.innerHTML =
        '<span class="cell-emoji"></span>' +
        '<span class="cell-name"></span>' +
        '<span class="cell-pollen"></span>' +
        '<span class="cell-timer"></span>' +
        '<span class="cell-tag"></span>' +
        '<div class="bar"><div class="fill"></div></div>';
      grid.appendChild(el);
    }
  }
  builtSize = n;
}

/** Met à jour l'affichage de chaque case. */
export function renderFrame(ctx) {
  const { state, config, ui } = ctx;
  if (builtSize !== state.grid.size) buildGrid(ctx);
  const maxPollen = config.pollen.maxCharges;

  for (const el of $('grid').children) {
    const id = el.dataset.id;
    const cell = state.grid.cells[id];
    const parts = el.children;
    const [emoji, name, pollen, timer, tag] = parts;
    const fill = el.querySelector('.fill');

    let cls = 'cell ';
    if (!cell) {
      cls += 'empty';
      setText(emoji, '');
      setText(name, '');
      setText(pollen, '');
      setText(timer, ui.selectedSeed ? '+' : '');
      setText(tag, '');
      fill.style.width = '0%';
      el.style.removeProperty('--plant-color');
    } else {
      const plant = getPlant(config, cell.type);
      el.style.setProperty('--plant-color', plant.color);
      setText(emoji, plant.emoji);
      setText(name, plantName(state, config, cell.type));
      setText(tag, cell.exotic ? '✨' : '');
      if (cell.mature) {
        cls += 'mature';
        setText(pollen, '●'.repeat(cell.pollen) + '○'.repeat(Math.max(0, maxPollen - cell.pollen)));
        setText(timer, '');
        fill.style.width = '100%';
      } else {
        cls += 'growing';
        const p = growthProgress(state, cell);
        setText(pollen, '');
        setText(timer, formatDuration(matureAt(cell) - now(state)));
        fill.style.width = `${(p * 100).toFixed(1)}%`;
      }
    }
    if (ui.menuCell === id) cls += ' menu-open';
    if (ui.devTargetMode && cell && !cell.mature) cls += ' dev-target';
    if (el.className !== cls) el.className = cls;
  }

  // Minuteur du menu ouvert sur une graine.
  const menuTimer = document.querySelector('#cell-menu [data-live="remaining"]');
  if (menuTimer && ui.menuCell && state.grid.cells[ui.menuCell]) {
    setText(menuTimer, formatDuration(matureAt(state.grid.cells[ui.menuCell]) - now(state)));
  }
}

// -----------------------------------------------------------------------------
// Panneaux (quand l'état change).
// -----------------------------------------------------------------------------

let lastSignature = '';

/** Redessine barre du haut, marché, inventaire et menu si quelque chose a changé. */
export function renderPanels(ctx, force) {
  const { state, ui } = ctx;
  if (ui.menuCell && !state.grid.cells[ui.menuCell]) ui.menuCell = null;
  const menuCell = ui.menuCell ? state.grid.cells[ui.menuCell] : null;
  const signature = JSON.stringify([
    state.coins, state.robuxSpentSim, state.grid.size, state.inventory, state.unlockedSeeds,
    state.clock.speed, state.clock.paused, state.discovered, state.settingsOverrides,
    ui.selectedSeed, ui.devTargetMode, ui.menuCell,
    menuCell && [menuCell.type, menuCell.mature, menuCell.pollen]
  ]);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;

  renderTopbar(ctx);
  renderMarket(ctx);
  renderInventory(ctx);
  renderSelectionHint(ctx);
  renderMenu(ctx);
}

function renderTopbar(ctx) {
  const { state } = ctx;
  setText($('coins'), state.coins.toLocaleString('fr-FR'));
  setText($('robux'), state.robuxSpentSim.toLocaleString('fr-FR'));
  setText($('grid-size'), `${state.grid.size}x${state.grid.size}`);
  const status = $('time-status');
  if (state.clock.paused) setText(status, '⏸ Temps en pause');
  else if (state.clock.speed !== 1) setText(status, `⏩ Temps x${state.clock.speed}`);
  else setText(status, '');
}

/** Texte de la condition de déblocage d'une graine. */
function unlockText(ctx, rule) {
  if (rule.type === 'discover') return `Découvre ${plantName(ctx.state, ctx.config, rule.plant)}`;
  if (rule.type === 'gridSize') return `Parcelle ${rule.size}x${rule.size}`;
  return 'Verrouillée';
}

function renderMarket(ctx) {
  const { state, config } = ctx;
  const rows = Object.entries(config.plants)
    .filter(([, p]) => p.isBaseSeed)
    .sort(([, a], [, b]) => a.seedPrice - b.seedPrice)
    .map(([id, p]) => {
      const unlocked = state.unlockedSeeds.includes(id);
      const info = `<span class="row-label">${esc(p.emoji)} ${esc(plantName(state, config, id))}</span>` +
        `<span class="muted small">${p.seedPrice} 🪙 · ${formatDuration(p.growSeconds * 1000)} · vente ${p.sellValue}</span>`;
      if (!unlocked) {
        const rule = config.market.unlocks[id] || { type: 'none' };
        return `<div class="row locked">${info}<span class="small">🔒 ${esc(unlockText(ctx, rule))}</span></div>`;
      }
      return `<div class="row">${info}<span class="row-actions">` +
        `<button type="button" data-buy="${id}" data-qty="1" ${state.coins < p.seedPrice ? 'disabled' : ''}>Acheter</button>` +
        `<button type="button" data-buy="${id}" data-qty="5" ${state.coins < p.seedPrice * 5 ? 'disabled' : ''}>×5</button>` +
        '</span></div>';
    });
  $('market').innerHTML = rows.join('');
}

function renderInventory(ctx) {
  const { state, config, ui } = ctx;
  setText($('slots'), `(${inventoryCount(state)}/${inventoryCapacity(state, config)} emplacements)`);

  const seeds = Object.entries(state.inventory.seeds).map(([id, qty]) =>
    `<button type="button" class="seed-chip ${ui.selectedSeed === id ? 'selected' : ''}" data-select="${id}">` +
    `${esc(plantLabel(ctx, id))} <strong>×${qty}</strong></button>`);

  const crops = Object.entries(state.inventory.crops).map(([id, qty]) =>
    `<div class="row"><span class="row-label">${esc(plantLabel(ctx, id))} <strong>×${qty}</strong></span>` +
    `<span class="muted small">${sellValue(config, id)} 🪙/u</span><span class="row-actions">` +
    `<button type="button" data-sell="${id}" data-qty="1">Vendre 1</button>` +
    `<button type="button" data-sell="${id}" data-qty="all">Tout (${sellValue(config, id) * qty})</button>` +
    '</span></div>');

  $('inventory').innerHTML =
    '<h3>Graines</h3>' + (seeds.length ? `<div class="chips">${seeds.join('')}</div>` : '<p class="muted small">Aucune graine. Achète-en au marché.</p>') +
    '<h3>Récoltes</h3>' + (crops.length ? crops.join('') : '<p class="muted small">Aucune récolte.</p>');
}

function renderSelectionHint(ctx) {
  const { ui, state } = ctx;
  let text = '';
  if (ui.devTargetMode) text = '[DEV] Clique sur une graine en pousse pour la faire mûrir (Échap pour annuler)';
  else if (ui.selectedSeed) text = `Graine sélectionnée : ${plantLabel(ctx, ui.selectedSeed)} (${state.inventory.seeds[ui.selectedSeed] || 0}) — clique sur une case vide. Échap pour annuler.`;
  else text = 'Clique sur une plante mûre pour la récolter ou la vendre.';
  setText($('selection-hint'), text);
}

/** Menu contextuel d'une case (plante mature ou graine en pousse). */
function renderMenu(ctx) {
  const { state, config, ui } = ctx;
  const menu = $('cell-menu');
  const cell = ui.menuCell ? state.grid.cells[ui.menuCell] : null;
  if (!cell) { menu.hidden = true; return; }

  const plant = getPlant(config, cell.type);
  const { x, y } = parseCellId(ui.menuCell);
  let html = `<div class="menu-title">${esc(plantLabel(ctx, cell.type))}</div>` +
    `<div class="muted small">Case (${x},${y}) · palier ${plant.tier}${cell.exotic ? ' · ✨ exotique' : ''}</div>`;
  if (cell.mature) {
    const value = sellValue(config, cell.type);
    html +=
      `<div class="small">Valeur : <strong>${value} 🪙</strong></div>` +
      `<div class="small">Pollen : ${'●'.repeat(cell.pollen)}${'○'.repeat(Math.max(0, config.pollen.maxCharges - cell.pollen))}</div>` +
      '<div class="menu-actions">' +
      '<button type="button" data-menu="harvest">Récolter</button>' +
      `<button type="button" data-menu="harvestSell" class="primary">Récolter et vendre (+${value})</button>` +
      '<button type="button" data-menu="close" class="btn-ghost">Fermer</button></div>';
  } else {
    html +=
      `<div class="small">En pousse : mûre dans <strong data-live="remaining">${formatDuration(matureAt(cell) - now(state))}</strong></div>` +
      `<div class="small muted">Durée totale : ${formatDuration(cell.growMs)} de jeu</div>` +
      '<div class="menu-actions"><button type="button" data-menu="close" class="btn-ghost">Fermer</button></div>';
  }
  menu.innerHTML = html;
  menu.hidden = false;

  // Placement à côté de la case.
  const wrap = $('grid-wrap').getBoundingClientRect();
  const cellEl = document.querySelector(`.cell[data-id="${ui.menuCell}"]`);
  if (!cellEl) return;
  const r = cellEl.getBoundingClientRect();
  const mw = menu.offsetWidth || 220;
  let left = r.right - wrap.left + 8;
  if (left + mw > wrap.width) left = r.left - wrap.left - mw - 8;
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, r.top - wrap.top)}px`;
}
