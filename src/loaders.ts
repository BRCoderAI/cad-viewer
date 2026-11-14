// three.js loader dispatch for the M1 mesh formats.
//
// Each loader gets an ArrayBuffer (and, for OBJ, the sibling .mtl text
// when it was supplied alongside). The result is a three.js Object3D
// plus per-mesh statistics used by the part list.

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { AMFLoader } from 'three/addons/loaders/AMFLoader.js';

export interface MeshStat {
  name: string;
  triangles: number;
  vertices: number;
}

export interface LoadedModel {
  object: THREE.Object3D;
  meshes: MeshStat[];
  triangles: number;
  vertices: number;
  /** How the displayed mm size was derived (shown in the file panel). */
  unitsNote: string;
}

const UNITS_ASSUMED_MM = 'assumed mm — mesh formats carry no unit';
const UNITS_GLTF_METRES = 'glTF stores metres (spec) — scaled ×1000 to mm';

const DEFAULT_COLOR = 0x8fa3bf;

let dracoLoader: DRACOLoader | null = null;
function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    // Decoder files are copied into public/draco at scaffold time
    // (three/examples/jsm/libs/draco/gltf). BASE_URL keeps this correct
    // when the app is served from a sub-path (e.g. GitHub Pages).
    dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  }
  return dracoLoader;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return index.count / 3;
  const pos = geometry.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

/** Give loader-produced geometry a consistent, inspectable look. */
function normaliseMaterials(object: THREE.Object3D, defaultColor: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const material = child.material as THREE.Material | THREE.Material[];
    const mats = Array.isArray(material) ? material : [material];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.metalness = Math.min(mat.metalness, 0.25);
        mat.roughness = Math.max(mat.roughness, 0.35);
      }
    }
    // STL/PLY/AMF arrive with no material of their own — use a flat default.
    if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
      child.material = new THREE.MeshStandardMaterial({ color: defaultColor, metalness: 0.1, roughness: 0.6 });
    }
    child.castShadow = false;
    child.receiveShadow = false;
  });
}

function collectStats(object: THREE.Object3D): { meshes: MeshStat[]; triangles: number; vertices: number } {
  const meshes: MeshStat[] = [];
  let triangles = 0;
  let vertices = 0;
  let i = 0;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    const tris = Math.round(triangleCount(geometry));
    const verts = geometry.getAttribute('position')?.count ?? 0;
    const name = child.name || `Part ${++i}`;
    child.name = name;
    meshes.push({ name, triangles: tris, vertices: verts });
    triangles += tris;
    vertices += verts;
  });
  return { meshes, triangles, vertices };
}

function wrap(object: THREE.Object3D, unitsNote: string = UNITS_ASSUMED_MM): LoadedModel {
  normaliseMaterials(object, DEFAULT_COLOR);
  const stats = collectStats(object);
  return { object, ...stats, unitsNote };
}

async function loadStl(buffer: ArrayBuffer): Promise<LoadedModel> {
  const geometry = new STLLoader().parse(buffer);
  return wrap(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, metalness: 0.1, roughness: 0.6 })));
}

async function loadObj(buffer: ArrayBuffer, mtlText: string | null): Promise<LoadedModel> {
  const text = new TextDecoder('utf-8').decode(buffer);
  const loader = new OBJLoader();
  if (mtlText) {
    const materials = new MTLLoader().parse(mtlText, '');
    materials.preload();
    loader.setMaterials(materials);
  }
  return wrap(loader.parse(text));
}

async function loadGltf(buffer: ArrayBuffer, file: File, siblings: File[]): Promise<LoadedModel> {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  let gltf;
  if (file.name.toLowerCase().endsWith('.gltf')) {
    // A .gltf (JSON) file references its binary buffer (and possibly
    // textures) by relative URI. When the file was dropped, those
    // siblings are File objects, not URLs — rewrite the URIs to Blob
    // URLs so the loader can resolve them without a server.
    const json = JSON.parse(new TextDecoder('utf-8').decode(buffer)) as {
      buffers?: { uri?: string }[];
    };
    const blobUrls: string[] = [];
    for (const buf of json.buffers ?? []) {
      const uri = buf.uri;
      if (uri && !uri.startsWith('data:')) {
        const name = uri.split('/').pop() ?? uri;
        const sibling = siblings.find((f) => f.name.toLowerCase() === name.toLowerCase());
        if (sibling) {
          const url = URL.createObjectURL(sibling);
          blobUrls.push(url);
          buf.uri = url;
        }
      }
    }
    try {
      gltf = await loader.parseAsync(JSON.stringify(json), '');
    } finally {
      for (const url of blobUrls) URL.revokeObjectURL(url);
    }
  } else {
    gltf = await loader.parseAsync(buffer, '');
  }
  // glTF units are metres by spec; the viewer works in mm throughout.
  gltf.scene.scale.setScalar(1000);
  return wrap(gltf.scene, UNITS_GLTF_METRES);
}

async function loadPly(buffer: ArrayBuffer): Promise<LoadedModel> {
  const geometry = new PLYLoader().parse(buffer);
  return wrap(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, metalness: 0.1, roughness: 0.6, vertexColors: !!geometry.getAttribute('color') })));
}

async function loadAmf(buffer: ArrayBuffer): Promise<LoadedModel> {
  return wrap(new AMFLoader().parse(buffer));
}

export async function loadModel(
  formatId: string,
  file: File,
  siblingFiles: File[],
): Promise<LoadedModel> {
  const buffer = await file.arrayBuffer();
  switch (formatId) {
    case 'stl':
      return loadStl(buffer);
    case 'obj': {
      const stem = file.name.replace(/\.[^.]+$/, '').toLowerCase();
      const mtl = siblingFiles.find(
        (f) => f.name.toLowerCase().endsWith('.mtl') && f.name.replace(/\.[^.]+$/, '').toLowerCase() === stem,
      );
      const mtlText = mtl ? await mtl.text() : null;
      return loadObj(buffer, mtlText);
    }
    case 'gltf':
      return loadGltf(buffer, file, siblingFiles);
    case 'ply':
      return loadPly(buffer);
    case 'amf':
      return loadAmf(buffer);
    default:
      throw new Error(`No loader for format "${formatId}"`);
  }
}
