// The downloaded MV's file put together. MediaRecorder (the only video encoder in NetEase's Chromium 91) writes a live
// WebM stamped with the moments frames reached it; the MV is rendered faster than real time, so those times mean
// nothing: the frames are read out of the WebM as it comes (WebmReader) and written into an MP4 at their place in the
// song, beside the song's audio as MP3 (mp3Frames). The MP4 is made in memory: ftyp, moov (in front, so a player can
// start before it has read the whole file), then mdat, the samples interleaved a second at a time.

// ---- WebM, as MediaRecorder writes it ----

export interface EncodedFrame {
  /** Where the frame's bytes are in the whole stream, and how many. */
  offset: number;
  size: number;
  key: boolean;
  /** Its time in the stream, ms (when it reached the recorder). */
  time: number;
}

const ID = {
  EBML: 0x1a45dfa3, SEGMENT: 0x18538067, INFO: 0x1549a966, TRACKS: 0x1654ae6b, CLUSTER: 0x1f43b675, TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3, BLOCK_GROUP: 0xa0, BLOCK: 0xa1, TIMECODE_SCALE: 0x2ad7b1, TRACK_ENTRY: 0xae, TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83, CODEC_ID: 0x86, CODEC_PRIVATE: 0x63a2, VIDEO: 0xe0, PIXEL_WIDTH: 0xb0, PIXEL_HEIGHT: 0xba,
};

/** A variable-length integer: its value (-1: “unknown”, all ones) and length; an element id keeps its marker bits. */
function vint(b: Uint8Array, at: number, id: boolean): [number, number] | null {
  if (at >= b.length || !b[at]) return null;
  const len = Math.clz32(b[at]) - 23;
  if (len > (id ? 4 : 8) || at + len > b.length) return null;
  let v = id ? b[at] : b[at] & (0xff >> len), ones = v === (0xff >> len);
  for (let i = 1; i < len; i++) { v = v * 256 + b[at + i]; ones = ones && b[at + i] === 0xff; }
  return [!id && ones ? -1 : v, len];
}

/** An element's id, its size (-1: unknown) and its header's length; null when the header isn't all there yet. */
function header(b: Uint8Array, at: number): { id: number; size: number; length: number } | null {
  const id = vint(b, at, true);
  const size = id && vint(b, at + id[1], false);
  return id && size ? { id: id[0], size: size[0], length: id[1] + size[1] } : null;
}

const uint = (b: Uint8Array, from: number, to: number) => { let v = 0; for (let i = from; i < to; i++) v = v * 256 + b[i]; return v; };

/**
 * Reads a WebM as its chunks arrive: the video track's codec and size, and where each of its frames is. Frame bytes
 * are skipped, not kept (they stay in the recorder's blobs).
 */
export class WebmReader {
  codec = '';
  codecPrivate: Uint8Array | null = null;
  width = 0;
  height = 0;
  readonly frames: EncodedFrame[] = [];
  private track = -1;
  private scale = 1e6;
  private cluster = 0;
  /** Bytes not read yet, and where they start in the stream. */
  private buf = new Uint8Array(0);
  private base = 0;
  /** Bytes of a frame still to come, passed over as they arrive. */
  private skip = 0;

  push(chunk: Uint8Array): void {
    if (this.skip) {
      const n = Math.min(this.skip, chunk.length);
      this.skip -= n;
      this.base += n;
      chunk = chunk.subarray(n);
    }
    if (!chunk.length) return;
    if (this.buf.length) {
      const joined = new Uint8Array(this.buf.length + chunk.length);
      joined.set(this.buf);
      joined.set(chunk, this.buf.length);
      chunk = joined;
    }
    const b = chunk;
    let at = 0;
    while (at < b.length) {
      const h = header(b, at);
      if (!h) break;
      const body = at + h.length;
      // Containers whose children are read as they come (a live stream's segment and clusters have no size).
      if (h.id === ID.SEGMENT || h.id === ID.CLUSTER || h.id === ID.BLOCK_GROUP) { at = body; continue; }
      if (h.size < 0) throw new Error('无法读取视频流');
      const end = body + h.size;
      if (h.id === ID.SIMPLE_BLOCK || h.id === ID.BLOCK) {
        const track = vint(b, body, false);
        if (!track || body + track[1] + 3 > b.length) break;
        const p = body + track[1];
        if (track[0] === this.track) {
          const rel = (((b[p] << 8) | b[p + 1]) << 16) >> 16;
          this.frames.push({ offset: this.base + p + 3, size: h.size - track[1] - 3, key: h.id === ID.SIMPLE_BLOCK && (b[p + 2] & 0x80) !== 0, time: ((this.cluster + rel) * this.scale) / 1e6 });
        }
      } else if (h.id === ID.INFO || h.id === ID.TRACKS || h.id === ID.TIMECODE) {
        if (end > b.length) break;
        if (h.id === ID.TIMECODE) this.cluster = uint(b, body, end);
        else if (h.id === ID.INFO) this.readInfo(b, body, end);
        else this.readTracks(b, body, end);
      }
      if (end > b.length) { this.skip = end - b.length; at = b.length; break; }
      at = end;
    }
    this.base += at;
    this.buf = b.slice(at);
  }

  private children(b: Uint8Array, from: number, to: number, fn: (id: number, body: number, end: number) => void): void {
    for (let at = from; at < to;) {
      const h = header(b, at);
      if (!h || h.size < 0) return;
      fn(h.id, at + h.length, at + h.length + h.size);
      at += h.length + h.size;
    }
  }

  private readInfo(b: Uint8Array, from: number, to: number): void {
    this.children(b, from, to, (id, body, end) => { if (id === ID.TIMECODE_SCALE) this.scale = uint(b, body, end) || 1e6; });
  }

  private readTracks(b: Uint8Array, from: number, to: number): void {
    this.children(b, from, to, (id, body, end) => {
      if (id !== ID.TRACK_ENTRY || this.track >= 0) return;
      let number = -1, type = 0, codec = '', priv: Uint8Array | null = null, width = 0, height = 0;
      this.children(b, body, end, (cid, cb, ce) => {
        if (cid === ID.TRACK_NUMBER) number = uint(b, cb, ce);
        else if (cid === ID.TRACK_TYPE) type = uint(b, cb, ce);
        else if (cid === ID.CODEC_ID) codec = String.fromCharCode(...b.subarray(cb, ce)).replace(/\0+$/, '');
        else if (cid === ID.CODEC_PRIVATE) priv = b.slice(cb, ce);
        else if (cid === ID.VIDEO) this.children(b, cb, ce, (vid, vb, ve) => {
          if (vid === ID.PIXEL_WIDTH) width = uint(b, vb, ve);
          else if (vid === ID.PIXEL_HEIGHT) height = uint(b, vb, ve);
        });
      });
      if (type !== 1) return;
      Object.assign(this, { track: number, codec, codecPrivate: priv, width, height });
    });
  }
}

// ---- H.264 as Chromium writes it in WebM: Annex B (start codes, the parameter sets in the key frames) ----

/** A frame's NAL units. */
function nals(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      if (start >= 0) out.push(b.subarray(start, i > 0 && b[i - 1] === 0 ? i - 1 : i));
      start = i + 3;
      i += 2;
    }
  }
  if (start >= 0) out.push(b.subarray(start));
  else if (b.length) out.push(b);
  return out;
}

/** True when the frames carry start codes (no avcC in CodecPrivate). */
export const isAnnexB = (codecPrivate: Uint8Array | null) => !codecPrivate || codecPrivate[0] !== 1;

/** A frame in MP4's form (each NAL unit after its 4-byte length), the parameter sets taken out into `sets`. */
export function toAvcc(frame: Uint8Array, sets: { sps: Uint8Array[]; pps: Uint8Array[] }): Uint8Array {
  const kept: Uint8Array[] = [];
  for (const n of nals(frame)) {
    const type = n[0] & 0x1f;
    if (type === 7) { if (!sets.sps.length) sets.sps.push(n.slice()); }
    else if (type === 8) { if (!sets.pps.length) sets.pps.push(n.slice()); }
    else if (type !== 9) kept.push(n);
  }
  const out = new Uint8Array(kept.reduce((s, n) => s + 4 + n.length, 0));
  const dv = new DataView(out.buffer);
  let at = 0;
  for (const n of kept) { dv.setUint32(at, n.length); out.set(n, at + 4); at += 4 + n.length; }
  return out;
}

/** The avcC record from the parameter sets. */
export function avcC(sps: Uint8Array[], pps: Uint8Array[]): Uint8Array {
  const s = sps[0];
  const parts = [1, s[1], s[2], s[3], 0xff, 0xe0 | sps.length];
  const bytes: number[] = [...parts];
  for (const x of sps) bytes.push(x.length >> 8, x.length & 255, ...x);
  bytes.push(pps.length);
  for (const x of pps) bytes.push(x.length >> 8, x.length & 255, ...x);
  return new Uint8Array(bytes);
}

// ---- MP3 (the audio track) ----

const MP3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_RATES = [44100, 48000, 32000];
/** Samples a frame (MPEG-1 Layer III). */
export const MP3_FRAME = 1152;

/** The frames of an MPEG-1 Layer III stream (as lamejs writes it): where each one is, its rate and channels. */
export function mp3Frames(b: Uint8Array): { frames: Array<[number, number]>; sampleRate: number; channels: number; kbps: number } {
  const frames: Array<[number, number]> = [];
  let sampleRate = 44100, channels = 2, kbps = 0;
  for (let at = 0; at + 4 <= b.length;) {
    const ok = b[at] === 0xff && (b[at + 1] & 0xfe) === 0xfa; // sync, MPEG-1, Layer III
    const rate = MP3_RATES[(b[at + 2] >> 2) & 3], bits = MP3_KBPS[b[at + 2] >> 4];
    if (!ok || !rate || !bits) { at++; continue; }
    const size = Math.floor((144000 * bits) / rate) + ((b[at + 2] >> 1) & 1);
    if (at + size > b.length) break;
    if (!frames.length) { sampleRate = rate; channels = b[at + 3] >> 6 === 3 ? 1 : 2; kbps = bits; }
    frames.push([at, size]);
    at += size;
  }
  return { frames, sampleRate, channels, kbps };
}

// ---- MP4 ----

type Bytes = Uint8Array<ArrayBuffer>;
const u8 = (...v: number[]): Bytes => new Uint8Array(v);
function u16(v: number): Bytes { return u8(v >> 8 & 255, v & 255); }
function u32(v: number): Bytes { return u8(v >>> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255); }
const ascii = (s: string): Bytes => new Uint8Array(Array.from(s, c => c.charCodeAt(0)));
function cat(parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function box(type: string, ...content: Bytes[]): Bytes { const body = cat(content); return cat([u32(8 + body.length), ascii(type), body]); }
function full(type: string, version: number, flags: number, ...content: Bytes[]): Bytes {
  return box(type, u8(version, flags >> 16 & 255, flags >> 8 & 255, flags & 255), ...content);
}
const zeros = (n: number): Bytes => new Uint8Array(n);
const MATRIX = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
/** A descriptor of an esds box: tag, length (one byte: they are short here), body. */
const desc = (tag: number, body: Bytes): Bytes => cat([u8(tag, body.length), body]);

export interface Mp4VideoSample { data: Blob | Uint8Array; size: number; key: boolean; /** In frames. */ duration: number }
export interface Mp4Video {
  /** 'avc1' (H.264) or 'vp09' / 'vp08'. */
  codec: 'avc1' | 'vp09' | 'vp08';
  /** The avcC record, or the vpcC box's body. */
  config: Uint8Array;
  width: number;
  height: number;
  fps: number;
  samples: Mp4VideoSample[];
}
export interface Mp4Audio {
  /** The MP3 stream, and its frames in it. */
  data: Uint8Array;
  frames: Array<[number, number]>;
  sampleRate: number;
  channels: number;
  kbps: number;
  /** Samples before the song's first (the encoder's delay), left out by an edit list. */
  delay: number;
  /** The song's length in samples. */
  length: number;
}

/** The vpcC body for 8-bit 4:2:0 BT.709 VP9 / VP8 (profile 0). */
export const vpcC = (level: number) => cat([u8(0, level, (8 << 4) | (1 << 1)), u8(1, 1, 1), u16(0)]);

/** stts / stsc / stss style run tables. */
function runs(values: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const v of values) { const last = out[out.length - 1]; if (last && last[1] === v) last[0]++; else out.push([1, v]); }
  return out;
}

function sampleTables(sizes: number[], durations: number[], chunks: number[], offsets: number[], keys: number[] | null): Bytes {
  const stts = runs(durations);
  const stsc: Array<[number, number]> = [];
  chunks.forEach((n, i) => { if (!stsc.length || stsc[stsc.length - 1][1] !== n) stsc.push([i + 1, n]); });
  const big = offsets.some(o => o > 0xffffffff);
  return cat([
    full('stts', 0, 0, u32(stts.length), ...stts.map(([n, d]) => cat([u32(n), u32(d)]))),
    ...(keys ? [full('stss', 0, 0, u32(keys.length), ...keys.map(k => u32(k)))] : []),
    full('stsc', 0, 0, u32(stsc.length), ...stsc.map(([first, n]) => cat([u32(first), u32(n), u32(1)]))),
    full('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(s => u32(s))),
    big
      ? full('co64', 0, 0, u32(offsets.length), ...offsets.map(o => cat([u32(Math.floor(o / 0x100000000)), u32(o >>> 0)])))
      : full('stco', 0, 0, u32(offsets.length), ...offsets.map(o => u32(o))),
  ]);
}

/** The MP4: video and MP3 audio, a second of each in turn. */
export function mp4(video: Mp4Video, audio: Mp4Audio): Blob {
  const fps = video.fps, frames = video.samples.reduce((n, s) => n + s.duration, 0);
  const seconds = Math.max(frames / fps, (audio.length) / audio.sampleRate);
  // Chunks: one a second for each track, video first.
  const vChunks: number[] = [], aChunks: number[] = [];
  const order: Array<{ track: 0 | 1; from: number; to: number }> = [];
  let v = 0, a = 0, vt = 0;
  for (let k = 0; v < video.samples.length || a < audio.frames.length; k++) {
    const vFrom = v;
    while (v < video.samples.length && vt < (k + 1) * fps) { vt += video.samples[v].duration; v++; }
    const aFrom = a;
    while (a < audio.frames.length && (a * MP3_FRAME - audio.delay) / audio.sampleRate < k + 1) a++;
    if (v > vFrom) { vChunks.push(v - vFrom); order.push({ track: 0, from: vFrom, to: v }); }
    if (a > aFrom) { aChunks.push(a - aFrom); order.push({ track: 1, from: aFrom, to: a }); }
  }
  const vSizes = video.samples.map(s => s.size), aSizes = audio.frames.map(f => f[1]);
  const keys = video.samples.every(s => s.key) ? null : video.samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const ms = Math.round(seconds * 1000);
  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii(video.codec === 'avc1' ? 'avc1' : 'iso6'), ascii('mp41'));
  const moovWith = (vOffsets: number[], aOffsets: number[]) => {
    const tkhd = (id: number, duration: number, volume: number, w: number, h: number) =>
      full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(volume), u16(0), MATRIX, u32(w * 65536), u32(h * 65536));
    const mdhd = (scale: number, duration: number) => full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(duration), u16(0x55c4), u16(0));
    const hdlr = (type: string, name: string) => full('hdlr', 0, 0, u32(0), ascii(type), zeros(12), ascii(name + '\0'));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const visual = box(video.codec, zeros(6), u16(1), zeros(16), u16(video.width), u16(video.height), u32(0x480000), u32(0x480000), u32(0), u16(1),
      zeros(32), u16(0x18), u16(0xffff), video.codec === 'avc1' ? box('avcC', video.config as Bytes) : full('vpcC', 1, 0, video.config as Bytes));
    const vTrak = box('trak', tkhd(1, ms, 0, video.width, video.height), box('mdia', mdhd(fps, frames), hdlr('vide', 'BetterMV Video'),
      box('minf', full('vmhd', 0, 1, zeros(8)), dinf, box('stbl', full('stsd', 0, 0, u32(1), visual),
        sampleTables(vSizes, video.samples.map(s => s.duration), vChunks, vOffsets, keys)))));
    const esds = full('esds', 0, 0, desc(3, cat([u16(2), u8(0),
      desc(4, cat([u8(0x6b, 0x15), u8(0, 0, 0), u32(audio.kbps * 1000), u32(audio.kbps * 1000)])),
      desc(6, u8(2))])));
    const sound = box('mp4a', zeros(6), u16(1), zeros(8), u16(audio.channels), u16(16), u16(0), u16(0), u32(audio.sampleRate * 65536), esds);
    const aMedia = audio.frames.length * MP3_FRAME;
    const shown = Math.round((Math.min(audio.length, aMedia - audio.delay) / audio.sampleRate) * 1000);
    const aTrak = box('trak', tkhd(2, shown, 0x100, 0, 0),
      // The encoder's delay left out, so the song's first sample plays with the first frame.
      box('edts', full('elst', 0, 0, u32(1), u32(shown), u32(audio.delay), u32(0x10000))),
      box('mdia', mdhd(audio.sampleRate, aMedia), hdlr('soun', 'BetterMV Audio'),
        box('minf', full('smhd', 0, 0, u32(0)), dinf, box('stbl', full('stsd', 0, 0, u32(1), sound),
          sampleTables(aSizes, aSizes.map(() => MP3_FRAME), aChunks, aOffsets, null)))));
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(3));
    return box('moov', mvhd, vTrak, aTrak);
  };
  // The offsets once the moov's size is known (it doesn't depend on their values, only on whether any passes 4 GB).
  const payload = vSizes.reduce((n, s) => n + s, 0) + aSizes.reduce((n, s) => n + s, 0);
  const bigMdat = payload + 16 > 0xffffffff;
  const place = (start: number): [number[], number[]] => {
    const vo: number[] = [], ao: number[] = [];
    let at = start;
    for (const c of order) {
      (c.track === 0 ? vo : ao).push(at);
      for (let i = c.from; i < c.to; i++) at += c.track === 0 ? vSizes[i] : aSizes[i];
    }
    return [vo, ao];
  };
  const mdatHead = bigMdat ? cat([u32(1), ascii('mdat'), u32(Math.floor((payload + 16) / 0x100000000)), u32((payload + 16) >>> 0)]) : cat([u32(payload + 8), ascii('mdat')]);
  let moov = moovWith(...place(0));
  moov = moovWith(...place(ftyp.length + moov.length + mdatHead.length));
  const parts: BlobPart[] = [ftyp, moov, mdatHead];
  for (const c of order) {
    for (let i = c.from; i < c.to; i++) {
      if (c.track === 0) parts.push(video.samples[i].data as BlobPart);
      else parts.push(audio.data.subarray(audio.frames[i][0], audio.frames[i][0] + audio.frames[i][1]) as Bytes);
    }
  }
  return new Blob(parts, { type: 'video/mp4' });
}
