/// <reference lib="webworker" />
/**
 * B-rep parsing worker.
 *
 * Loads occt-import-js (OCCT in WASM) lazily and tessellates STEP / IGES /
 * BREP files into triangle meshes. The WASM is only fetched when a B-rep
 * file is opened, never on first page load.
 *
 * Protocol (main thread <-> this worker):
 *   main -> { type: 'init', jsUrl, wasmUrl }
 *   worker -> { type: 'ready' } | { type: 'error', message }
 *   main -> { type: 'parse', id, format: 'step' | 'iges' | 'brep',
 *             buffer: ArrayBuffer (transferred), params }
 *   worker -> { type: 'result', id, meshes: BrepMesh[], rootName }
 *           | { type: 'error', id, message }
 *
 * BrepMesh (per mesh, typed arrays transferred, not copied):
 *   { name, path, color: [r,g,b] | null,
 *     positions: Float32Array, normals: Float32Array | null,
 *     index: Uint32Array, faces: [{ first, last, color }] }
 * `path` is the assembly path (e.g. "Micro Servo / Housing") built by
 * walking the OCCT result tree; `faces` are the per-face triangle ranges
 * with their own colours (null = use the mesh colour).
 */

interface ImportParams {
  linearUnit?: string;
  linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
  linearDeflection?: number;
  angularDeflection?: number;
}

interface ParseMessage {
  type: 'parse';
  id: number;
  format: 'step' | 'iges' | 'brep';
  buffer: ArrayBuffer;
  params: ImportParams;
}

interface InitMessage {
  type: 'init';
  jsUrl: string;
  wasmUrl: string;
}

type Incoming = InitMessage | ParseMessage;

interface BrepFace {
  first: number;
  last: number;
  color: [number, number, number] | null;
}

interface BrepMesh {
  name: string;
  path: string;
  color: [number, number, number] | null;
  positions: Float32Array;
  normals: Float32Array | null;
  index: Uint32Array;
  faces: BrepFace[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let occtApi: any = null;
let initPromise: Promise<void> | null = null;
let occtJsUrl = '';
let occtWasmUrl = '';

function loadOcct(jsUrl: string, wasmUrl: string): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // classic worker: importScripts puts occtimportjs on the global scope.
    importScripts(jsUrl);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory = (self as unknown as { occtimportjs: (overrides: unknown) => Promise<any> }).occtimportjs;
    if (typeof factory !== 'function') {
      throw new Error('occt-import-js.js loaded but occtimportjs() is not available');
    }
    occtApi = await factory({
      locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
    });
    if (!occtApi || typeof occtApi.ReadFile !== 'function') {
      throw new Error('OCCT WASM initialised but ReadFile is missing');
    }
  })();
  return initPromise;
}

function toColor(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [r, g, b] = value as number[];
  if (![r, g, b].every((v) => Number.isFinite(v))) return null;
  return [r, g, b];
}

/** Walk the OCCT result tree and record the assembly path of each mesh. */
function buildMeshPaths(root: unknown): string[] {
  const paths: string[] = [];
  const walk = (node: Record<string, unknown> | null, prefix: string): void => {
    if (!node || typeof node !== 'object') return;
    const name = typeof node.name === 'string' ? node.name.trim() : '';
    const here = name ? (prefix ? `${prefix} / ${name}` : name) : prefix;
    const meshIndices = Array.isArray(node.meshes) ? node.meshes : [];
    for (const idx of meshIndices) {
      if (typeof idx === 'number' && Number.isFinite(idx)) paths[idx] = here;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) walk(child as Record<string, unknown>, here);
  };
  walk(root as Record<string, unknown>, '');
  return paths;
}

function convertResult(result: Record<string, unknown>): { meshes: BrepMesh[]; rootName: string; transfer: Transferable[] } {
  const rawMeshes = Array.isArray(result.meshes) ? result.meshes : [];
  const paths = buildMeshPaths(result.root);
  const rootName = (result.root as Record<string, unknown>)?.name as string | undefined || '';
  const meshes: BrepMesh[] = [];
  const transfer: Transferable[] = [];

  for (let i = 0; i < rawMeshes.length; i++) {
    const raw = rawMeshes[i] as Record<string, unknown>;
    const attrs = (raw.attributes || {}) as Record<string, unknown>;
    const pos = attrs.position as { array?: number[] } | undefined;
    const nor = attrs.normal as { array?: number[] } | undefined;
    const idx = raw.index as { array?: number[] } | undefined;
    const posArray = Array.isArray(pos?.array) ? pos.array : [];
    const norArray = Array.isArray(nor?.array) ? nor.array : [];
    const idxArray = Array.isArray(idx?.array) ? idx.array : [];
    if (posArray.length === 0 || idxArray.length === 0) continue;

    const positions = new Float32Array(posArray);
    const normals = norArray.length === posArray.length ? new Float32Array(norArray) : null;
    const index = new Uint32Array(idxArray);
    transfer.push(positions.buffer);
    if (normals) transfer.push(normals.buffer);
    transfer.push(index.buffer);

    const faces: BrepFace[] = [];
    const rawFaces = Array.isArray(raw.brep_faces) ? raw.brep_faces : [];
    for (const f of rawFaces) {
      const face = f as Record<string, unknown>;
      const first = typeof face.first === 'number' ? face.first : 0;
      const last = typeof face.last === 'number' ? face.last : -1;
      if (last >= first) faces.push({ first, last, color: toColor(face.color) });
    }
    faces.sort((a, b) => a.first - b.first);

    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Part ${i + 1}`;
    meshes.push({
      name,
      path: paths[i] || name,
      color: toColor(raw.color),
      positions,
      normals,
      index,
      faces,
    });
  }
  return { meshes, rootName, transfer };
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      occtJsUrl = msg.jsUrl;
      occtWasmUrl = msg.wasmUrl;
      await loadOcct(occtJsUrl, occtWasmUrl);
      self.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'parse') {
      if (!occtJsUrl) throw new Error('worker received parse before init');
      await loadOcct(occtJsUrl, occtWasmUrl);
      const result = occtApi.ReadFile(msg.format, new Uint8Array(msg.buffer), msg.params || null);
      if (!result || result.success !== true) {
        throw new Error(`OCCT could not parse this ${msg.format.toUpperCase()} file (success=false)`);
      }
      const converted = convertResult(result as Record<string, unknown>);
      const out = { type: 'result', id: msg.id, meshes: converted.meshes, rootName: converted.rootName };
      self.postMessage(out, converted.transfer);
      return;
    }
    throw new Error(`unknown worker message type: ${(msg as { type?: string }).type}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const id = (msg as { id?: number }).id;
    self.postMessage({ type: 'error', id, message });
  }
};
