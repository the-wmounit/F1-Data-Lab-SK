# Instructions pour les agents

Ce dépôt est un atelier F1 local de 30 minutes. L'objectif est un résultat visible et vérifiable, avec une donnée traçable.

## Commencer

1. Lire `README.md`, `docs/data-contract.md` et la fiche de quête choisie.
2. Identifier les fichiers réellement servis : `/` est le départ ; `/reference/` est la référence finale.
3. Lire une petite portion des fixtures et les `quality.json`. Proposer un plan court avant un changement important.
4. Inspecter `git status` et préserver les modifications existantes. Travailler uniquement sur la quête demandée.

## Données et serveur

- Le serveur utilise uniquement les fixtures locales au runtime. Garder ce fonctionnement hors ligne.
- Les fichiers normalisés respectent le contrat v1, les temps UTC et les nombres JSON numériques.
- Ne pas inventer de points pour combler de longs trous. Un numéro de pilote se rapproche du `driverId` avec une identité vérifiée pour la session.
- OpenF1 expose des coordonnées locales approximatives. Conserver `z` et expliquer la transformation d'affichage ; ne pas annoncer une altitude mesurée.
- Jolpica donne la position au passage de tour. Ne pas transformer une position manquante en dernière position ni prolonger une ligne après abandon.
- Les sprints sont conservés dans le what-if. Les ex-aequo sont départagés par les places d'arrivée, puis une identité stable.
- Ne pas modifier les données source pour faire passer une validation. Documenter les anomalies.
- Avant de modifier les modèles 3D, lire `wwwroot/models/README.md` et `manifest.json`. Utiliser le GLB préparé, conserver les originaux et partager géométrie/textures entre voitures. Ne pas demander aux participants de générer ou convertir un modèle.

## Vérifier

- API / .NET : `dotnet build src/F1DataLab` puis `dotnet run --project tests/F1DataLab.SelfTest`.
- Frontend de référence : reconstruire avec les scripts npm de `frontend/package.json`, puis vérifier le bundle réellement servi.
- UI : lancer `dotnet run --project src/F1DataLab --urls http://localhost:5080`, ouvrir la bonne URL et examiner une capture avant/après. Vérifier lecture, pause, curseur, choix de course et largeur mobile si concernés.
- La disponibilité d'un navigateur piloté dépend du client et des permissions. Utiliser l'outil disponible ; sinon donner les étapes de contrôle manuel et annoncer que la vérification visuelle n'a pas été exécutée.
- À la fin, lire `git diff --stat` et `git diff`, puis rapporter résultat, preuves et limites. Arrêter les serveurs démarrés pour la vérification, sauf demande de les conserver.

## Garder la main

Les corrections locales et les vérifications nécessaires à la quête sont autorisées. Ne pas publier, pousser, créer des commits ou tags, déployer, ni supprimer des modifications de l'utilisateur sans instruction explicite. Ne pas utiliser `git add .`, `git reset --hard` ou `git clean`. Les scripts de préparation Git affichent d'abord une proposition relisible.
