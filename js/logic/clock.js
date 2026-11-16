// =============================================================================
// clock.js — Horloge du jeu.
//
// RÈGLE : toute la logique lit l'heure via now(state). Jamais Date.now().
// Le temps de jeu avance par realToGameMs(), qui applique le multiplicateur
// de vitesse du mode dev et la pause. La boucle d'affichage (main.js) mesure
// le temps réel écoulé et le transmet à la logique (grid.tick).
// =============================================================================

import { cloneState, markCheat } from './state.js';

/** Heure actuelle du jeu, en millisecondes de jeu depuis le début de la partie. */
export function now(state) {
  return state.clock.gameTimeMs;
}

/** Convertit une durée réelle (ms) en durée de jeu, selon la vitesse et la pause. */
export function realToGameMs(clock, realMs) {
  if (clock.paused || realMs <= 0) return 0;
  return realMs * clock.speed;
}

/**
 * [DEV] Change le multiplicateur de vitesse du temps (x1 = normal).
 * Toute vitesse différente de x1 compte comme une triche.
 */
export function setSpeed(state, config, { speed }) {
  const value = Number(speed);
  if (!Number.isFinite(value) || value <= 0) {
    return { state, events: [{ type: 'error', at: now(state), message: 'Vitesse invalide' }] };
  }
  const draft = cloneState(state);
  draft.clock.speed = value;
  if (value !== 1) markCheat(draft, 'vitesse');
  return {
    state: draft,
    events: [{ type: 'dev', at: now(draft), dev: true, message: `Vitesse du temps : x${value}` }]
  };
}

/** [DEV] Met le temps en pause ou le relance. */
export function setPaused(state, config, { paused }) {
  const draft = cloneState(state);
  draft.clock.paused = Boolean(paused);
  if (draft.clock.paused) markCheat(draft, 'pause');
  return {
    state: draft,
    events: [{ type: 'dev', at: now(draft), dev: true, message: draft.clock.paused ? 'Temps en pause' : 'Temps relancé' }]
  };
}

/** Formate une durée en ms : "1 min 05 s", "45 s", "2 h 03 min". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}
