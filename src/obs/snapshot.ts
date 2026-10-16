// What the plugin hands the OBS page through the local server (src/obs/helper/BetterMVObs.cs, docs/OBS.md): a prepared
// song as one binary file, and where NetEase is playing as JSON (pushed to the page as server-sent events). In a song
// file the typed arrays (the envelopes, the cover's pixels, the stereo channels) follow a JSON header that has markers
// in their place; the cover travels as a data URL in the header.
import * as THREE from 'three';
import { coverTexture, type PreparedSong } from '../app/prepare.ts';
import { STYLES, type StyleId } from '../style/style.ts';

/** Bumped when the song file or the state changes shape: the page waits for data of its own version. */
export const OBS_VERSION = 2;
/** The local server's port unless the settings say otherwise. */
export const OBS_PORT = 32109;
const MAGIC = 0x31564d42; // "BMV1", little-endian

/** How the MV is arranged, as the MV page plans it (src/plugin/main.ts plan). */
export interface ObsPlan {
  style: StyleId | 'auto';
  /** Plates and looks turned off in the settings. */
  off: string[];
  /** Seconds this song's words show later (negative: earlier). */
  lyricDelay: number;
  seed: number;
}

export interface ObsState {
  v: number;
  /** The song NetEase is playing (shown on the waiting view while it is prepared); null when nothing plays. */
  song: { id: number; name: string; artists: string[]; cover: string } | null;
  /** Its song file on the server (GET /song/<file>), once prepared and sent; null until then. */
  file: string | null;
  plan: ObsPlan | null;
  /** NetEase's song time (seconds) at `at` (Date.now()), and whether it is playing. */
  t: number;
  at: number;
  playing: boolean;
  /** Seconds the sound is heard later than NetEase reports it (the latency setting): the picture waits it out. */
  delay: number;
}

const KINDS = {
  f32: Float32Array, f64: Float64Array, i8: Int8Array, i16: Int16Array, i32: Int32Array,
  u8: Uint8Array, u8c: Uint8ClampedArray, u16: Uint16Array, u32: Uint32Array,
} as const;
type Kind = keyof typeof KINDS;
const kindOf = (v: ArrayBufferView): Kind | null => {
  for (const [k, C] of Object.entries(KINDS)) if (v instanceof C) return k as Kind;
  return null;
};

/** The cover as a JPEG data URL, at its own size (the palette and the pixels the plates read travel exactly). */
function coverUrl(song: PreparedSong): string {
  const img = song.cover.image as HTMLImageElement | HTMLCanvasElement;
  const w = (img as HTMLImageElement).naturalWidth || img.width, h = (img as HTMLImageElement).naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.92);
}

/**
 * A prepared song as a song file: "BMV1", the header's length (u32), the header (JSON: the song with its typed arrays,
 * colours, style and non-finite numbers replaced by markers), zeros to an 8-byte boundary, then the arrays' bytes, each
 * at an 8-byte boundary (a song's stereo channels are some 20 MB; the Blob takes them without a copy into a string).
 */
export function songFile(song: PreparedSong): Blob {
  const parts: BlobPart[] = [];
  let size = 0;
  const styles = new Set<object>(Object.values(STYLES));
  const meta = JSON.stringify({ v: OBS_VERSION, song, coverUrl: coverUrl(song) }, function (this: any, key, value) {
    // (The holder's own value: JSON has already turned a THREE.Color into its hex by its toJSON.)
    const raw = this[key];
    if (raw instanceof THREE.Texture) return undefined;
    if (raw instanceof THREE.Color) return { $color: [raw.r, raw.g, raw.b] };
    if (raw && typeof raw === 'object' && styles.has(raw)) return { $style: (raw as { id: StyleId }).id };
    if (ArrayBuffer.isView(raw)) {
      const kind = kindOf(raw);
      if (!kind) return undefined;
      const at = size, bytes = new Uint8Array(raw.buffer as ArrayBuffer, raw.byteOffset, raw.byteLength);
      parts.push(bytes);
      size += bytes.byteLength;
      const pad = (8 - (size % 8)) % 8;
      if (pad) { parts.push(new Uint8Array(pad)); size += pad; }
      return { $bin: at, kind, length: (raw as unknown as { length: number }).length };
    }
    if (typeof raw === 'number' && !Number.isFinite(raw)) return { $num: String(raw) };
    return value;
  });
  const head = new TextEncoder().encode(meta);
  const lead = new Uint32Array([MAGIC, head.byteLength]);
  const pad = (8 - ((8 + head.byteLength) % 8)) % 8;
  return new Blob([lead, head, new Uint8Array(pad), ...parts], { type: 'application/octet-stream' });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('封面无法读取'));
    img.src = url;
  });
}

/** A song file back into the prepared song (its cover a texture again). */
export async function readSong(file: ArrayBuffer): Promise<PreparedSong> {
  const lead = new Uint32Array(file, 0, 2);
  if (lead[0] !== MAGIC) throw new Error('歌曲数据格式不符');
  const headEnd = 8 + lead[1], binAt = headEnd + ((8 - (headEnd % 8)) % 8);
  const meta = new TextDecoder().decode(new Uint8Array(file, 8, lead[1]));
  const doc = JSON.parse(meta, (_key, value) => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value.$color)) return new THREE.Color(value.$color[0], value.$color[1], value.$color[2]);
    if (typeof value.$style === 'string') return STYLES[value.$style as StyleId] ?? STYLES.pulse;
    if (typeof value.$bin === 'number') return new KINDS[value.kind as Kind](file, binAt + value.$bin, value.length);
    if (typeof value.$num === 'string') return Number(value.$num);
    return value;
  });
  if (doc.v !== OBS_VERSION) throw new Error('歌曲数据版本不符');
  const img = await loadImage(doc.coverUrl);
  return { ...doc.song, cover: coverTexture(img) } as PreparedSong;
}
