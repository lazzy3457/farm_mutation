// =============================================================================
// storage.js — Sauvegarde dans le localStorage du navigateur.
//
// - clé versionnée (config.save.key, ex. "mutationfarm_save_v1") ;
// - sauvegarde auto toutes les N secondes + à la fermeture / mise en arrière-plan ;
// - détection des sauvegardes incompatibles : on ne plante jamais, on renvoie un
//   statut que l'interface transforme en proposition de remise à zéro.
// (Export/import JSON et snapshots : étape 4.)
// =============================================================================

import { createInitialState } from './logic/state.js';

/** Accès protégé au localStorage (peut être bloqué : navigation privée, etc.). */
function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* rien */ }
}

/**
 * Complète un état chargé avec les champs par défaut manquants (sauvegarde plus
 * ancienne mais compatible). Les valeurs chargées gardent la priorité.
 */
function fillDefaults(defaults, loaded) {
  if (Array.isArray(defaults) || defaults === null || typeof defaults !== 'object') {
    return loaded === undefined ? defaults : loaded;
  }
  const out = { ...defaults };
  if (loaded && typeof loaded === 'object') {
    for (const key of Object.keys(loaded)) {
      out[key] = key in defaults ? fillDefaults(defaults[key], loaded[key]) : loaded[key];
    }
  }
  return out;
}

/** Écrit l'état. Ajoute l'heure réelle (sert à la progression hors ligne). */
export function saveGame(config, state) {
  const toSave = { ...state, lastRealMs: Date.now() };
  return safeSet(config.save.key, JSON.stringify(toSave));
}

/**
 * Lit la sauvegarde. Renvoie { status, state, raw } avec status :
 *   "none"          : aucune sauvegarde
 *   "ok"            : sauvegarde valide (state rempli)
 *   "configChanged" : sauvegarde lisible mais faite avec une autre configVersion
 *   "incompatible"  : saveVersion différente (format de données changé)
 *   "corrupt"       : JSON illisible
 */
export function loadGame(config) {
  const raw = safeGet(config.save.key);
  if (!raw) return { status: 'none', state: null, raw: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'corrupt', state: null, raw }; }
  if (!parsed || typeof parsed !== 'object' || parsed.saveVersion !== config.saveVersion) {
    return { status: 'incompatible', state: null, raw };
  }
  const state = fillDefaults(createInitialState(config), parsed);
  if (parsed.configVersion !== config.configVersion) return { status: 'configChanged', state, raw };
  return { status: 'ok', state, raw };
}

/** Garde une copie de la sauvegarde brute avant une remise à zéro (au cas où). */
export function backupRaw(config, raw) {
  if (raw) safeSet(config.save.backupKey, raw);
}

/** Efface la sauvegarde principale. */
export function clearSave(config) {
  safeRemove(config.save.key);
}

/**
 * Lance la sauvegarde automatique. `getState` renvoie l'état courant.
 * Renvoie une fonction pour arrêter la sauvegarde auto.
 */
export function startAutosave(config, getState) {
  const save = () => { const s = getState(); if (s) saveGame(config, s); };
  const timer = setInterval(save, config.save.autosaveIntervalSeconds * 1000);
  const onHide = () => { if (document.visibilityState === 'hidden') save(); };
  window.addEventListener('beforeunload', save);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    clearInterval(timer);
    window.removeEventListener('beforeunload', save);
    window.removeEventListener('pagehide', save);
    document.removeEventListener('visibilitychange', onHide);
  };
}
