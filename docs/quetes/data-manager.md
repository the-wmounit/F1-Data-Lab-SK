# Quête data manager — une donnée explicable en dix minutes

**Mission.** Livrer une page de dictionnaire, cinq règles qualité et un schéma de lineage issus du code et des fichiers livrés. Les exemples dans `docs/` servent de guide ; vérifier leurs champs sur la version actuelle.

**Prompt de départ**

> Lis AGENTS.md, docs/data-contract.md, les outils d'ingestion, le code API et les fixtures de la première course. Sans modifier le code ni la donnée, produis un dictionnaire court avec champ, type, unité/repère, clé, origine et limite. Propose cinq règles mesurables et distingue celles exécutées de celles seulement recommandées. Trace le lineage Jolpica/OpenF1 → normalisation → JSON → cache SQLite → API → graphiques. Pour chaque chiffre, indique le fichier ou la commande qui le prouve. Ne confonds pas XYZ local et altitude calibrée, ni position de fin de tour et ordre instantané. Termine par les fichiers produits et git diff.

**Livrable.** Un Markdown d'une page et un schéma Mermaid lisible. Inclure une décision concrète : comment signaler une télémétrie absente sans inventer la trajectoire.

**Vérifications.**

- `driverId`, `number`, `sessionKey` et `(year, round)` ont des rôles distincts.
- `t` est exprimé depuis `originUtc` ; `x/y/z` portent une limite de précision et de repère.
- Chaque règle nomme sa granularité, son seuil et son traitement d'échec.
- Les sprints et le meilleur tour sont explicités dans le what-if.
- Les comptages sont observés sur les fixtures, datés et reliés à leur provenance ; aucun chiffre estimé ne devient une couverture confirmée.

**Budget.** Trois minutes pour lire, cinq pour produire, deux pour confronter à un JSON et restituer. Hors périmètre : glossaire F1 complet, catalogue externe et modification de données pour supprimer les anomalies.
