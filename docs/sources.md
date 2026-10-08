# Sources, provenance et limites d'usage

Les fixtures associent leurs URL source, date de récupération et SHA-256 dans `sources`. Les champs observés dans `quality.json` indiquent la couverture réelle. Un hash identifie un fichier récupéré ; il n'authentifie pas la source et ne prouve pas l'exactitude sportive.

| Source | Usage dans le dépôt | Référence |
| --- | --- | --- |
| Jolpica | Résultats, positions en fin de tour, stands, sprints | [API](https://api.jolpi.ca/ergast/), [documentation du projet](https://github.com/jolpica/jolpica-f1/tree/main/docs) |
| OpenF1 | Sessions, pilotes, tours et localisation XYZ | [Documentation](https://openf1.org/docs/), [location](https://openf1.org/docs/#location) |
| Modèle de voiture fourni | Concept 2026 utilisé comme illustration générique des courses 2024 | [Fiche locale](../wwwroot/models/README.md), [recherche CGTrader indiquée par le propriétaire](https://www.cgtrader.com/search?free=1&keywords=F1) |
| Microsoft | SDK/runtime .NET 9 | [Cycle de support](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) |

OpenF1 décrit la localisation comme approximative, autour de 3,7 Hz, avec une origine arbitraire. Le dépôt utilise une cible de 1 Hz pour alléger le replay. Le repère n'est pas un système latitude/longitude/altitude ; le tracé et `z` conviennent à une visualisation pédagogique sans mesure topographique certifiée. L'historique depuis 2023 est accessible sans authentification ; l'accès live a des conditions distinctes. [Documentation OpenF1](https://openf1.org/docs/).

Jolpica fournit une position au passage de tour. Le bump chart montre cette granularité et les stands déclarés ; il ne reconstitue pas tous les dépassements. Le what-if recalcule les points avec les mêmes arrivées : il ne simule pas une stratégie ou une course différente.

Le GLB est dérivé du modèle fourni `F1+2026.obj`, avec les textures embarquées. Son [manifeste](../wwwroot/models/manifest.json) conserve hashes, transformations et validation. La recherche CGTrader est une origine **déclarée**, pas une fiche de modèle identifiée : l'auteur et la licence exacte restent inconnus (`license: unknown`). Le caractère gratuit n'établit pas un droit de redistribution ; la fiche locale conserve ce statut à vérifier avant publication du modèle.

Le site [OpenF1](https://openf1.org/) indique un usage éducatif, de recherche et non commercial, et affiche CC BY-NC-SA 4.0. Conserver l'attribution et consulter les conditions actuelles avant une redistribution ou un usage commercial. La [licence Apache 2.0 du code Jolpica](https://github.com/jolpica/jolpica-f1/blob/main/LICENSE) concerne son logiciel ; elle ne suffit pas à conclure que tous les droits sur les données et marques F1 sont transférés. Le dépôt ne revendique aucun droit sur ces données ou marques et n'est affilié ni à Formula 1 ni à la FIA.
