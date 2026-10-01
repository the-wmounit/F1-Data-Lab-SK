# Atelier F1 Data Lab — 30 minutes

L'atelier montre la boucle **comprendre → proposer → modifier → vérifier → relire**. Chaque trio choisit une quête et désigne une personne qui pilote, une qui relit et une qui vérifie.

## Préparer avant la séance

1. Installer le SDK .NET 9, restaurer les deux projets, lancer les self-tests. Node est requis uniquement si l'on reconstruit le frontend ou réimporte les sources.
2. Lancer le serveur sur le port 5080. Vérifier les deux courses, la référence avec le bundle déjà construit et le chargement de `/models/f1-2026.glb` avec ses textures embarquées.
3. Couper la connexion réseau et recharger `/`, `/reference/` et `/api/replay/2024/1`. Une restauration NuGet ou npm appartient à la préparation, pas à la démo hors ligne.
4. Ouvrir les fiches de quête et le contrat. Préparer les URL de départ et de secours dans deux onglets.
5. Vérifier dans **le client réellement utilisé** la présence et l'autorisation d'un navigateur piloté. Pour Codex, utiliser le navigateur disponible ou un outil de navigateur configuré ; pour Antigravity, vérifier sa configuration séparément. Aucun nom de produit ne garantit cette capacité.
6. Conserver un instantané Git relu. Préparer les [tags](tags-git.md) uniquement sur instruction explicite et après validation des arbres.

## Déroulé

| Minutes | Action | Preuve visible |
| --- | --- | --- |
| 0–3 | Ouvrir `/`, montrer les résultats. Annoncer le replay à construire. | Le tableau de départ fonctionne hors ligne. |
| 3–5 | Lire `AGENTS.md` / `CLAUDE.md`, demander un plan et montrer les fichiers de données. | Plan court avec contrat, risques et vérifications. |
| 5–14 | Prompt circuit 3D ; lancer ; ouvrir ; capturer ; corriger si le rendu pose un problème. | Tracé réel approximatif, voitures, lecture/pause et une capture. |
| 14–26 | Trois trios, une quête par trio, livrable réduit à dix minutes. | Animation, contrôle data, ou dictionnaire/lineage. |
| 26–30 | Comparer avant/après, relire le diff, rapporter preuves et limites. | Chaque trio montre une sortie et ce qui a été vérifié. |

## Prompt de démo

> Lis AGENTS.md, docs/data-contract.md et wwwroot/models/README.md, puis propose un plan court. À partir de GET /api/replay/2024/1, ajoute un circuit Three.js dans l'interface de départ : tracé issu du tour fourni, voitures à partir du GLB local /models/f1-2026.glb, lecture/pause, curseur temporel et caméra orbitale. Charge ce modèle une seule fois avec GLTFLoader, partage sa géométrie et ses textures puis clone les matériaux que tu teintes pour chaque pilote. Le modèle a +Y vertical et son nez vers +Z ; vérifie son orientation sur la trajectoire. Utilise les modules de wwwroot/vendor/three/ avec une importmap three et three/addons/ ; garde des sphères si le modèle échoue à charger. Conserve le fonctionnement hors ligne, les trous et les XYZ observés sans inventer d'altitude. Lance l'app, ouvre la page avec le navigateur disponible, examine une capture et corrige les problèmes visibles. Termine par les vérifications et git diff. Ne crée pas de commit ni de tag.

Le starter contient Three.js, GLTFLoader et le modèle prêt, sans l'implémentation finale. Ajouter l'importmap avant les scripts modules :

```html
<script type="importmap">
{
  "imports": {
    "three": "/vendor/three/three.module.js",
    "three/addons/": "/vendor/three/addons/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const gltf = await new GLTFLoader().loadAsync('/models/f1-2026.glb');
const carTemplate = gltf.scene;
// Cloner carTemplate pour chaque pilote et l'ajouter à la scène.
</script>
```

Aucun `npm install`, décodeur Draco/meshopt ni conversion ne sont nécessaires pour charger ce GLB. Ses 36 304 triangles et textures sont embarqués dans 1,25 Mo. Le concept 2026 sert d'illustration générique aux données 2024 ; la [fiche du modèle](../wwwroot/models/README.md) précise le repère et la provenance.

Si le navigateur piloté n'est pas disponible, le vérificateur humain réalise la boucle : recharger, observer le tracé et les voitures, essayer les commandes, capturer et transmettre un constat précis. Présenter ce contrôle comme manuel. Ne pas provoquer volontairement une erreur de circuit pour mettre en scène une correction.

## Résultat attendu à 14 minutes

Une scène exploitable suffit : circuit cadré, au moins une voiture GLB animée dans le bon sens, commandes utilisables et limites de données visibles. En cas d'échec du modèle, les sphères permettent de vérifier le replay. Les caméras de suivi et embarquée sont des améliorations facultatives pour la démo live. La référence finale à `/reference/` montre aussi le championnat animé et le bump chart ; les participants continuent leur quête dans l'interface de départ.

## Secours

Après deux minutes bloquées, ouvrir `/reference/` pour montrer le résultat attendu, puis expliquer le blocage avec son message exact. Cela ne nécessite ni changement Git ni réseau. Si des tags distincts ont été préparés, utiliser un clone séparé au tag `demo-fallback` ; ne pas écraser le travail des participants.

Le volume exact, la couverture temporelle et les trous sont lisibles dans `quality.json` et `/api/quality/{year}/{round}`. Un rendu fluide ne prouve pas la complétude de la course. Les fichiers raw distants ne sont pas nécessaires au lancement local.

## Restitution en 60 secondes par trio

1. Montrer le résultat.
2. Citer une preuve : capture, sortie de test ou mesure depuis les fixtures.
3. Montrer un morceau de `git diff` et nommer une limite encore présente.

Arrêter le serveur avec `Ctrl+C` en fin de séance. Pour un atelier après le 10 novembre 2026, préparer une migration de .NET 9 vers une version prise en charge. [Cycle de support Microsoft](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core).
