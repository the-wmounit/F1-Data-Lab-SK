# Three.js hors ligne

Bibliothèque Three.js 0.180.0 (licence MIT jointe). Ces modules, préchargés depuis le paquet npm `three`, sont inclus dans le snapshot de départ pour construire le circuit sans accès au réseau. Ils ne contiennent aucune solution de l'atelier.

Dans une page HTML, ajouter avant tout script module :

```html
<script type="importmap">
{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/addons/"}}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const { scene: car } = await new GLTFLoader().loadAsync('/models/f1-2026.glb');
// Votre scène, vos données et vos contrôles.
</script>
```

La version finale utilise un bundle Vite précompilé, également servi sans CDN.
