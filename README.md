# Liste_Courses

Application web locale de **liste de courses** (mobile-first), en **fichier unique** (`index.html`) avec persistance locale.

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
└─ IconCourses.png    # icône app / splash / favicon
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
- fonctionnement offline possible après chargement initial (pas d’API backend).

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
