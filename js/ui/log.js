// =============================================================================
// log.js — Journal d'événements horodaté.
//
// Chaque événement renvoyé par la logique est transformé en ligne lisible,
// avec l'heure réelle et l'heure de jeu. Les événements causés par une triche
// du mode dev sont préfixés par [DEV].
// Étape 2 : ajout des tirages de fusion (chance calculée, valeur tirée, etc.).
// =============================================================================

import { plantName, getPlant } from '../logic/state.js';
import { formatDuration } from '../logic/clock.js';

/** "T+12:34" : heure de jeu depuis le début de la partie. */
function formatGameTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `T+${h}:${mmss}` : `T+${mmss}`;
}

/** Heure réelle "hh:mm:ss". */
function formatRealTime(ms) {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });
}

/** Emoji + nom d'une plante. */
function label(state, config, plantId) {
  const plant = getPlant(config, plantId);
  return `${plant ? plant.emoji : ''} ${plantName(state, config, plantId)}`.trim();
}

/** Texte lisible d'un événement (null = ne pas journaliser). */
export function formatEvent(ev, state, config) {
  switch (ev.type) {
    case 'planted':
      return `Plantation : ${label(state, config, ev.plantId)} en (${ev.cellId}) — mûre dans ${formatDuration(ev.growMs)} de jeu`;
    case 'matured':
      return `Maturation : ${label(state, config, ev.plantId)} en (${ev.cellId})`;
    case 'discovered':
      return `Découverte : ${label(state, config, ev.plantId)} ajoutée à l'encyclopédie`;
    case 'pageCompleted':
      return `Page ${ev.pageId} de l'encyclopédie complète : bonus « ${ev.bonusName} » débloqué`;
    case 'bought':
      return `Achat : ${ev.qty} × ${label(state, config, ev.plantId)} (−${ev.cost} Pièces)`;
    case 'harvested':
      return `Récolte : ${label(state, config, ev.plantId)} en (${ev.cellId})`;
    case 'sold':
      return `Vente : ${ev.qty} × ${label(state, config, ev.plantId)} (+${ev.coins} Pièces)`;
    case 'offline':
      return `Progression hors ligne : ${formatDuration(ev.realMs)} appliquées (vitesse x1)`;
    case 'dev':
      return ev.message;
    case 'error':
      return `Refusé : ${ev.message}`;
    default:
      return ev.message || ev.type;
  }
}

/** Crée le journal (en mémoire, limité à config.ui.logMaxEntries lignes). */
export function createLog(config) {
  const entries = [];
  let version = 0;
  return {
    entries,
    /** Numéro qui change à chaque ajout (permet de savoir s'il faut redessiner). */
    get version() { return version; },
    add(events, state) {
      for (const ev of events) {
        const text = formatEvent(ev, state, config);
        if (!text) continue;
        entries.push({
          realMs: Date.now(),
          gameMs: ev.at || 0,
          dev: Boolean(ev.dev),
          kind: ev.type,
          text: (ev.dev ? '[DEV] ' : '') + text
        });
      }
      while (entries.length > config.ui.logMaxEntries) entries.shift();
      version += 1;
    },
    clear() { entries.length = 0; version += 1; },
    /** Ligne formatée complète d'une entrée. */
    line(entry) {
      return `${formatRealTime(entry.realMs)} · ${formatGameTime(entry.gameMs)} · ${entry.text}`;
    },
    /** Export texte de tout le journal. */
    toText() { return entries.map((e) => this.line(e)).join('\n'); }
  };
}
