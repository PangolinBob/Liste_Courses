# Liste_Courses

Application web locale de **liste de courses** (mobile-first), avec interface et logique intégrées dans `index.html`, ressources locales et persistance locale.

La **version 1.1.1** est indiquée au bas du menu Actions. Ce numéro appartient au
programme effectivement chargé, y compris quand il vient du cache local.

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
- Recherche avec ou sans accents et ligatures (`creme` trouve `Crème`, `oeufs` trouve `Œufs`).
- nettoyage rapide de recherche.

Le sélecteur compact à deux positions de l’en-tête choisit directement l’ordre
**Manuel** (poignée à six points) ou **Alphabétique** (A–Z), sans ouvrir de menu.
Ce choix est enregistré et conservé lors de la navigation, du filtre, de la recherche,
de la réouverture et d’Undo. L’ordre alphabétique est français et porte sur une copie
d’affichage : le rangement manuel enregistré reste intact. Le retour à Manuel le
retrouve exactement. Dans la vue globale, seuls les articles de chaque groupe sont
triés ; l’ordre des magasins reste celui enregistré.

Le menu Actions affiche toujours **Tous les magasins**, avec un libellé fixe.
Ce réglage est modifiable quel que soit l’état du filtre. Son état **ON/OFF** indique
le périmètre choisi pour le filtre :

- filtre **OFF** : tous les articles du magasin actif ;
- filtre **ON**, **Tous les magasins OFF** : les articles à acheter du magasin actif ;
- filtre **ON**, **Tous les magasins ON** : les articles à acheter de tous les magasins,
  regroupés dans l’ordre enregistré des magasins et de leurs articles.

Le choix est enregistré dans les préférences locales et conservé au passage du filtre
à OFF, au retour à l’accueil, au changement de magasin et à la réouverture de l’app.
Retour mène à l’accueil sans modifier ce choix ; Undo annule les données sans annuler
les réglages d’affichage. Restaurer une ancienne sauvegarde qui ne contient pas ce réglage
conserve le choix actuel ; une sauvegarde qui le contient restaure sa valeur enregistrée.
Le réglage reste dans Actions, accessible depuis l’accueil et depuis un magasin.

Dans la vue globale, les magasins sans achat sont masqués. La recherche porte sur tous
les groupes ; les quantités, le toucher pour retirer un achat et Undo modifient les
articles de leur magasin d’origine.

L’ajout, la nouvelle course et la restauration restent dans la vue d’un magasin.
Le déplacement des articles est disponible en mode Manuel ; celui des magasins à
l’accueil reste disponible quel que soit le tri choisi. Les commandes de la liste
restent accessibles en haut pendant le défilement.

Le regroupement des articles et la conservation de leur ordre ont été validés sur
l’iPhone 13 mini le 30 octobre 2026. La stabilité du réglage mémorisé de 8421d67 a été
testée sur PC et vérifiée en ligne ; son essai sur l’iPhone reste à faire.

## 4) Réorganisation (drag & drop)
- Réordre des magasins (écran home).
- Réordre des articles dans un magasin.
- support tactile (appui long + déplacement), auto-scroll, garde-fous iOS.

## 5) Actions de liste
Le bouton “Actions” (trois points) est accessible en haut à droite de l’accueil et
dans chaque magasin. Les commandes communes sont :
- Undo,
- Tous les magasins (réglage ON/OFF),
- Passer en mode clair / Passer en mode sombre,
- Sauvegardes.

Dans la vue d’un magasin, le menu propose également :
- Nouvelle course (remet `planned=false` sans toucher aux quantités),
- Restaurer la liste d’origine (si magasin template).

## 6) Sauvegarde / restauration
Depuis **Actions → Sauvegardes** (également accessible par le titre Listes de l’accueil) :
- **Sauvegarder** en JSON,
- **Restaurer** depuis un JSON.

Le JSON inclut l’état complet (magasins, articles, quantités, préférences thème…).
Les articles ajoutés dans l’app vivent sur l’appareil ; le fichier exporté en constitue
une copie de secours distincte du code. « Restaurer la liste d’origine » remet au
contraire les articles initiaux du magasin et ne récupère pas les ajouts personnels.

La restauration contrôle le contenu entier du fichier avant de remplacer les données.
Un fichier invalide laisse les listes précédentes intactes. Les champs inconnus et
les personnalisations valides sont conservés. Si une ancienne sauvegarde ne contient
pas le choix du tri ou le périmètre tous magasins, le choix actuel est conservé.

Au démarrage, des données illisibles ou d’une version incompatible ne sont jamais
remplacées silencieusement par les listes initiales : un écran de récupération propose
leur export brut, une restauration ou une nouvelle tentative. En cas de refus
d’enregistrement, l’app revient au dernier état effectivement sauvegardé et l’annonce ;
l’action refusée ne pollue pas Undo.

## 7) Thème et UI
- thème clair/sombre depuis Actions (choix mémorisé),
- changement de thème et filtre ON/OFF sans pastille de confirmation,
- nom du magasin dégagé, recherche sur la deuxième ligne et zones tactiles étendues,
- formulaires adaptés à l’espace visible au-dessus du clavier, avec défilement si nécessaire,
- rendu “glassmorphism” ajustable (`VISUAL.GLASS`, `VISUAL.CONTRAST`),
- splash screen animé,
- toasts, modales, action sheets.

### Messages temporaires

La version 1.1 contenait 24 messages possibles. La version 1.1.1 en retire 14 qui
répétaient un changement visible, une annulation volontaire ou une indication déjà
portée par l’écran. Les 10 messages conservés concernent les fichiers et les erreurs.
Ils apparaissent en bas de la zone réellement visible, au-dessus du clavier quand il
est ouvert, afin de laisser libre le nom du magasin. Les confirmations de thème et de
filtre avaient déjà été supprimées avant la version 1.1.

| Messages retirés | Motif |
|---|---|
| Ordre mis à jour | L’ordre est immédiatement visible. |
| Magasin ajouté ; Magasin renommé ; Magasin supprimé | Le résultat est visible dans la liste. |
| Article ajouté ; Article renommé ; Article supprimé | Le résultat est visible dans la liste. |
| Nouvelle course ; Liste restaurée | La liste montre déjà le résultat de l’action confirmée. |
| Annulé | Le résultat d’Undo est visible. |
| Rien à annuler | Undo est déjà grisé quand l’historique est vide ; son garde-fou demeure. |
| Export annulé ; Sauvegarde annulée | L’utilisateur vient lui-même d’annuler. |
| Choisis le fichier de sauvegarde (.json) | Le sélecteur de fichier donne déjà cette indication. |

| Messages conservés | Utilité |
|---|---|
| Sauvegarde créée | Confirme que le fichier a été proposé au partage ou au téléchargement ; son enregistrement effectif dépend ensuite du choix de l’utilisateur. |
| Restauration OK | Confirme que le fichier a été lu, validé et appliqué. |
| Contenu conservé exporté | Confirme l’export du contenu de récupération. |
| Undo impossible | Signale l’échec d’une action demandée. |
| Enregistrement impossible. La modification n’a pas été conservée. | Prévient qu’un changement n’a pas été enregistré et a été annulé. |
| Sauvegarde impossible | Signale que le fichier n’a pas pu être préparé ou proposé. |
| Export impossible. Le contenu reste conservé dans l’app. | Signale l’échec de l’export de récupération. |
| Fichier invalide. Les données précédentes sont conservées. | Explique le refus d’une restauration sans perte des listes existantes. |
| Restauration impossible. Les données précédentes sont conservées. | Signale l’échec de la restauration. |
| Le fichier a été préparé, mais sa date n’a pas pu être enregistrée dans l’app. | Distingue la préparation du fichier de l’échec de mise à jour de sa date. |

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
Le déplacement tactile a été validé sur l’iPhone par Gaël.

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
- `node tests/scope-preference.cjs` vérifie le réglage indépendant du filtre et sa
  conservation après navigation, changement de thème, réouverture, Undo et restauration
  d’une ancienne sauvegarde.
- `node tests/data-safety.cjs` vérifie les fichiers invalides, le démarrage avec des
  données illisibles et les refus d’écriture ; `--baseline` reproduit les défauts de référence.
- `node tests/ui-updates.cjs` vérifie recherche, tri non destructif, gestes, en-tête,
  cibles tactiles et formulaires avec une géométrie de clavier simulée ;
  `--ref=5862a4f` compare la version antérieure.
- `node tests/interactions.cjs --baseline` reproduit le compteur bloqué sans animation sur la version de référence.

Le banc utilise Chromium, un CPU ralenti six fois et des profils isolés de 28 et 300 articles.
Ses temps de traitement sont comparables sur le même PC ; ils ne constituent pas une mesure du GPU ni de Safari sur l’iPhone.
Les essais de clavier simulé ne remplacent pas une validation du clavier réel dans
Safari sur l’iPhone 13 mini.

## Ouverture rapide et cache local

L’accueil est disponible dès son rendu, sans attendre `window.load`, les images, les polices
ou une temporisation de 320 ms. Le toucher de l’écran au caddie révèle cet accueil déjà préparé.
Son animation et le fonctionnement des listes restent identiques.
Le toucher complet de cet écran révèle l’accueil sans activer le magasin situé dessous.

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
propre à iOS avant l’affichage de la page.
L’ouverture accélérée a été validée sur l’iPhone par Gaël le 26 octobre 2026 :
« significativement plus rapide ».
Le cache nécessite une première ouverture en ligne et peut être évincé par le navigateur.
