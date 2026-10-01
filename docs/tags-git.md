# Départ, étapes et secours Git

Les URL `/` et `/reference/` permettent immédiatement de comparer avant/après dans le dossier courant. Elles utilisent le même arbre Git : ce n'est pas un dépôt de départ isolé.

Le script `scripts/create-workshop-tags.ps1` prépare **deux arbres distincts** :

| Tag | Contenu |
| --- | --- |
| `workshop-start` | API, fixtures, tableau de départ, supports, modèle GLB et modules Three.js ; aucun code `frontend/` ou bundle `wwwroot/reference/`. |
| `demo-fallback` | Snapshot complet avec l'interface de référence et les trois animations. |

Le script affiche les fichiers sélectionnés par défaut. Il utilise une liste explicite de fichiers/dossiers, exclut les caches et sorties de build, et refuse un tag déjà existant. Ne l'exécuter avec `-Create` qu'après instruction explicite et validation des interfaces, des données et de `git diff`.

```powershell
.\scripts\create-workshop-tags.ps1
git diff --stat
git diff
```

Après cette validation, l'animateur peut demander la création puis exécuter :

```powershell
.\scripts\create-workshop-tags.ps1 -Create
git show --stat workshop-start
git show --stat demo-fallback
git diff --stat workshop-start demo-fallback
```

La création fabrique des commits locaux de snapshot à partir des fichiers relus, avec un index temporaire, puis crée les deux tags atomiquement. Elle ne déplace pas `HEAD`, ne modifie pas l'index réel et ne réécrit aucun fichier de travail. Les tags ne sont pas poussés. Les fichiers non suivis hors liste ne sont pas inclus ; un fichier suivi hors liste fait échouer le script pour éviter une omission silencieuse.

Un tag intermédiaire `demo-replay` ne doit être créé qu'à partir d'un snapshot vérifié contenant réellement cette étape. Le script ne fait pas passer la référence complète pour une étape replay seule. Lors d'une répétition, réaliser cette étape dans le clone starter, relire le diff, créer le commit autorisé puis le tag `demo-replay` sur ce commit.

## Utiliser les tags sans écraser une séance

Préparer **avant la séance** des clones séparés dans des destinations nouvelles :

```powershell
git clone --branch workshop-start --single-branch <chemin-ou-url-du-depot> <nouveau-dossier-starter>
git clone --branch demo-fallback --single-branch <chemin-ou-url-du-depot> <nouveau-dossier-secours>
```

Chaque destination doit être vide ou absente. Les clones locaux évitent le Wi-Fi ; restaurer leurs dépendances NuGet avant de couper le réseau. Le starter ne possède pas l'implémentation finale. Il conserve `wwwroot/vendor/three/` et `wwwroot/models/` : associer `three` à `/vendor/three/three.module.js` et `three/addons/` à `/vendor/three/addons/`, puis charger `/models/f1-2026.glb` avec GLTFLoader. Le [prompt de démo](atelier.md) fournit les imports locaux, sans `npm install` ni conversion.

En cas de blocage, ouvrir la référence déjà lancée ou lancer le clone secours sur un port libre. Garder le clone des participants intact. Aucun `reset --hard`, `clean`, force-push ou déplacement du checkout actif n'est nécessaire.
