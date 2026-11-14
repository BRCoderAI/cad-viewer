// Format detection and support registry.
//
// A file is identified by extension first; magic bytes are only consulted
// when there is no usable extension. B-rep formats (STEP/IGES/BREP) are
// parsed by OCCT in WASM inside a Web Worker (M2, see brep.ts).
// Proprietary formats are recognised by name so the UI can tell the user
// exactly what was refused and what to do instead.

export type FormatStatus = 'supported' | 'proprietary' | 'unknown';

export interface FormatInfo {
  id: string; // canonical id, e.g. 'stl', 'jt'
  label: string; // display name, e.g. 'STL', 'JT'
  status: FormatStatus;
  /** Message shown to the user when this format cannot be opened yet. */
  blockedMessage?: string;
}

const SUPPORTED: Record<string, string> = {
  stl: 'STL',
  obj: 'OBJ',
  gltf: 'glTF',
  glb: 'glTF (binary)',
  ply: 'PLY',
  amf: 'AMF',
  step: 'STEP',
  stp: 'STEP',
  iges: 'IGES',
  igs: 'IGES',
  brep: 'BREP',
  brp: 'BREP',
};

/** B-rep format id used by the OCCT worker: 'step' | 'iges' | 'brep'. */
export function brepFormatId(label: string): 'step' | 'iges' | 'brep' | null {
  if (label === 'STEP') return 'step';
  if (label === 'IGES') return 'iges';
  if (label === 'BREP') return 'brep';
  return null;
}

// Proprietary formats, by extension -> display name. The STEP workaround
// is the same for all of them (SCOPE.md §6).
const PROPRIETARY: Record<string, string> = {
  jt: 'JT',
  sldprt: 'SolidWorks part',
  sldasm: 'SolidWorks assembly',
  catpart: 'CATIA part',
  catproduct: 'CATIA product',
  prt: 'NX / Creo part',
  ipt: 'Inventor part',
  iam: 'Inventor assembly',
  par: 'Solid Edge part',
  psm: 'Solid Edge sheet metal',
  x_t: 'Parasolid',
  x_b: 'Parasolid (binary)',
  sat: 'ACIS',
  sab: 'ACIS (binary)',
  dwg: 'DWG',
  fbx: 'FBX',
  '3ds': '3DS',
};

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function formatFromExtension(ext: string): FormatInfo {
  if (ext in SUPPORTED) {
    const id =
      ext === 'glb'
        ? 'gltf'
        : ext === 'stp'
          ? 'step'
          : ext === 'igs'
            ? 'iges'
            : ext === 'brp'
              ? 'brep'
              : ext;
    return { id, label: SUPPORTED[ext], status: 'supported' };
  }
  if (ext in PROPRIETARY) {
    const label = PROPRIETARY[ext];
    return {
      id: ext,
      label,
      status: 'proprietary',
      blockedMessage:
        `${label} (.${ext}) is a proprietary format and is not supported.\n` +
        `Export STEP from your CAD system and open that instead.`,
    };
  }
  return { id: ext || 'unknown', label: ext ? `.${ext}` : 'unknown file', status: 'unknown' };
}

/** Best-effort magic-byte sniffing, used only when the name has no extension. */
export function sniffMagicBytes(head: Uint8Array, textHead: string): FormatInfo | null {
  // GLB binary: 'glTF' magic
  if (head.length >= 4 && head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46) {
    return { id: 'gltf', label: 'glTF (binary)', status: 'supported' };
  }
  // STEP: ISO-10303-21 header. BREP: DBRep_DrawableShape magic.
  if (textHead.startsWith('ISO-10303-21;')) {
    return { id: 'step', label: 'STEP', status: 'supported' };
  }
  if (textHead.startsWith('DBRep_DrawableShape')) {
    return { id: 'brep', label: 'BREP', status: 'supported' };
  }
  if (textHead.startsWith('ply')) {
    return { id: 'ply', label: 'PLY', status: 'supported' };
  }
  if (textHead.includes('<amf')) {
    return { id: 'amf', label: 'AMF', status: 'supported' };
  }
  if (/(^|\n)\s*(v\s|o\s|g\s|f\s)/.test(textHead) && !textHead.startsWith('solid')) {
    return { id: 'obj', label: 'OBJ', status: 'supported' };
  }
  if (textHead.startsWith('solid') && /facet\s+normal|endsolid/.test(textHead)) {
    return { id: 'stl', label: 'STL', status: 'supported' };
  }
  if (textHead.trimStart().startsWith('{') && textHead.includes('"asset"')) {
    return { id: 'gltf', label: 'glTF', status: 'supported' };
  }
  return null;
}

/** Identify a file: extension first, magic bytes as a fallback. */
export async function identifyFile(file: File): Promise<FormatInfo> {
  const ext = extensionOf(file.name);
  if (ext) return formatFromExtension(ext);
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const textHead = new TextDecoder('utf-8', { fatal: false }).decode(head);
  return sniffMagicBytes(head, textHead) ?? { id: 'unknown', label: 'unknown file', status: 'unknown' };
}
