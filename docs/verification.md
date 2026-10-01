# Vérifications du 1er octobre 2026

La référence a été compilée et exécutée localement sur le port 5080. Ces résultats concernent ce checkout et les fixtures fournies.

| Contrôle | Résultat observé |
| --- | --- |
| Backend .NET 9 | Compilation sans erreur ; six groupes de self-tests métier et SQLite réussis. |
| API et fichiers statiques | Pages de départ/référence, bundle, GLB, catalogue, dix endpoints de course, ETag 304, classements et erreurs 400/404 vérifiés par `tests/Test-Api.ps1`. |
| Ingestion | Neuf tests réussis : pagination, précision des temps, déduplication, sous-échantillonnage et trous. |
| Provenance et reproductibilité | 56 réponses sources vérifiées par SHA-256 ; reconstruction depuis le cache raw local byte-identique pour les 15 JSON générés. Le cache raw n'est pas distribué. |
| Championnat | Les totaux de tous les pilotes concordent avec la saison source 2024, dont 437 / 374 / 356 points pour les trois premiers. |
| Frontend | Neuf tests réussis : interpolation bornée, compteur de tours et sept contrôles géométriques de la piste ; bundle Vite construit. |
| Piste plate | Asphalte, lignes de bord, vibreurs de virage, accotements et départ damier. Sur les deux traces réelles : aucune coordonnée/normale/UV non finie, aucun triangle vers le bas ; largeur constante à moins de 4,5 × 10⁻⁶ unité. |
| Modèle 3D | GLB de 1 246 080 octets, 36 304 triangles, trois textures embarquées, aucune URI externe. Khronos glTF Validator : zéro erreur et zéro avertissement ; deux informations documentées dans le manifeste. |
| Navigateur desktop | Deux courses, modèle et teintes des écuries, sélection de pilote, lecture/pause, curseur au clavier, caméras orbitale/suivi/embarquée. Aucun message console d'erreur ou d'avertissement lors du contrôle du modèle. |
| Graphiques | Barèmes 2024, 2010 et custom, animation de saison, rejet d'un custom invalide, courbes de positions et arrêts aux stands vérifiés dans le navigateur. |
| Mobile, 390 × 844 | Replay et contrôles, championnat custom et stratégie vérifiés. Aucun débordement horizontal de la page ; le bump chart défile dans son propre conteneur. |

La vérification visuelle a révélé une étiquette de pilote trop grande en caméra embarquée. Elle est maintenant masquée dans cette vue. La caméra de suivi cadre la monoplace entière. Le tube de piste initial a été remplacé par une chaussée plate avec asphalte et vibreurs, puis contrôlé dans les trois caméras. Les contenus et contrôles restent visibles sans animation d'entrée ; le mouvement réduit désactive les transitions et le démarrage automatique du replay.

L'interface utilise un même système visuel : surfaces vert noir, accent lime pour les commandes et les sélections, couleurs d'écurie pour les données, police système et chiffres en chasse fixe. Le circuit constitue la vue principale ; les autres éléments servent la lecture de la course. Les états de focus, erreurs de barème et changements de vue ont été contrôlés. Aucune conformité d'accessibilité exhaustive ni mesure de fréquence d'images sur les machines des participants n'est revendiquée.

Les deux courses contiennent 855 807 observations brutes, ramenées à 210 460 échantillons. Les positions OpenF1 sont approximatives. Le modèle 2026 et ses teintes illustrent les courses 2024 ; la taille des voitures est un choix d'affichage. La largeur, les accotements et les vibreurs sont illustratifs ; le tracé conserve le tour fourni et son `z` approximatif. Les données, le bundle et le GLB sont locaux. La préparation NuGet doit être faite avant de travailler hors ligne ; le lancement n'appelle aucune API distante.

La fiche CGTrader exacte et la licence du modèle restent à identifier avant sa publication. Voir [sources](sources.md) et [manifeste du modèle](../wwwroot/models/manifest.json).
