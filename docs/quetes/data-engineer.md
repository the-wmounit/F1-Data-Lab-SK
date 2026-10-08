# Quête data engineer — un contrôle fiable en dix minutes

**Mission.** Rendre visible une preuve d'idempotence ou de gestion des trous sur les fixtures locales. Le téléchargement initial est un outil Node ; le serveur .NET charge les JSON normalisés dans SQLite. Ne pas lancer de nouvelle collecte distante pendant l'atelier.

**Prompt de départ**

> Lis AGENTS.md, docs/data-contract.md, le code de chargement/cache et un replay réel. Propose un plan court. Vérifie l'idempotence du chargement local : deux chargements identiques ne créent pas de doublons ni de données différentes. Ajoute un test utile sur un petit jeu temporaire, et un contrôle des timestamps croissants et des trous : un saut long doit rester signalé, sans point synthétique. Montre une sortie avec les comptages avant/après et le seuil réellement utilisé dans le code. Ne modifie pas les fixtures livrées et ne télécharge rien. Lance les vérifications et termine par git diff.

**Livrable.** Un test exécutable et un rapport court : clé d'identité, hash du fichier, nombre de lignes/points, trous détectés et résultat après deux chargements. Adapter le test à la granularité réelle du cache : une ligne JSON par ressource et un point télémétrique ne sont pas la même chose.

**Vérifications.**

- Deux chargements identiques produisent la même réponse et la même cardinalité.
- Un fichier modifié invalide la bonne entrée du cache ; une course différente reste isolée.
- Duplicat, temps inversé et trou long sont détectés dans le petit jeu de test.
- Le taux de sortie nominal est 1 Hz ; les périodes manquantes ne sont pas comptées comme observées.

**Budget.** Deux minutes de lecture, six d'implémentation, deux pour lancer et expliquer la preuve. Si tout existe déjà, améliorer le rapport et ajouter un cas limite utile. Une ingestion streaming complète, une migration cloud et une extrapolation de débit depuis une course sont hors périmètre.
