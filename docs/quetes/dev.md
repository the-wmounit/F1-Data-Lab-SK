# Quête dev — une animation lisible en dix minutes

**Mission.** Ajouter à l'interface de départ une animation : championnat par barres **ou** positions tour par tour en SVG. Choisir une seule option. Le contrat et les endpoints existent ; `/reference/` permet de comparer le résultat.

**Prompt de départ**

> Lis AGENTS.md, docs/data-contract.md et les fichiers de l'interface de départ. Propose un plan en trois étapes puis ajoute un championnat animé avec GET /api/championship/2024 : curseur de manche, lecture/pause, transition de classement, barèmes 2024/2010/custom. Conserve les sprints, affiche le mode choisi et les erreurs API. Utilise les ressources locales, sans modifier l'API ni les données. Lance, ouvre et vérifie visuellement avec une capture lorsque le navigateur est disponible. Termine par git diff et les vérifications ; pas de commit.

**Variante bump chart.** Remplacer la mission du prompt par : « Dessine un SVG des positions avec `/api/laps/2024/1` et `/api/pits/2024/1` : tour en abscisse, P1 en haut, couleurs et légende pilotes, arrêt au stand marqué, choix de pilote. Coupe la ligne quand une position manque. »

**Livrable.** Un graphique visible dans `/`, un état vide/erreur compréhensible et un diff limité à l'interface.

**Vérifications.**

- Lire/pause et curseur changent réellement la manche ou le tour.
- Les labels gardent leur pilote après un changement de rang ; les points finaux correspondent à l'API du mode choisi.
- Bump : P1 est en haut ; un abandon n'est pas prolongé et un pit stop correspond au bon pilote/tour.
- Capturer à largeur bureau, puis vérifier les commandes à largeur réduite. Nommer la vérification manuelle si le navigateur automatisé est indisponible.

**Budget.** Deux minutes pour lire, six pour réaliser, deux pour vérifier et relire `git diff`. Extras hors périmètre : nouvelle bibliothèque de graphiques, authentification, appels API distants.
