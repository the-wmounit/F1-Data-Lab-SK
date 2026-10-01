# Modèle 3D local du replay

`f1-2026.glb` est le vrai maillage fourni dans `F1+2026.obj`, converti et allégé pour Three.js. Ses trois textures PNG sont embarquées. Les participants utilisent ce GLB déjà préparé : aucun outil 3D, téléchargement, compte ou conversion au lancement.

Le modèle représente un concept F1 2026 utilisé comme illustration générique des courses 2024. Ce n'est pas le modèle exact de chaque écurie. La carrosserie possède la livrée bleue FIA/F1 d'origine ; l'interface peut la teinter aux couleurs des pilotes. Les pneus et les détails restent séparés. Les fichiers OBJ, ZIP, FBX, Blend et RAR d'origine sont conservés.

- **Géométrie :** 36 304 triangles au lieu de 205 876 ; quatre primitives et trois textures de 1 024 pixels maximum ; environ 1,25 Mo au total.
- **Repère :** axe vertical `+Y`, nez vers `+Z`, bas à `Y=0`, longueur normalisée à `5.6` unités d'affichage. Cette taille est un choix d'affichage. Le feu arrière source est à l'extrémité `+X`, ce qui confirme que le nez source est vers `-X`.
- **Chargement :** `/models/f1-2026.glb` avec le `GLTFLoader` local. Aucune extension Draco ou meshopt à décompresser au runtime. Partager la géométrie et les textures entre les vingt voitures, puis cloner uniquement les matériaux modifiés.
- **Traçabilité :** `manifest.json` contient les SHA-256 du GLB, de l'OBJ et de l'archive des textures, les tailles, transformations, comptages et résultat du validateur Khronos. La validation observe zéro erreur et zéro avertissement. Les deux informations concernent des UV inutilisés sur le feu arrière et une texture de roue carrée de 1 000 pixels.

Le propriétaire du dépôt a indiqué la recherche de modèles gratuits sur [CGTrader](https://www.cgtrader.com/search?free=1&keywords=F1). La fiche exacte, l'auteur et la licence du modèle n'ont pas été fournis. Un téléchargement gratuit ne confirme pas un droit de redistribution des fichiers. Vérifier la fiche et sa licence avant publication du modèle dans un dépôt partagé ; le manifeste conserve ce statut sans inventer d'attribution.

## Reproduire la préparation (auteur uniquement)

Préparer les dépendances frontend puis, depuis `scripts/model-tools/`, exécuter `npm.cmd ci`. Revenir à la racine et lancer :

```powershell
node scripts/prepare-model.mjs
```

Le script inspecte les chemins de `textures.zip` avant extraction dans `.cache/models/source/`, rejette les traversées de répertoires et les liens, conserve les matériaux et les UV pendant la simplification, puis valide le GLB. Il vérifie que l'OBJ et l'archive source n'ont pas changé avant d'écrire les résultats. Le rapport complet de validation est enregistré dans `.cache/models/validation.json`, ignoré par Git. Aucun fichier source n'est modifié.
