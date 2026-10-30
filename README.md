# Liste_Courses

Application web locale de **liste de courses** (mobile-first), avec interface et logique intégrées dans `index.html`, ressources locales et persistance locale.

## Objectif

Gérer simplement tes courses par magasin, avec une interface tactile soignée :
- magasins multiples,
- articles + quantités,
- marquage “à acheter”,
- recherche, filtres et réorganisation,
- sauvegarde/restauration JSON.

---

## Stack technique

- HTML / CSS / JavaScript vanilla (sans framework)
- stockage local via `localStorage`
- UI orientée iPhone/PWA (meta Apple, safe-area, tactile)

---

## Structure du repo

```txt
Liste_Courses/
├─ index.html         # app complète (UI + logique + data templates)
├─ IconCourses.png    # icône app / splash / favicon
├─ sw.js              # cache du programme et actualisation en arrière-plan
├─ fonts/             # Syne locale (WOFF2) et licence OFL
└─ tests/             # vérifications dans des profils de navigateur isolés
```

---

## Fonctionnalités principales

## 1) Gestion des magasins
- Affichage des listes de magasins (home).
- Ajout / renommage / suppression d’un magasin.
- Badge “reste” = nombre d’articles planifiés à acheter.

## 2) Gestion des articles
Dans chaque magasin :
- ajout / renommage / suppression d’article,
- quantité via stepper `- / +` (bornée de 1 à 99),
- toggle rapide “prévu/pas prévu” en touchant la ligne.

## 3) Filtre et recherche
- Filtre ON/OFF pour n’afficher que les articles “prévus”.
- Barre de recherche texte par nom d’article.
- nettoyage rapide de recherche.

Avec le filtre **ON**, le menu Actions propose **Tous les magasins** : une seule page
des articles à acheter, regroupés par magasin dans l’ordre enregistré des magasins et
des articles. Les magasins sans achat sont masqués. La recherche porte sur tous les
groupes ; les quantités, le toucher pour retirer un achat et Undo modifient les articles
de leur magasin d’origine.

Le menu propose ensuite **Ce magasin uniquement** pour revenir au magasin de départ.
Le bouton Retour et le passage du filtre à OFF y ramènent aussi. Réactiver le filtre
seul conserve l’affichage d’un seul magasin. Le choix d’affichage reste dans Actions,
sans accès supplémentaire à l’accueil.

L’ajout, la nouvelle course, la restauration et le réordonnancement restent dans la vue
d’un magasin ; la vue globale reprend cet ordre et conserve ses commandes en haut
pendant le défilement.

## 4) Réorganisation (drag & drop)
- Réordre des magasins (écran home).
- Réordre des articles dans un magasin.
- support tactile (appui long + déplacement), auto-scroll, garde-fous iOS.

## 5) Actions de liste
Menu “Actions” d’un magasin :
- Undo,
- Nouvelle course (remet `planned=false` sans toucher aux quantités),
- Restaurer la liste d’origine (si magasin template).

## 6) Sauvegarde / restauration
Depuis l’écran Réglages :
- **Sauvegarder** en JSON,
- **Restaurer** depuis un JSON.

Le JSON inclut l’état complet (magasins, articles, quantités, préférences thème…).

## 7) Thème et UI
- thème clair/sombre,
- rendu “glassmorphism” ajustable (`VISUAL.GLASS`, `VISUAL.CONTRAST`),
- splash screen animé,
- toasts, modales, action sheets.

---

## Données initiales

Le projet embarque des templates de magasins/articles dans `index.html` (constante `ORIGINAL_TEMPLATES`) :
- Carrefour
- Grand Frais
- Marie Blachère
- Picard
- Boîte à Fromage

---

## Persistance locale

Clé locale utilisée :
- `lc_appData_v1`

⚠️ Si le stockage navigateur est vidé, les données sont perdues (sauf si sauvegarde JSON externe).

---

## Lancer le projet

Aucune installation requise.

### Option simple
Ouvrir `index.html` dans un navigateur moderne.

### Option recommandée (serveur local)
```bash
python3 -m http.server 8080
```
Puis ouvrir :
```txt
http://127.0.0.1:8080
```

---

## Compatibilité

- optimisé mobile (iOS/Safari),
- fonctionne desktop moderne,
- réouverture hors connexion après installation du cache lors d’une première ouverture en HTTPS (ou sur localhost).

---

## Limites connues

- pas de synchro cloud native,
- pas d’auth utilisateur,
- architecture monolithique (tout dans `index.html`, pratique mais moins modulaire).

---

## Pistes d’évolution

- extraction JS/CSS en fichiers séparés,
- tests unitaires sur logique métier (undo, import/export, filtres),
- gestion multi-profils ou multi-utilisateurs,
- sync cloud optionnelle.

## Déplacement tactile et vérification

Le déplacement utilise SortableJS 1.15.7, intégré dans `index.html` avec sa licence MIT.
La bibliothèque est figée et ne nécessite aucun téléchargement pendant l’utilisation de l’app.
Un appui de 320 ms sélectionne la carte ; le doigt peut ensuite la déplacer et la déposer.
Le défilement ordinaire reste disponible avant cet appui long.

Les tests `tests/reorder.cjs` utilisent Playwright et des gestes tactiles Chromium, dans un profil isolé.
Exécution avec Playwright disponible : `node tests/reorder.cjs`.
`PLAYWRIGHT_MODULE` peut désigner une installation existante ; `BROWSER_CHANNEL` choisit le navigateur.
Ils vérifient le déplacement, la sauvegarde, l’annulation et le retour au défilement normal.
La validation finale du comportement de Safari reste à faire sur l’iPhone.

## Réactivité des actions

La sélection et les quantités mettent à jour la carte concernée et le compteur, sans reconstruire la liste ni recréer SortableJS.
La recherche conserve son champ, son curseur et réutilise les cartes du magasin courant.
Le cache de cartes est vidé lors d’un changement d’écran ou d’un rendu complet.
Les sauvegardes restent synchrones et la clé `lc_appData_v1` ne change pas.
Les actions de menus n’attendent plus la fin de leur animation de fermeture.

Vérifications :
- `node tests/responsiveness.cjs --ref=9bb4df7` mesure la version de référence.
- `node tests/responsiveness.cjs --verify` mesure et vérifie la version courante.
- `node tests/interactions.cjs` contrôle le filtre, les mouvements réduits, la recherche et les formulaires.
- `node tests/global-shopping.cjs` vérifie l’accès avec filtre ON, les groupes et leur ordre,
  les actions dans le bon magasin, la recherche, Undo, les listes vides, la conservation
  des données et le défilement tactile de la vue globale.
- `node tests/interactions.cjs --baseline` reproduit le compteur bloqué sans animation sur la version de référence.

Le banc utilise Chromium, un CPU ralenti six fois et des profils isolés de 28 et 300 articles.
Ses temps de traitement sont comparables sur le même PC ; ils ne constituent pas une mesure du GPU ni de Safari sur l’iPhone.

## Ouverture rapide et cache local

L’accueil est disponible dès son rendu, sans attendre `window.load`, les images, les polices
ou une temporisation de 320 ms. Le toucher de l’écran au caddie révèle cet accueil déjà préparé.
Son animation et le fonctionnement des listes restent identiques.

Syne est servie depuis `fonts/`, avec `font-display: swap` : aucun appel à Google Fonts
au démarrage. Les fichiers WOFF2 officiels de Syne v24 conservent les poids 500/600 et
les jeux latin, latin étendu et grec ; la licence est dans `fonts/OFL.txt`.
Source : https://fonts.googleapis.com/css2?family=Syne:wght@500;600&display=swap.

Le service worker s’installe après le premier affichage, sans bloquer l’application.
Il précharge le document, l’icône et les trois polices. Les ouvertures suivantes servent
le document en cache immédiatement, puis vérifient le serveur en arrière-plan ; une
nouvelle version du document devient disponible à l’ouverture suivante, sans rechargement
forcé d’une liste ouverte. Les chemins `/Liste_Courses/` et `/Liste_Courses/index.html`
utilisent la même copie, y compris avec un paramètre de requête.

Les réponses HTML en erreur ou redirigées ne remplacent pas une copie valide.
Une nouvelle installation du service worker échoue si une ressource manque ; l’ancienne
version reste alors active. Le nettoyage ne concerne que les caches préfixés par
`liste-courses:` et le périmètre exact de l’application : les autres apps de la même
origine sont préservées. Ni `lc_appData_v1` ni son schéma ne changent.

Changer `shell-v1` dans `sw.js` si les ressources précachées ou leur liste changent.
L’activation immédiate est adaptée au programme/CSS intégrés dans le document et aux
ressources statiques actuelles. La revoir si le programme est séparé en fichiers à
charger ensemble. Référence : https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching.

Vérifications :
- `node tests/startup.cjs --ref=22f2dde` reproduit les attentes de la version de référence.
- `node tests/startup.cjs` vérifie l’affichage avec police ou icône retardée de 2,5 s,
  l’absence de dépendance externe, la réouverture sans réseau, les données conservées,
  les actualisations et les échecs serveur/installation.

Le banc tourne sur Chromium PC, dans des profils isolés. Il ne mesure pas le lancement
propre à iOS avant l’affichage de la page ; le gain sur l’iPhone reste à confirmer.
Le cache nécessite une première ouverture en ligne et peut être évincé par le navigateur.
