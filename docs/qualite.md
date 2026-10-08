# Règles qualité et preuves

Les rapports `data/{year}/{round}/quality.json` sont produits à l'ingestion. `/api/quality/{year}/{round}` les sert avec les comptages globaux du cache. La colonne « réalisé » signifie que le contrôle est présent dans le code ; les sorties de tests d'une exécution doivent être conservées séparément pour attester sa réussite.

| Règle et granularité | Seuil / invariant | Réalisé dans le code | Traitement |
| --- | --- | --- | --- |
| JSON local, fichier | Objet JSON analysable | `DataStore.Import` | Échec et rollback de l'import complet. |
| Télémétrie, point | `[t,x,y,z]`, nombres finis ; `t >= 0` et strictement croissant par pilote | `DataStore.Normalize` | Échec et rollback ; doublons ou ordre inversé rejetés. |
| Réduction, seconde/pilote | Garder la première observation réelle de chaque bucket `floor(t)` | `sampleLocations` ; .NET exige `sampleHz=1` | Tri, déduplication de date, comptages ; aucun point créé pour une seconde absente. |
| Trou intérieur, pilote | Deux observations brutes séparées de **plus de 5 s** | `sampleLocations` | Ajouter `[from,to]` dans `gaps` avant réduction, conserver `maxGapSeconds`. |
| Réimport local, fichier | Même SHA-256 → aucune réécriture | `DataStore.Import` | `Unchanged` augmente ; transaction et clés primaires empêchent les doublons. Un fichier supprimé est retiré du cache avec cascade. |
| Circuit, tour observé | Tour >=5 ; durée entre 50 et 180 s ; >=100 points ; couverture de début/fin <=1 s ; aucun saut >1 s ; fermeture <=12 % de l'étendue X | `selectCircuit` | Écarter tour incomplet ou lié aux stands ; échouer si aucun tour valide, sans remplacement inventé. |
| Source, réponse cachée | Hash de la réponse brute et URL égaux à sa métadonnée | `CachedSource.get` | Refetch si autorisé ; erreur en mode `--offline`. Pagination Jolpica validée. |
| Championnat, barème | Valeurs finies >=0, ordre décroissant, maximum 30 positions | `ChampionshipCalculator.ParseScoring` | HTTP 400 pour requête invalide. |
| Saison livrée, championnat | 24 manches pour l'import 2024 | `ingestChampionship` | Échec si saison incomplète ; les tests confrontent aussi les cumuls 2024 aux points source. |

## Contrôles à compléter dans une quête

- Vérifier que les bornes par pilote couvrent la période attendue. Le code ne conclut pas automatiquement qu'une absence est un abandon.
- Valider l'identité numéro/pilote et le couple date/circuit pour chaque nouvelle session. Une date égale seule peut être insuffisante dans un jeu étendu.
- Confronter les compteurs à la somme des points de chaque pilote et aux tableaux SQL. Les comptages `cache` sont globaux.
- Une conservation à 1 Hz ne garantit pas un pas exact d'une seconde ni toutes les secondes présentes. Mesurer les buckets absents et les écarts, plutôt qu'inférer une couverture depuis le seul nombre de points.
- Aucun seuil de qualité numérique ne rend le repère XYZ géodésique. La précision latérale et les distances de dépassement restent limitées.

## Commandes de preuve

```powershell
dotnet run --project src/F1DataLab -- --import-only
dotnet run --project src/F1DataLab -- --import-only
dotnet run --project tests/F1DataLab.SelfTest
node --test scripts/ingest.test.mjs
```

Les deux premières commandes montrent `imported`/`unchanged` et les cardinalités, après restauration NuGet. Elles ne démarrent pas de serveur et ne contactent pas les sources distantes. Les self-tests .NET utilisent des jeux temporaires sous `.cache/selftests/`, notamment l'idempotence et le rollback ; les tests Node vérifient les transformations. Comparer la sortie, puis `git diff`.
