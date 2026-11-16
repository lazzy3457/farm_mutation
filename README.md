# Mutation Farm — prototype navigateur

Prototype jouable pour valider la boucle de jeu, l'équilibrage et les règles de fusion de **Mutation Farm** (futur jeu Roblox) avant le développement en Luau.
Visuel volontairement minimaliste : cases colorées, emojis, texte et boutons.

> **État : étape 1 / 4.** Grille, horloge, plantation, pousse, récolte, vente, sauvegarde locale, mode dev « Temps » et « Pièces ».
> À venir : fusions et pollen (étape 2), marché complet, agrandissement et encyclopédie (étape 3), boutique Robux simulée, points non tranchés, stats, snapshots et version testeurs (étape 4).

## Lancer en local

Les modules ES ne fonctionnent pas en ouvrant `index.html` directement (double-clic) : il faut un petit serveur web local. Dans le dossier du jeu :

```bash
npx serve
```

ou, si Python est installé :

```bash
python -m http.server 8000
```

Ouvre ensuite l'adresse affichée (par exemple `http://localhost:3000` ou `http://localhost:8000`).

- Jeu : `index.html`
- Mode dev directement ouvert : `index.html?dev=1`
- Tests unitaires de la logique : `tests.html`

## Comment jouer (étape 1)

1. Achète des graines au **marché** (panneau de gauche).
2. Clique sur une graine dans l'**inventaire** pour la sélectionner, puis sur une **case vide** pour la planter.
3. Attends que la barre de pousse se remplisse.
4. Clique sur la plante mûre : **Récolter** (elle va dans l'inventaire, 1 emplacement) ou **Récolter et vendre**.
5. Vends tes récoltes depuis l'inventaire.

La partie est sauvegardée automatiquement dans le navigateur (toutes les 10 s et à la fermeture de l'onglet). En revenant, le temps écoulé hors ligne est appliqué (à vitesse x1, plafonné à 24 h par défaut).

## Mode dev

| Raccourci | Effet |
|---|---|
| `F2` | Afficher / masquer le panneau dev |
| `?dev=1` dans l'URL | Ouvrir le jeu avec le panneau dev visible |
| `Échap` | Annuler la sélection de graine, le mode « mûrir une case » ou fermer le menu |

Sections disponibles à l'étape 1 :

- **Temps** : vitesse x1 / x2 / x5 / x10 / x60 / x600 ou valeur libre, pause / reprise, avancer de +10 s / +1 min / +10 min, mûrir une case ciblée (bouton puis clic sur la graine) ou toutes les graines.
- **Pièces** : +100, +1 000, +100 000 (et retraits), ou montant libre.
- **Journal d'événements** : chaque plantation, maturation, découverte, achat, récolte et vente, avec l'heure réelle et l'heure de jeu (`T+mm:ss`). Les actions de triche sont préfixées `[DEV]`. Bouton « Copier » pour récupérer tout le journal.

Toute triche marque la partie comme « triches utilisées » (`dev.used`), ce qui sera repris dans le résumé de retour testeur.

## Équilibrage : `config/game-config.json`

Toutes les valeurs d'équilibrage sont dans ce seul fichier, aucune n'est écrite dans le code. Modifie-le puis recharge la page.
Si tu changes la **structure** de la sauvegarde, incrémente `saveVersion` ; si tu veux signaler aux joueurs un changement d'équilibrage, incrémente `configVersion` (le jeu proposera alors de continuer ou de recommencer).

### Valeurs placeholder à équilibrer

Le GDD ne fixe pas ces valeurs. Elles sont marquées `"placeholder": true` dans la config. Objectif visé : un premier mutant palier 1 (Carotte Pourpre) en 10 à 15 minutes de première session.

| Valeur | Placeholder actuel | Où dans la config |
|---|---|---|
| Pièces de départ | 100 | `start.coins` |
| Emplacements d'inventaire de départ | 10 (1 objet = 1 emplacement) | `start.inventorySlots` |
| Carotte : prix / pousse / vente | 10 / 60 s / 18 | `plants.carotte` |
| Radis : prix / pousse / vente | 10 / 90 s / 20 | `plants.radis` |
| Maïs : prix / pousse / vente | 40 / 120 s / 75 | `plants.mais` |
| Fraise : prix / pousse / vente | 60 / 150 s / 110 | `plants.fraise` |
| Vente Carotte Pourpre (P1) | 250 | `plants.carotte_pourpre` |
| Vente Fraise Céleste (P2, recette provisoire) | 900 | `plants.fraise_celeste` |
| Vente Maïs Doreur (P2) | 1 500 | `plants.mais_doreur` |
| Vente Citrouille Nébulique (P3) | 15 000 | `plants.citrouille_nebulique` |
| Agrandissement 4x4 / 5x5 / 6x6 | 500 / 2 000 / 8 000 Pièces | `grid.expandCosts` |
| Recharge de pollen | 150 Pièces / 19 Robux | `pollen.rechargeCost` |
| Fusion garantie en Robux (P1/P2/P3) | 99 / 499 / 1 999 | `guaranteedFusion.costByTier` |
| Déblocage du Maïs / de la Fraise au marché | découverte de la Carotte Pourpre / parcelle 4x4 | `market.unlocks` |
| Graines Exotiques : nombre de graines taguées par achat | 3 | `robuxShop.consumables.exoticSeeds` |
| Recette provisoire de la Fraise Céleste | Fraise + Radis, 20 % (`"todo": true`) | `recipes` |

## Structure

```
index.html              page du jeu
tests.html              tests unitaires de la logique pure
config/game-config.json toutes les valeurs d'équilibrage
js/main.js              démarrage, boucle de jeu, liaison interface <-> logique
js/logic/               logique PURE (sans DOM), portable en Luau
  state.js              état initial, utilitaires (cases, voisins, réglages)
  clock.js              horloge : now(), vitesse, pause
  grid.js               plantation, pousse, maturation, récolte
  economy.js            achats, ventes, inventaire
  encyclopedia.js       découvertes et bonus de pages
js/storage.js           sauvegarde localStorage
js/ui/                  affichage (render.js, dev-panel.js, log.js)
css/style.css
```

Règle d'architecture : chaque action de `js/logic/` est une fonction pure `(state, config, params) → { state, events }`. Elle ne modifie jamais l'état reçu et ne lit jamais l'heure système : le temps passe uniquement par `now(state)`.

## Mettre en ligne

*Section complétée à l'étape 4 (Netlify Drop puis GitHub Pages, pas à pas).*
