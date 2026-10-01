# F1 Data Lab — repères pour l'atelier

Les consignes communes sont dans [AGENTS.md](AGENTS.md). Les lire avant de travailler, avec [le contrat](docs/data-contract.md) et la fiche de quête.

- Projet : API .NET 9, fixtures locales Jolpica/OpenF1, cache SQLite, frontend Three.js local.
- Départ : `http://localhost:5080/` ; référence : `http://localhost:5080/reference/`.
- Lancer : `dotnet run --project src/F1DataLab --urls http://localhost:5080`.
- Vérifier : `dotnet build src/F1DataLab` et `dotnet run --project tests/F1DataLab.SelfTest`.
- Commencer par un plan court, lire le code et des données, puis réaliser une seule quête en dix minutes.
- Utiliser une capture du navigateur pour vérifier l'interface lorsque l'outil est disponible. Un build réussi ne prouve pas le rendu.
- Conserver les trous et la provenance ; les XYZ d'OpenF1 sont approximatifs, sans altitude calibrée.
- Finir par un résultat visible, les vérifications effectuées et `git diff`. Aucun commit, tag, push ou déploiement implicite.

Guide animateur : [docs/atelier.md](docs/atelier.md). Quêtes : [dev](docs/quetes/dev.md), [data engineer](docs/quetes/data-engineer.md), [data manager](docs/quetes/data-manager.md).
