# Données pré-ingérées

Ces fichiers viennent de réponses réelles de **Jolpica F1** et **OpenF1**, récupérées le 1er octobre 2026. L'application lit ces JSON en local ; aucune connexion aux sources n'est requise pendant l'atelier.

| Course | Session OpenF1 | Observations téléchargées | Observations retenues à 1 Hz | Tours / timings Jolpica | Arrêts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bahreïn 2024, manche 1 | 9472 | 449 400 | 111 900 | 57 / 1 129 | 43 |
| Arabie saoudite 2024, manche 2 | 9480 | 406 407 | 98 560 | 50 / 900 | 19 |

Le championnat comprend **24 manches et les 6 sprints de 2024**. Les totaux officiels reconstitués incluent les points de course, le bonus du meilleur tour déjà présent dans ces points et les sprints séparés : Verstappen 437, Norris 374, Leclerc 356. Les résultats d'un Grand Prix peuvent compter moins de 20 pilotes.

Les données JSON servies représentent environ **5,9 Mo**, issus de **855 807 observations de position**. Le nombre brut inclut le début de session avant le départ ; le nombre retenu exclut ce début. Il ne faut pas annoncer 600 000 observations par course sur la base de ces deux courses.

## Ce que les positions représentent

[OpenF1 décrit `location`](https://openf1.org/docs/#location) comme une position approximative dans un repère cartésien local dont l'origine est arbitraire. Ce ne sont pas des coordonnées géographiques GPS calibrées. Le script conserve les valeurs `x`, `y` et `z` reçues, y compris le `z` relatif. Une variation de `z` ne constitue pas une mesure vérifiée d'altitude au-dessus du niveau de la mer. La position latérale sur la piste n'est pas précise.

Le tracé de Bahreïn provient du tour 5 de Verstappen ; celui de Djeddah du tour 6. Chaque tracé comporte 366 observations natives sur un tour complet, sans arrêt ni trou supérieur à une seconde. Le départ du replay utilise le `date_start` du premier tour OpenF1 du vainqueur ; la fin couvre le dernier tour classé terminé parmi tous les pilotes.

Le sous-échantillonnage conserve **une observation réellement reçue par tranche d'une seconde**, avec son temps relatif précis à la milliseconde. Il n'invente aucun point et ne remplit pas les secondes absentes. Les trous internes supérieurs à 5 secondes sont recherchés **avant** cette réduction. Aucun trou de cette durée n'a été observé sur ces deux courses ; les tests incluent un jeu synthétique clairement identifié pour vérifier cette règle.

Une voiture abandonnée peut encore recevoir des coordonnées stationnaires jusqu'à la fin : c'est visible pour Stroll et Gasly en Arabie saoudite. Un flux sans trou ne prouve donc pas que la voiture continue la course. Les durées d'arrêt Jolpica peuvent représenter un passage dans la voie des stands, et non le seul temps d'immobilisation. Les formats `25.954` et `1:14.773` sont convertis en secondes sans perte de précision.

## Provenance et cache

- `source-manifest.json` contient les **56 URL effectivement utilisées**, l'instant de récupération, la taille et le SHA-256 des octets de la réponse source.
- Chaque `replay.json` et `quality.json` reprend sa propre provenance.
- `raw/` contient les réponses originales et leurs métadonnées lors de l'ingestion. Ce cache volumineux est ignoré par Git.
- `samples/location-bahrain.json` contient 400 enregistrements originaux non modifiés, disponibles hors ligne après clonage. Son fichier de provenance donne le hash du sous-ensemble et celui de la réponse complète d'origine. Il sert aux exercices sur les champs natifs sans téléchargement.

Les empreintes permettent d'identifier les réponses utilisées. Une mise à jour distante peut légitimement changer les fichiers lors d'un `--refresh`.

## Commandes

Node.js 22 suffit ; aucun package npm n'est nécessaire pour l'ingestion.

```powershell
# Tests de transformation ; aucune connexion aux API
node --test scripts/ingest.test.mjs

# Vérifie les données pré-ingérées, leurs types, comptages et totaux de championnat
node scripts/verify-data.mjs

# Télécharge les réponses absentes du cache puis reconstruit les fichiers
node scripts/ingest.mjs

# Reconstruit sans réseau à partir du cache brut local déjà téléchargé
node scripts/ingest.mjs --offline

# Vérifie les hashes des réponses ET un deuxième passage byte-identique
node scripts/verify-data.mjs --raw --idempotence

# Actualise volontairement les sources distantes
node scripts/ingest.mjs --refresh

# Une seule course, sans recalculer le championnat
node scripts/ingest.mjs --rounds=1 --skip-championship
```

Sur un clone neuf, l'application, les tests et la vérification des données fonctionnent hors ligne. **La reconstruction complète avec `--offline` exige le cache `raw/`** ; il faut avoir exécuté l'ingestion en ligne auparavant ou conserver le cache de préparation de l'atelier. Le sous-ensemble original fourni dans `samples/` suffit aux exercices isolés.

OpenF1 est interrogé par fenêtres temporelles de 10 minutes, car une demande de toute la course est refusée pour volume excessif. Les requêtes sont espacées d'au moins 2,1 secondes pour respecter les [limites publiées](https://openf1.org/) de 30 par minute et 3 par seconde. Jolpica utilise la pagination de 100 lignes et fusionne les tours coupés entre deux pages. Les réponses 429 et 5xx sont réessayées avec attente ; un cache invalide est rejeté en mode hors ligne. Les écritures utilisent un fichier temporaire puis un renommage.

## Attribution

- [OpenF1 et sa documentation](https://openf1.org/docs/), source communautaire non officielle, positions et temps des tours.
- [Jolpica F1](https://github.com/jolpica/jolpica-f1), résultats, positions en fin de tour, arrêts aux stands et sprints. [Conditions d'utilisation de l'API](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md).

Les données et noms Formula 1 proviennent de ces sources ; leur inclusion pour l'atelier ne leur attribue pas la licence du code de ce dépôt. [Le site OpenF1](https://openf1.org/) affiche CC BY-NC-SA 4.0 et présente son usage éducatif. Les URL exactes de cette extraction sont conservées dans le manifeste.
