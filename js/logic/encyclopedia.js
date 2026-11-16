// =============================================================================
// encyclopedia.js — Découvertes et bonus permanents des pages.
//
// Étape 1 : version minimale (découverte à la maturation + calcul des bonus),
// utilisée par le calcul du temps de pousse et de la taille d'inventaire.
// L'affichage et les commandes dev arrivent à l'étape 3.
// =============================================================================

/** Vrai si toutes les plantes de la page sont découvertes, ou si le dev a forcé la page. */
export function isPageComplete(state, config, page) {
  const forced = state.encyclopedia && state.encyclopedia.forcedPages
    ? state.encyclopedia.forcedPages[page.id]
    : undefined;
  if (forced === true) return true;
  if (forced === false) return false;
  return page.plants.every((p) => state.discovered.includes(p));
}

/**
 * Somme des bonus actifs des pages complètes.
 * Renvoie { growSpeed, inventorySlots, chancePoints }.
 */
export function getActiveBonuses(state, config) {
  const totals = { growSpeed: 0, inventorySlots: 0, chancePoints: 0 };
  for (const page of config.encyclopedia.pages) {
    if (!isPageComplete(state, config, page)) continue;
    const { type, value } = page.bonus;
    if (type in totals) totals[type] += value;
  }
  return totals;
}

/**
 * Marque une plante comme découverte (sur un état DÉJÀ cloné) et ajoute les
 * événements correspondants (découverte, page complétée).
 */
export function discoverPlant(draft, config, plantId, at, events) {
  if (draft.discovered.includes(plantId)) return;
  const completeBefore = config.encyclopedia.pages.filter((p) => isPageComplete(draft, config, p)).map((p) => p.id);
  draft.discovered.push(plantId);
  events.push({ type: 'discovered', at, plantId });
  for (const page of config.encyclopedia.pages) {
    if (!completeBefore.includes(page.id) && isPageComplete(draft, config, page)) {
      events.push({ type: 'pageCompleted', at, pageId: page.id, bonusName: page.bonus.name });
    }
  }
}
