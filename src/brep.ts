/**
 * B-rep loading on the main thread.
 *
 * STEP / IGES / BREP files are parsed inside a Web Worker by occt-import-js
 * (OCCT 7.6.1 in WASM, vendored under public/occt/). The WASM is lazy:
 * the worker and the ~7.6 MB payload are only created when the first B-rep
 * file is opened, never on first page load.
 *
 * The worker tessellates into typed arrays (transferred, not copied) and
 * this module turns them into three.js meshes, keeping per-part colours
 * from the file (mesh colour, plus per-face colours via geometry groups).
 */

import * as THREE from 'three';
import type { LoadedModel } from './loaders';

export type BrepFormat = 'step' | 'iges' | 'brep';

export interface BrepFace {
  first: number;
  last: number;
  color: [number, number, number] | null;
}

export interface BrepMesh {
  name: string;
  path: string;
  color: [number, number, number] | null;
  positions: Float32Array;
  normals: Float32Array | null;
  index: Uint32Array;
  faces: BrepFace[];
}

export interface DeflectionParams {
  linearDeflectionType: 'bounding_box_ratio' | 'absolute_value';
  linearDeflection: number;
  angularDeflection: number;
}

/** UI-facing tessellation presets (OCCT defaults: ratio 0.001 / 0.5 rad). */
export const DEFLECTION_PRESETS: Record<string, { label: string; params: DeflectionParams }> = {
  coarse: {
    label: 'Coarse',
    params: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.005, angularDeflection: 0.9 },
  },
  medium: {
    label: 'Medium',
    params: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 },
  },
  fine: {
    label: 'Fine',
    params: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0002, angularDeflection: 0.2 },
  },
};

export const DEFAULT_DEFLECTION_KEY = 'medium';

const OCC_COLOR = 0x8fa3b8; // fallback when the file carries no colour

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let nextId = 1;

const pending = new Map<
  number,
  { resolve: (value: { meshes: BrepMesh[]; rootName: string }) => void; reject: (err: Error) => void }
>();

function occtAssetUrl(name: string): string {
  return new URL(`occt/${name}`, document.baseURI).href;
}

/** Create the worker and start the WASM download. Call only on B-rep open. */
export function ensureBrepWorker(): Promise<void> {
  if (workerReady) return workerReady;
  workerReady = new Promise<void>((resolve, reject) => {
    try {
      worker = new Worker(new URL('./brepWorker.ts', import.meta.url), { type: 'classic' });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const onInit = (event: MessageEvent) => {
      const msg = event.data as { type?: string; message?: string };
      if (msg.type === 'ready') {
        worker!.removeEventListener('message', onInit);
        resolve();
      } else if (msg.type === 'error') {
        worker!.removeEventListener('message', onInit);
        reject(new Error(msg.message || 'OCCT worker failed to initialise'));
      }
    };
    worker.addEventListener('message', onInit);
    worker.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data as { type?: string; id?: number; message?: string; meshes?: BrepMesh[]; rootName?: string };
      if (msg.type === 'result' && typeof msg.id === 'number') {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.resolve({ meshes: msg.meshes || [], rootName: msg.rootName || '' });
        }
      } else if (msg.type === 'error' && typeof msg.id === 'number') {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.reject(new Error(msg.message || 'OCCT parse failed'));
        }
      }
    });
    worker.addEventListener('error', (event) => {
      reject(new Error(`OCCT worker error: ${event.message || 'unknown'}`));
    });
    worker.postMessage({
      type: 'init',
      jsUrl: occtAssetUrl('occt-import-js.js'),
      wasmUrl: occtAssetUrl('occt-import-js.wasm'),
    });
  });
  return workerReady;
}

export async function parseBrep(
  format: BrepFormat,
  buffer: ArrayBuffer,
  params: DeflectionParams,
): Promise<{ meshes: BrepMesh[]; rootName: string }> {
  await ensureBrepWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage(
      {
        type: 'parse',
        id,
        format,
        buffer,
        params: { linearUnit: 'millimeter', ...params },
      },
      [buffer],
    );
  });
}

function colorToHex(rgb: [number, number, number] | null): number {
  if (!rgb) return OCC_COLOR;
  const [r, g, b] = rgb;
  return new THREE.Color(THREE.MathUtils.clamp(r, 0, 1), THREE.MathUtils.clamp(g, 0, 1), THREE.MathUtils.clamp(b, 0, 1)).getHex();
}

/**
 * Turn worker meshes into a LoadedModel. Per-face colours become geometry
 * groups so each face range renders in its own material; faces without a
 * colour fall back to the mesh colour.
 */
export function brepToModel(
  parsed: { meshes: BrepMesh[]; rootName: string },
  formatLabel: string,
): LoadedModel {
  const group = new THREE.Group();
  group.name = parsed.rootName || formatLabel;
  const meshes: LoadedModel['meshes'] = [];
  let triangles = 0;
  let vertices = 0;

  for (const part of parsed.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    if (part.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(new THREE.BufferAttribute(part.index, 1));

    const materials: THREE.MeshStandardMaterial[] = [
      new THREE.MeshStandardMaterial({ color: colorToHex(part.color), metalness: 0.15, roughness: 0.55 }),
    ];
    const materialIndexByColor = new Map<string, number>();
    const triCount = part.index.length / 3;
    let groupsCover = 0;
    for (const face of part.faces) {
      const faceTris = face.last - face.first + 1;
      if (faceTris <= 0) continue;
      groupsCover += faceTris;
      if (!face.color) {
        geometry.addGroup(face.first * 3, faceTris * 3, 0);
        continue;
      }
      const key = face.color.join(',');
      let matIdx = materialIndexByColor.get(key);
      if (matIdx === undefined) {
        matIdx = materials.length;
        materialIndexByColor.set(key, matIdx);
        materials.push(
          new THREE.MeshStandardMaterial({ color: colorToHex(face.color), metalness: 0.15, roughness: 0.55 }),
        );
      }
      geometry.addGroup(face.first * 3, faceTris * 3, matIdx);
    }
    // Only keep the groups if they exactly partition the mesh; otherwise
    // a single material avoids half-coloured geometry.
    if (groupsCover !== triCount) geometry.clearGroups();

    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.name = part.path || part.name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);

    meshes.push({ name: mesh.name, triangles: triCount, vertices: part.positions.length / 3 });
    triangles += triCount;
    vertices += part.positions.length / 3;
  }

  const unitsNote =
    formatLabel === 'BREP'
      ? 'BREP carries no unit — treated as mm'
      : `${formatLabel} units converted to mm by the reader`;
  return { object: group, meshes, triangles, vertices, unitsNote };
}
