# Dictionnaire des données locales v1

Le contrat complet est dans [data-contract.md](data-contract.md). Ce dictionnaire décrit les champs utilisés par les transformations de `scripts/ingest.mjs`, `src/F1DataLab/DataStore.cs` et `ChampionshipCalculator.cs`. Les champs JSON sont en camelCase, les nombres sont numériques.

| Champ / ressource | Type et granularité | Sens, origine, limite |
| --- | --- | --- |
| `year`, `round` | Entiers ; course | Saison et manche Jolpica. Ensemble, ils identifient la course locale. |
| `sessionKey` | Entier ; session | Identifiant OpenF1 de la session Race. Rapprochée par date, avec métadonnées de circuit à vérifier. |
| `driverId` | Texte ; pilote | Identité Jolpica stable utilisée pour les jointures locales et le classement. |
| `number` | Entier ; pilote dans une session/saison | Numéro pour le rapprochement avec `driver_number` OpenF1. Il n'est pas une identité permanente universelle. |
| `code`, `name`, `team`, `color` | Texte ; résultat/session | Libellés Jolpica et couleur OpenF1 quand disponible ; sinon palette locale. Dans le championnat, l'équipe affichée est la dernière observée. |
| `position`, `grid`, `laps` dans résultats | Entiers ; pilote/course | Place finale, position de grille et tours complétés. `position` seul ne prouve pas l'éligibilité aux points. `grid=0` ne représente pas une P0. |
| `points`, `status`, `fastestLapRank` | Nombre, texte, entier nullable ; résultat | Points officiels source, statut sportif et rang du meilleur tour. Le rang peut être absent. |
| `lap`, `timings[].position` | Entiers ; pilote/tour | Tour et position lors de son passage dans Jolpica. Ne donnent pas l'ordre à chaque seconde. |
| `timings[].timeSeconds` | Nombre ; secondes par tour | Temps Jolpica converti depuis une chaîne `m:ss.sss`. Une chaîne non analysable produit `null` dans l'outil puis est rejetée à l'import .NET. |
| `stops[].lap`, `stop` | Entiers ; arrêt/pilote | Tour de l'arrêt et numéro d'arrêt ; clé locale `(driverId, stop)` dans une ressource. |
| `durationSeconds`, `time` des stands | Nombre en secondes, texte heure source | Durée déclarée Jolpica et heure source. La durée peut correspondre au passage dans les stands, sans isoler le changement de pneus immobile. |
| `originUtc`, `durationSeconds` | ISO 8601 UTC, nombre en secondes ; replay | Origine prise au début du premier tour du vainqueur ; fin limitée aux derniers tours complétés des pilotes et à la session. Pas toute la période formation/refroidissement. |
| `sampleHz` | Nombre ; replay | Cible nominale `1`. Une observation réelle est gardée dans chaque bucket de seconde ; les timestamps ne sont pas forcés à des secondes entières. |
| `drivers[].points[][0]` (`t`) | Nombre ; secondes depuis `originUtc` | Horodatage exact d'une observation gardée, arrondi à la milliseconde. Croissant, positif ou nul par pilote. |
| `points[][1..3]` (`x,y,z`) | Nombres ; repère cartésien local OpenF1 | Coordonnées approximatives conservées. Origine arbitraire ; aucune latitude/longitude ni altitude calibrée garantie. |
| `gaps[].from`, `to` | Nombres en secondes ; pilote | Intervalle intérieur entre observations brutes consécutives, signalé si le saut dépasse **5 s**. Les absences au début/à la fin sont documentées par les bornes par pilote. |
| `circuit.driverId`, `lap`, `points` | Texte, entier, tuples XYZ ; tour | Un tour complet observé du vainqueur, sélectionné hors passage aux stands avec critères de continuité et fermeture. Pas un plan officiel du circuit. |
| `sources[].url`, `fetchedAt`, `sha256`, `bytes` | Texte, UTC, hexadécimal, entier ; réponse source | URL exacte, récupération, hash et volume de la réponse brute. `source-manifest.json` rassemble les réponses répertoriées. |
| `quality.rawPoints`, `racePoints`, `sampledPoints` | Entiers ; course | Réponses brutes de localisation, observations uniques dans les bornes, puis échantillons gardés. Ce sont trois granularités distinctes. |
| `quality.gapCount`, `maxGapSeconds` | Entier et secondes ; course | Nombre de sauts intérieurs >5 s et maximum observé avant réduction. Zéro trou déclaré ne signifie pas chaque seconde couverte. |
| `quality.drivers[].firstSampleSeconds`, `lastSampleSeconds` | Nombres nullable ; pilote | Première et dernière observation gardée ; absence potentielle liée à disponibilité capteur ou abandon, sans diagnostic automatique. |
| `frames[].standings[].points`, `rank` | Nombre, entier ; pilote/manche | Cumul recalculé et ordre animé. Points des sprints conservés ; bonus meilleur tour uniquement en mode 2024 pour un pilote éligible dans les dix premiers. |

## Cache SQLite

La base générée par défaut est `.cache/f1.sqlite`, exclue de Git. `datasets` conserve le JSON et son SHA-256 par chemin relatif. Les tableaux normalisés ne contiennent pas tous les attributs d'affichage ; l'API sert le JSON complet conservé.

| Table | Clé primaire | Rôle |
| --- | --- | --- |
| `datasets` | `path` | Snapshot JSON, hash et `imported_utc`. |
| `race_results` | `(source_path, round, sprint, driver_id)` | Résultats course et sprint ; une même course peut apparaître dans le JSON dédié et celui du championnat, distingués par source. |
| `lap_timings` | `(source_path, lap, driver_id)` | Places et temps par passage de tour. |
| `pit_stops` | `(source_path, driver_id, stop)` | Arrêts et durée. |
| `telemetry` | `(source_path, driver_id, t)` | Observations XYZ réduites, indexées par saison/manche/pilote/temps. |

`/api/quality/{year}/{round}` ajoute un bloc `cache` dont les comptages couvrent **toutes les fixtures importées**, et non la seule course demandée. Le what-if est calculé depuis le JSON du championnat ; il n'additionne pas les lignes SQL des sources dédiées en double.
