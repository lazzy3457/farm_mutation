// =============================================================================
// economy.js — Pièces, achats au marché, ventes et inventaire.
//
// Inventaire : 1 objet (graine ou récolte) = 1 emplacement.
// Capacité = emplacements de départ (config) + bonus d'encyclopédie.
// =============================================================================

import { cloneState, getPlant, markCheat, errorResult } from './state.js';
import { now } from './clock.js';
import { getActiveBonuses } from './encyclopedia.js';

/** Nombre total d'objets dans l'inventaire (graines + récoltes). */
export function inventoryCount(state) {
  const sum = (bag) => Object.values(bag).reduce((a, b) => a + b, 0);
  return sum(state.inventory.seeds) + sum(state.inventory.crops);
}

/** Capacité de l'inventaire (emplacements). */
export function inventoryCapacity(state, config) {
  return config.start.inventorySlots + getActiveBonuses(state, config).inventorySlots;
}

/** Emplacements libres. */
export function freeSlots(state, config) {
  return inventoryCapacity(state, config) - inventoryCount(state);
}

/** Valeur de vente d'une plante (récolte). */
export function sellValue(config, plantId) {
  const plant = getPlant(config, plantId);
  return plant ? plant.sellValue : 0;
}

/** Ajoute (ou retire si qty < 0) des objets dans un sac de l'inventaire, sur un état cloné. */
export function addToBag(draft, bagName, plantId, qty) {
  const bag = draft.inventory[bagName];
  const next = (bag[plantId] || 0) + qty;
  if (next <= 0) delete bag[plantId];
  else bag[plantId] = next;
}

/** Crédite des Pièces gagnées (vente) sur un état cloné, et met à jour les stats. */
export function earnCoins(draft, amount) {
  draft.coins += amount;
  draft.stats.coinsEarned += amount;
}

/**
 * Acheter des graines au marché.
 * params : { plantId, qty = 1 }
 * Refusé si : graine inconnue ou non débloquée, Pièces insuffisantes, inventaire plein.
 */
export function buySeed(state, config, { plantId, qty = 1 }) {
  const at = now(state);
  const plant = getPlant(config, plantId);
  if (!plant || !plant.isBaseSeed) return errorResult(state, 'Graine introuvable au marché', at);
  if (!state.unlockedSeeds.includes(plantId)) return errorResult(state, `${plant.name} n'est pas encore débloquée`, at);
  const count = Math.max(1, Math.floor(qty));
  const cost = plant.seedPrice * count;
  if (state.coins < cost) return errorResult(state, `Pas assez de Pièces (${cost} nécessaires)`, at);
  if (freeSlots(state, config) < count) return errorResult(state, 'Inventaire plein', at);

  const draft = cloneState(state);
  draft.coins -= cost;
  draft.stats.coinsSpent += cost;
  addToBag(draft, 'seeds', plantId, count);
  return { state: draft, events: [{ type: 'bought', at, plantId, qty: count, cost }] };
}

/**
 * Vendre des récoltes depuis l'inventaire.
 * params : { plantId, qty = 1 } (qty = 'all' pour tout vendre)
 */
export function sellCrop(state, config, { plantId, qty = 1 }) {
  const at = now(state);
  const owned = state.inventory.crops[plantId] || 0;
  const count = qty === 'all' ? owned : Math.floor(qty);
  if (count <= 0 || owned < count) return errorResult(state, 'Rien à vendre', at);

  const draft = cloneState(state);
  const gain = sellValue(config, plantId) * count;
  addToBag(draft, 'crops', plantId, -count);
  earnCoins(draft, gain);
  draft.stats.sold += count;
  return { state: draft, events: [{ type: 'sold', at, plantId, qty: count, coins: gain }] };
}

/**
 * [DEV] Ajoute ou retire des Pièces (montant négatif = retrait, plancher à 0).
 * Les Pièces données par le dev ne comptent pas dans « Pièces gagnées ».
 */
export function devAddCoins(state, config, { amount }) {
  const value = Math.floor(Number(amount));
  if (!Number.isFinite(value) || value === 0) return errorResult(state, 'Montant invalide', now(state));
  const draft = cloneState(state);
  draft.coins = Math.max(0, draft.coins + value);
  markCheat(draft, 'pieces');
  return {
    state: draft,
    events: [{ type: 'dev', at: now(draft), dev: true, message: `${value > 0 ? '+' : ''}${value} Pièces` }]
  };
}
