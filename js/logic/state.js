// =============================================================================
// state.js — Création de l'état initial et utilitaires purs partagés.
//
// Convention de toute la logique (dossier js/logic/) :
//   - aucune fonction ne touche au DOM ni au localStorage ;
//   - une action reçoit (state, config, params) et renvoie { state, events } ;
//   - l'état reçu n'est JAMAIS modifié : on travaille sur une copie.
// Cette convention facilite le portage en Luau (un module = un ModuleScript).
// =============================================================================

/** Copie profonde de l'état (l'état est du JSON pur, sans fonctions). */
export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/** Identifiant d'une case : "x,y" (x = colonne, y = ligne, à partir de 0). */
export function cellId(x, y) {
  return `${x},${y}`;
}

/** Inverse de cellId : "2,1" -> { x: 2, y: 1 }. */
export function parseCellId(id) {
  const [x, y] = id.split(',').map(Number);
  return { x, y };
}

/** Vrai si la case existe dans une grille de taille `size`. */
export function isInGrid(id, size) {
  const { x, y } = parseCellId(id);
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size;
}

/**
 * Voisins d'une case : les 4 cases orthogonales (haut, bas, gauche, droite),
 * sans diagonales, limitées à la grille.
 */
export function neighbors(id, size) {
  const { x, y } = parseCellId(id);
  const candidates = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];
  return candidates
    .filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < size && cy < size)
    .map(([cx, cy]) => cellId(cx, cy));
}

/** Définition d'une plante depuis la config (ou null si inconnue). */
export function getPlant(config, plantId) {
  return config.plants[plantId] || null;
}

/**
 * Valeur effective d'un point non tranché : réglage dev s'il existe,
 * sinon valeur par défaut de la config.
 */
export function getSetting(state, config, key) {
  const override = state.settingsOverrides ? state.settingsOverrides[key] : undefined;
  if (override !== undefined) return override;
  const entry = config.undecided[key];
  return entry ? entry.value : undefined;
}

/** Nom affiché d'une plante (gère le libellé paramétrable « Maïs Doreur / Maïs Doré »). */
export function plantName(state, config, plantId) {
  const plant = getPlant(config, plantId);
  if (!plant) return plantId;
  if (plant.labelSetting) {
    const label = getSetting(state, config, plant.labelSetting);
    if (label) return label;
  }
  return plant.name;
}

/** Liste des graines débloquées dès le départ (type "start" dans la config du marché). */
function initialUnlockedSeeds(config) {
  return Object.entries(config.market.unlocks)
    .filter(([, rule]) => rule.type === 'start')
    .map(([plantId]) => plantId);
}

/**
 * État initial d'une nouvelle partie. Toutes les valeurs viennent de la config.
 * C'est aussi le modèle de données sauvegardé dans le localStorage.
 */
export function createInitialState(config) {
  return {
    saveVersion: config.saveVersion,
    configVersion: config.configVersion,
    // Horloge de jeu : temps de jeu écoulé (ms), vitesse et pause.
    clock: { gameTimeMs: 0, speed: 1, paused: false },
    // Heure réelle de la dernière sauvegarde (rempli par storage.js, sert à la progression hors ligne).
    lastRealMs: null,
    coins: config.start.coins,
    robuxSpentSim: 0,
    grid: { size: config.grid.startSize, cells: {} },
    // Inventaire : nombre d'objets par type. 1 objet = 1 emplacement.
    inventory: { seeds: {}, crops: {} },
    unlockedSeeds: initialUnlockedSeeds(config),
    discovered: [],
    passes: { luckyGenes: false, autoWater: false, vipExtension: false },
    // Pages d'encyclopédie forcées par le mode dev (étape 3) : { "1": true | false }.
    encyclopedia: { forcedPages: {} },
    // Graines exotiques restantes (tag visuel, étape 4).
    exoticCharges: 0,
    dev: {
      used: false,           // vrai dès qu'une triche a été utilisée
      cheatsUsed: {},        // nom de triche -> nombre d'utilisations
      chanceOverride: null,  // étape 2
      forceNext: 'normal',   // étape 2
      noCap: false,          // étape 2
      showChance: false      // étape 2
    },
    stats: {
      attempts: {},          // étape 2 : { "1": { n, ok, sumChance } }
      coinsEarned: 0,
      coinsSpent: 0,
      realPlayMs: 0,
      gamePlayMs: 0,
      harvested: 0,
      sold: 0
    },
    settingsOverrides: {},
    welcomeSeen: false
  };
}

/**
 * Marque l'utilisation d'une triche du mode dev (modifie la copie passée).
 * À appeler sur un état DÉJÀ cloné.
 */
export function markCheat(draft, cheatName) {
  draft.dev.used = true;
  draft.dev.cheatsUsed[cheatName] = (draft.dev.cheatsUsed[cheatName] || 0) + 1;
}

/** Événement d'erreur standard (action refusée), affiché en message temporaire. */
export function errorResult(state, message, at) {
  return { state, events: [{ type: 'error', at, message }] };
}
