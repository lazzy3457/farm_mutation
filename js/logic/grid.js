// =============================================================================
// grid.js — Grille, plantation, pousse, maturation et récolte.
//
// Une case vide n'existe pas dans state.grid.cells. Une case occupée vaut :
// {
//   type,          // id de la plante (clé de config.plants)
//   plantedAt,     // heure de jeu de plantation (ms)
//   growMs,        // durée de pousse calculée à la plantation (ms de jeu)
//   mature,        // false = graine qui pousse, true = plante mature
//   maturedAt,     // heure de jeu de maturation (ou null)
//   pollen,        // charges de pollen (0 tant que la plante n'est pas mature)
//   partner,       // étape 2 : id de la case partenaire choisie
//   partnerLost,   // étape 2 : le partenaire a disparu ou est épuisé
//   guaranteed,    // étape 2 : fusion garantie achetée pour cette graine
//   exotic         // étape 4 : tag visuel « Graine Exotique »
// }
// =============================================================================

import { cloneState, getPlant, isInGrid, markCheat, errorResult } from './state.js';
import { now, realToGameMs } from './clock.js';
import { getActiveBonuses, discoverPlant } from './encyclopedia.js';
import { addToBag, freeSlots, sellValue, earnCoins } from './economy.js';

/**
 * Durée de pousse (ms de jeu) d'une plante pour l'état actuel :
 *   durée = growSeconds × (1 − réduction Arrosoir Automatique) / (1 + bonus de vitesse encyclopédie)
 * Calculée une seule fois, au moment de planter.
 */
export function computeGrowMs(state, config, plantId) {
  const plant = getPlant(config, plantId);
  const baseMs = plant.growSeconds * 1000;
  const autoWater = config.robuxShop.gamePasses.autoWater;
  const reduction = state.passes.autoWater ? autoWater.effect.value : 0;
  const speedBonus = getActiveBonuses(state, config).growSpeed;
  return Math.round((baseMs * (1 - reduction)) / (1 + speedBonus));
}

/** Heure de jeu à laquelle une graine sera mature. */
export function matureAt(cell) {
  return cell.plantedAt + cell.growMs;
}

/** Progression de pousse entre 0 et 1. */
export function growthProgress(state, cell) {
  if (cell.mature) return 1;
  if (cell.growMs <= 0) return 1;
  return Math.min(1, Math.max(0, (now(state) - cell.plantedAt) / cell.growMs));
}

/**
 * Planter la graine sélectionnée sur une case vide.
 * params : { cellId, plantId }
 */
export function plantSeed(state, config, { cellId, plantId }) {
  const at = now(state);
  if (!isInGrid(cellId, state.grid.size)) return errorResult(state, 'Case hors de la grille', at);
  if (state.grid.cells[cellId]) return errorResult(state, 'Case déjà occupée', at);
  const plant = getPlant(config, plantId);
  if (!plant || !plant.growSeconds) return errorResult(state, 'Cette plante ne se plante pas', at);
  if (!(state.inventory.seeds[plantId] > 0)) return errorResult(state, 'Aucune graine de ce type dans l\'inventaire', at);

  const draft = cloneState(state);
  addToBag(draft, 'seeds', plantId, -1);
  const exotic = draft.exoticCharges > 0;
  if (exotic) draft.exoticCharges -= 1;
  draft.grid.cells[cellId] = {
    type: plantId,
    plantedAt: at,
    growMs: computeGrowMs(draft, config, plantId),
    mature: false,
    maturedAt: null,
    pollen: 0,
    partner: null,
    partnerLost: false,
    guaranteed: false,
    exotic
  };
  return { state: draft, events: [{ type: 'planted', at, cellId, plantId, growMs: draft.grid.cells[cellId].growMs }] };
}

/**
 * Fait mûrir une case (sur un état DÉJÀ cloné) à l'heure `at`.
 * C'est l'unique point de maturation : l'étape 2 y branchera la tentative de fusion.
 */
function matureCell(draft, config, id, at, events, isDev) {
  const cell = draft.grid.cells[id];
  cell.mature = true;
  cell.maturedAt = at;
  cell.pollen = config.pollen.maxCharges;
  events.push({ type: 'matured', at, cellId: id, plantId: cell.type, dev: isDev || undefined });
  discoverPlant(draft, config, cell.type, at, events);
  // ÉTAPE 2 : déclenchement de la tentative de fusion (cette plante = B).
}

/**
 * Avance le temps de jeu de `gameMs` sur un état DÉJÀ cloné.
 * Les maturations sont traitées une par une, dans l'ordre chronologique :
 * l'horloge est placée à l'heure exacte de chaque maturation avant de la traiter
 * (important pour les fusions et la progression hors ligne).
 */
function advanceDraft(draft, config, gameMs, events) {
  const target = draft.clock.gameTimeMs + Math.max(0, gameMs);
  for (;;) {
    // Graine qui mûrit le plus tôt avant la cible (départage par id pour être déterministe).
    let nextId = null;
    let nextAt = Infinity;
    for (const [id, cell] of Object.entries(draft.grid.cells)) {
      if (cell.mature) continue;
      const t = matureAt(cell);
      if (t <= target && (t < nextAt || (t === nextAt && id < nextId))) {
        nextId = id;
        nextAt = t;
      }
    }
    if (nextId === null) break;
    draft.clock.gameTimeMs = Math.max(draft.clock.gameTimeMs, nextAt);
    matureCell(draft, config, nextId, nextAt, events, false);
  }
  draft.clock.gameTimeMs = target;
  draft.stats.gamePlayMs += Math.max(0, gameMs);
}

/**
 * Avance du temps de jeu pur (utilisé par tick, l'avance dev et le hors ligne).
 * params : gameMs (durée de jeu)
 */
export function advanceTime(state, config, gameMs) {
  const draft = cloneState(state);
  const events = [];
  advanceDraft(draft, config, gameMs, events);
  return { state: draft, events };
}

/**
 * Tick de la boucle de jeu : `realMs` de temps réel se sont écoulées.
 * Le multiplicateur de vitesse et la pause sont appliqués par realToGameMs.
 */
export function tick(state, config, realMs) {
  const draft = cloneState(state);
  const events = [];
  draft.stats.realPlayMs += Math.max(0, realMs);
  advanceDraft(draft, config, realToGameMs(draft.clock, realMs), events);
  return { state: draft, events };
}

/**
 * Progression hors ligne au rechargement : le temps réel écoulé depuis la
 * dernière sauvegarde est appliqué à vitesse x1, plafonné par la config.
 * Rien n'avance si le temps était en pause.
 */
export function applyOffline(state, config, realMs) {
  if (!config.offline.enabled || state.clock.paused || !(realMs > 0)) return { state, events: [] };
  const capped = Math.min(realMs, config.offline.maxHours * 3600 * 1000);
  const draft = cloneState(state);
  const events = [{ type: 'offline', at: now(draft), realMs: capped }];
  advanceDraft(draft, config, capped, events);
  return { state: draft, events };
}

/**
 * Retire une plante de la grille (sur un état cloné). Les graines qui l'avaient
 * choisie comme partenaire sont signalées (utilisé à l'étape 2).
 */
function removeCell(draft, id) {
  delete draft.grid.cells[id];
  for (const cell of Object.values(draft.grid.cells)) {
    if (cell.partner === id) {
      cell.partner = null;
      cell.partnerLost = true;
    }
  }
}

/**
 * Récolter une plante mature : elle part dans l'inventaire (1 emplacement).
 * params : { cellId }
 */
export function harvest(state, config, { cellId }) {
  const at = now(state);
  const cell = state.grid.cells[cellId];
  if (!cell || !cell.mature) return errorResult(state, 'Rien à récolter ici', at);
  if (freeSlots(state, config) < 1) return errorResult(state, 'Inventaire plein : vends ou utilise « Récolter et vendre »', at);

  const draft = cloneState(state);
  removeCell(draft, cellId);
  addToBag(draft, 'crops', cell.type, 1);
  draft.stats.harvested += 1;
  return { state: draft, events: [{ type: 'harvested', at, cellId, plantId: cell.type }] };
}

/**
 * Récolter et vendre directement (ne passe pas par l'inventaire).
 * params : { cellId }
 */
export function harvestAndSell(state, config, { cellId }) {
  const at = now(state);
  const cell = state.grid.cells[cellId];
  if (!cell || !cell.mature) return errorResult(state, 'Rien à récolter ici', at);

  const draft = cloneState(state);
  const gain = sellValue(config, cell.type);
  removeCell(draft, cellId);
  earnCoins(draft, gain);
  draft.stats.harvested += 1;
  draft.stats.sold += 1;
  return {
    state: draft,
    events: [
      { type: 'harvested', at, cellId, plantId: cell.type },
      { type: 'sold', at, plantId: cell.type, qty: 1, coins: gain }
    ]
  };
}

/** [DEV] Fait mûrir immédiatement une graine ciblée. params : { cellId } */
export function devMatureCell(state, config, { cellId }) {
  const at = now(state);
  const cell = state.grid.cells[cellId];
  if (!cell || cell.mature) return errorResult(state, 'Cette case ne contient pas de graine en pousse', at);
  const draft = cloneState(state);
  const events = [{ type: 'dev', at, dev: true, message: `Maturation forcée de la case ${cellId}` }];
  markCheat(draft, 'murir');
  matureCell(draft, config, cellId, at, events, true);
  return { state: draft, events };
}

/** [DEV] Fait mûrir immédiatement toutes les graines en pousse (dans l'ordre de maturation prévu). */
export function devMatureAll(state, config) {
  const at = now(state);
  const growing = Object.entries(state.grid.cells)
    .filter(([, c]) => !c.mature)
    .sort(([ia, a], [ib, b]) => matureAt(a) - matureAt(b) || (ia < ib ? -1 : 1))
    .map(([id]) => id);
  if (growing.length === 0) return errorResult(state, 'Aucune graine en pousse', at);
  const draft = cloneState(state);
  const events = [{ type: 'dev', at, dev: true, message: `Maturation forcée de ${growing.length} graine(s)` }];
  markCheat(draft, 'murir');
  for (const id of growing) {
    if (draft.grid.cells[id] && !draft.grid.cells[id].mature) matureCell(draft, config, id, at, events, true);
  }
  return { state: draft, events };
}

/** [DEV] Avance le temps de jeu d'un nombre de secondes. params : { seconds } */
export function devAdvance(state, config, { seconds }) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return errorResult(state, 'Durée invalide', now(state));
  const draft = cloneState(state);
  const events = [{ type: 'dev', at: now(draft), dev: true, message: `Avance du temps de ${value} s` }];
  markCheat(draft, 'avance');
  advanceDraft(draft, config, value * 1000, events);
  return { state: draft, events };
}
