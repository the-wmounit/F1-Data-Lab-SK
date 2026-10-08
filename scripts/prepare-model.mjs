// Author-only preparation. The workshop loads wwwroot/models/f1-2026.glb directly.
// Run: npm ci --prefix scripts/model-tools; node scripts/prepare-model.mjs
// Original OBJ/ZIP/Blend/FBX files are never changed or deleted.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { OBJLoader } from '../frontend/node_modules/three/examples/jsm/loaders/OBJLoader.js';
import { Box3 } from '../frontend/node_modules/three/build/three.module.js';
import { MeshoptSimplifier } from './model-tools/node_modules/meshoptimizer/meshopt_simplifier.js';
import { MeshoptEncoder } from './model-tools/node_modules/meshoptimizer/meshopt_encoder.js';
import sharp from './model-tools/node_modules/sharp/dist/index.mjs';
import validator from './model-tools/node_modules/gltf-validator/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'wwwroot/models');
const sourceDir = path.join(root, '.cache/models/source');
const sourceFile = path.join(root, 'F1+2026.obj');
const textureArchive = path.join(root, 'textures.zip');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Check every entry before extraction; reject links and paths outside the cache.
const listing = execFileSync('tar.exe', ['-tf', textureArchive], { encoding: 'utf8' });
const verboseListing = execFileSync('tar.exe', ['-tvf', textureArchive], { encoding: 'utf8' });
for (const entry of listing.trim().split(/\r?\n/)) {
  if (!entry || path.isAbsolute(entry) || /^[a-z]:/i.test(entry) || entry.includes(':') || entry.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe archive path: ${entry}`);
  }
  const destination = path.resolve(sourceDir, entry);
  if (!destination.startsWith(sourceDir + path.sep)) throw new Error(`Archive path escapes cache: ${entry}`);
}
if (verboseListing.split(/\r?\n/).some(line => /^[lh]/.test(line))) throw new Error('Archive links are not accepted.');
await fs.mkdir(sourceDir, { recursive: true });
execFileSync('tar.exe', ['-xf', textureArchive, '-C', sourceDir]);

const source = await fs.readFile(sourceFile);
const textureArchiveHash = sha256(await fs.readFile(textureArchive));
const model = new OBJLoader().parse(source.toString('utf8'));
const originalBounds = new Box3().setFromObject(model);
const originalLength = originalBounds.max.x - originalBounds.min.x;
const scale = 5.6 / originalLength;
const centerX = (originalBounds.min.x + originalBounds.max.x) / 2;
const centerZ = (originalBounds.min.z + originalBounds.max.z) / 2;
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);

const json = {
  asset: { version: '2.0', generator: 'F1 Data Lab source OBJ + meshoptimizer', extras: { sourceModelYear: 2026, sourceLicense: 'unknown' } },
  scene: 0,
  scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
  images: [], textures: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  buffers: [{ byteLength: 0 }]
};
const chunks = [];
let binaryLength = 0;
const primitiveStats = [];
const exportedPositions = [];
function addBytes(bytes, target) {
  const padding = (4 - binaryLength % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); binaryLength += padding; }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const view = { buffer: 0, byteOffset: binaryLength, byteLength: buffer.length };
  if (target) view.target = target;
  chunks.push(buffer); binaryLength += buffer.length;
  return json.bufferViews.push(view) - 1;
}
function addAccessor(array, itemSize, componentType, target, includeBounds = false) {
  if (!array.every(Number.isFinite)) throw new Error('Non-finite model attribute');
  const accessor = { bufferView: addBytes(array, target), componentType, count: array.length / itemSize, type: { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3' }[itemSize] };
  if (includeBounds) {
    accessor.min = Array(itemSize).fill(Infinity); accessor.max = Array(itemSize).fill(-Infinity);
    for (let i = 0; i < array.length; i++) {
      const axis = i % itemSize;
      accessor.min[axis] = Math.min(accessor.min[axis], array[i]);
      accessor.max[axis] = Math.max(accessor.max[axis], array[i]);
    }
  }
  return json.accessors.push(accessor) - 1;
}
const textureNames = ['Livery.png', 'TyreSoft.png', 'WheelCovers.png'];
const sourceTextures = [];
for (const name of textureNames) {
  const bytes = await fs.readFile(path.join(sourceDir, 'textures', name));
  const metadata = await sharp(bytes).metadata();
  const resized = await sharp(bytes).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  json.images.push({ name, mimeType: 'image/png', bufferView: addBytes(resized) });
  json.textures.push({ sampler: 0, source: json.images.length - 1 });
  sourceTextures.push({ name, sha256: sha256(bytes), originalDimensions: [metadata.width, metadata.height], embeddedBytes: resized.length });
}
const materialDefinitions = {
  Livery: { name: 'Livery', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.2, roughnessFactor: 0.45 }, doubleSided: true },
  RearLight: { name: 'RearLight', pbrMetallicRoughness: { baseColorFactor: [1, 0.015, 0.01, 1], metallicFactor: 0, roughnessFactor: 0.5 }, emissiveFactor: [0.7, 0.01, 0], doubleSided: true },
  Wheels: { name: 'Wheels', pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true },
  WheelCovers: { name: 'WheelCovers', pbrMetallicRoughness: { baseColorTexture: { index: 2 }, metallicFactor: 0.15, roughnessFactor: 0.65 }, doubleSided: true }
};
const materials = new Map();
function getMaterial(name) {
  if (!materials.has(name)) {
    if (!materialDefinitions[name]) throw new Error(`Unexpected source material ${name}`);
    materials.set(name, json.materials.push(materialDefinitions[name]) - 1);
  }
  return materials.get(name);
}

for (const mesh of model.children) {
  if (!mesh.isMesh) continue;
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: position.count, materialIndex: 0 }];
  for (const group of groups) {
    const name = sourceMaterials[group.materialIndex].name;
    const positions = [], normals = [], uvs = [], indexList = [], vertices = new Map();
    for (let i = group.start; i < group.start + group.count; i++) {
      // Source nose is -X, Y-up. Rotate +90 degrees about Y: nose becomes +Z.
      const values = [(position.getZ(i) - centerZ) * scale, (position.getY(i) - originalBounds.min.y) * scale, -(position.getX(i) - centerX) * scale,
        normal.getZ(i), normal.getY(i), -normal.getX(i), uv.getX(i), 1 - uv.getY(i)];
      const key = values.map(value => Math.round(value * 1e6)).join(',');
      let vertex = vertices.get(key);
      if (vertex === undefined) {
        vertex = positions.length / 3; vertices.set(key, vertex);
        positions.push(...values.slice(0, 3)); normals.push(...values.slice(3, 6)); uvs.push(...values.slice(6));
      }
      indexList.push(vertex);
    }
    const positionArray = new Float32Array(positions);
    const attributeArray = new Float32Array(positionArray.length / 3 * 5);
    for (let i = 0; i < positionArray.length / 3; i++) attributeArray.set([...normals.slice(i * 3, i * 3 + 3), ...uvs.slice(i * 2, i * 2 + 2)], i * 5);
    const originalIndices = new Uint32Array(indexList);
    // Preserve UV/material boundaries. Never use sloppy simplification, which can remove thin wings.
    const targetCount = Math.max(120, Math.floor(originalIndices.length * 0.175 / 3) * 3);
    const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(originalIndices, positionArray, 3, attributeArray, 5, [0.02, 0.02, 0.02, 0.1, 0.1], null, targetCount, 0.004, ['Permissive']);
    const [remap, count] = MeshoptEncoder.reorderMesh(indices, true, false);
    const compactPosition = new Float32Array(count * 3), compactNormal = new Float32Array(count * 3), compactUv = new Float32Array(count * 2);
    for (let i = 0; i < remap.length; i++) {
      if (remap[i] === 0xffffffff) continue;
      compactPosition.set(positionArray.subarray(i * 3, i * 3 + 3), remap[i] * 3);
      compactNormal.set(normals.slice(i * 3, i * 3 + 3), remap[i] * 3);
      compactUv.set(uvs.slice(i * 2, i * 2 + 2), remap[i] * 2);
    }
    if (indices.some(index => index >= count)) throw new Error('Invalid compacted index');
    const finalIndices = count <= 65535 ? new Uint16Array(indices) : indices;
    const positionAccessor = addAccessor(compactPosition, 3, 5126, 34962, true);
    exportedPositions.push({ array: compactPosition, accessor: json.accessors[positionAccessor] });
    const primitive = { attributes: { POSITION: positionAccessor, NORMAL: addAccessor(compactNormal, 3, 5126, 34962), TEXCOORD_0: addAccessor(compactUv, 2, 5126, 34962) }, indices: addAccessor(finalIndices, 1, count <= 65535 ? 5123 : 5125, 34963), material: getMaterial(name) };
    const meshIndex = json.meshes.push({ name: `${mesh.name}_${name}`, primitives: [primitive] }) - 1;
    json.scenes[0].nodes.push(json.nodes.push({ name: `${mesh.name}_${name}`, mesh: meshIndex }) - 1);
    primitiveStats.push({ name: `${mesh.name}_${name}`, material: name, sourceTriangles: originalIndices.length / 3, triangles: indices.length / 3, vertices: count, relativeSimplificationError: error });
  }
}
// Simplification may remove the exact bottom-most tyre vertices. Ground the final mesh.
const finalBottom = Math.min(...exportedPositions.map(({ accessor }) => accessor.min[1]));
for (const { array, accessor } of exportedPositions) {
  for (let i = 1; i < array.length; i += 3) array[i] -= finalBottom;
  accessor.min[1] = Infinity; accessor.max[1] = -Infinity;
  for (let i = 1; i < array.length; i += 3) {
    accessor.min[1] = Math.min(accessor.min[1], array[i]); accessor.max[1] = Math.max(accessor.max[1], array[i]);
  }
}
const finalHeight = Math.max(...exportedPositions.map(({ accessor }) => accessor.max[1]));
json.buffers[0].byteLength = binaryLength;
const jsonBytes = Buffer.from(JSON.stringify(json));
const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
const binary = Buffer.concat([...chunks, Buffer.alloc((4 - binaryLength % 4) % 4)]);
const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binaryHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + binary.length, 8);
jsonHeader.writeUInt32LE(paddedJson.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, binary]);
const validation = await validator.validateBytes(new Uint8Array(glb), { uri: 'f1-2026.glb', maxIssues: 100 });
if (validation.issues.numErrors) throw new Error(`glTF validation failed: ${JSON.stringify(validation.issues)}`);
if (sha256(await fs.readFile(sourceFile)) !== sha256(source) || sha256(await fs.readFile(textureArchive)) !== textureArchiveHash) {
  throw new Error('Source content changed during preparation. No outputs written.');
}
const manifest = {
  schemaVersion: 1, file: 'f1-2026.glb', sha256: sha256(glb), bytes: glb.length,
  source: { filename: 'F1+2026.obj', sha256: sha256(source), bytes: source.length, modelYear: 2026, suppliedBy: 'repository owner', declaredPlatform: 'CGTrader', declaredSourceUrl: 'https://www.cgtrader.com/search?free=1&keywords=F1', exactListingUrl: null, provenanceNote: 'Repository owner identified CGTrader free-model search as the source; the exact listing and its license were not supplied.', texturesArchive: 'textures.zip', texturesArchiveSha256: textureArchiveHash },
  license: 'unknown', redistributionStatus: 'The source author and redistribution rights were not supplied with the files. Verify the original model license before publishing this model.',
  geometry: { triangles: primitiveStats.reduce((sum, primitive) => sum + primitive.triangles, 0), sourceTriangles: primitiveStats.reduce((sum, primitive) => sum + primitive.sourceTriangles, 0), vertices: primitiveStats.reduce((sum, primitive) => sum + primitive.vertices, 0), length: 5.6, width: (originalBounds.max.z - originalBounds.min.z) * scale, height: finalHeight, upAxis: 'Y', forwardAxis: '+Z', bottomY: 0, sourceBounds: { min: originalBounds.min.toArray(), max: originalBounds.max.toArray() }, sourceScale: scale, finalGroundingOffset: finalBottom, primitives: primitiveStats },
  bodyMaterials: ['Livery'], textures: sourceTextures,
  transformations: ['Source -X nose rotated +90 degrees around Y; origin centered lengthwise with bottom at Y=0.', 'Length normalized to 5.6 scene units; this is display scaling, not a measured physical dimension.', 'Vertices welded across matching position/normal/UV; primitives simplified independently with UV and normal weights.', 'Source textures resized to at most 1024px and embedded; UV V changed to 1-V to preserve OBJ image orientation.'],
  notes: ['This is the supplied F1 2026 concept mesh, used as a generic replay illustration for all drivers. It is not a verified 2024 team car.', 'The native blue FIA/F1 livery is retained. Team tinting may remove the Livery texture at runtime; original source files remain intact.', 'No Draco or meshopt runtime decoder is needed. Geometry and PNG textures are embedded in the GLB.'],
  preparedWith: { three: '0.180.0', meshoptimizer: '1.3.0', sharp: '0.35.5', gltfValidator: '2.0.0-dev.3.10' },
  validation: { validator: 'Khronos glTF Validator', errors: validation.issues.numErrors, warnings: validation.issues.numWarnings, infos: validation.issues.messages.filter(issue => issue.severity === 2), sourceIntegrityVerified: true }
};
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'f1-2026.glb'), glb);
await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.writeFile(path.join(root, '.cache/models/validation.json'), JSON.stringify(validation, null, 2) + '\n');
console.log(JSON.stringify({ file: 'wwwroot/models/f1-2026.glb', bytes: glb.length, triangles: manifest.geometry.triangles, sourceTriangles: manifest.geometry.sourceTriangles, vertices: manifest.geometry.vertices, primitives: primitiveStats }, null, 2));
