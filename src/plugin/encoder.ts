// The video encoder program, the plugin's side (docs/EXPORT.md). A download starts bettermv-encode.exe
// (src/export/helper/BetterMVEncode.cs) from the plugin's folder, sends it the MV's frames as NV12 and the song's audio,
// and has it write the MP4 through Media Foundation (the graphics card's H.264 encoder when there is one). One program
// per download: it is told to quit when the download ends, and ends itself when NetEase does.

const APP = 'BetterMV Encode';
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
/** The ports tried, from the first: one answering as another program, or as a leftover whose key is lost, is skipped. */
const FIRST_PORT = 32110, PORTS = 24;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** Backslashed, without "\." steps (BetterNCM's plugin path reads "C:\betterncm/./plugins_dev\…") or a trailing slash. */
const winPath = (p: string) => p.replace(/\//g, '\\').replace(/\\\.(?=\\)/g, '').replace(/\\+$/, '');

export class EncodeError extends Error {}
/** The program couldn't be started, or Windows can't encode with it here: the download falls back to the recorder. */
export class EncoderUnavailable extends EncodeError {}

/** For tests (tools/export-test.ts): a program path and more arguments to run it with, set on the page. */
const devProgram = () => (window as unknown as { __betterMvEncoder?: { exe?: string; args?: string } }).__betterMvEncoder;

export interface EncodeBegin {
  path: string;
  width: number;
  height: number;
  fps: number;
  /** Video bits a second. */
  bitrate: number;
  /** The audio sent next (16-bit PCM): its rate and channels, and the AAC rate; no audio: 0 rate. */
  audioRate: number;
  audioChannels: number;
  audioKbps: number;
  /** Whether to try the graphics card's encoder first. */
  hardware: boolean;
}

export interface EncodeDone { bytes: number; frames: number; seconds: number; encoder: 'hardware' | 'software' }

export class Encoder {
  private constructor(private readonly port: number, private readonly key: string) {}

  private url(path: string): string { return `http://127.0.0.1:${this.port}/api/${path}`; }

  private static async status(port: number, key: string, timeout = 800): Promise<'ours' | 'other' | null> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: ctl.signal, cache: 'no-store', headers: { 'x-bmv-key': key } });
      const s = await r.json().catch(() => null);
      return s?.app === APP ? 'ours' : 'other';
    } catch {
      return null; // nothing listening
    } finally { clearTimeout(t); }
  }

  /** Where the program is run from: a copy in the data folder (the plugin's own folder is unpacked anew at each start). */
  private static async programPath(): Promise<string> {
    const dev = devProgram()?.exe;
    if (dev) return dev;
    const data = winPath(await betterncm.app.getDataPath());
    const raw = winPath(plugin.pluginPath);
    const folder = /^[a-z]:\\|^\\\\/i.test(raw) ? raw : `${data}\\${raw.replace(/^\.?\\/, '')}`;
    const dir = data + '\\BetterMV\\export';
    await betterncm.fs.mkdir(data + '\\BetterMV').catch(() => false);
    await betterncm.fs.mkdir(dir).catch(() => false);
    const exe = dir + '\\bettermv-encode.exe';
    // (One still running from a download that didn't end well keeps its copy: the same program.)
    if (!await betterncm.fs.exists(folder + '\\export\\bettermv-encode.exe')) throw new EncodeError('插件里没有视频编码程序');
    await betterncm.fs.writeFile(exe, await betterncm.fs.readFile(folder + '\\export\\bettermv-encode.exe')).catch(() => false);
    if (!await betterncm.fs.exists(exe)) throw new EncodeError('无法复制视频编码程序');
    return exe;
  }

  /** Starts the program, on a free port with a key of its own. */
  static async launch(): Promise<Encoder> {
    const exe = await Encoder.programPath();
    const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    for (let k = 0; k < PORTS; k++) {
      const port = FIRST_PORT + k;
      if (await Encoder.status(port, key) !== null) continue;
      // (Not waited for beyond a moment: Windows asking about a program it can't start — a security product holding it, a
      // missing file — keeps the call open behind a dialog, and the download would wait there for good.)
      const started = betterncm.app.exec(`"${exe}" --port ${port} --key ${key} --version ${VERSION}${devProgram()?.args ? ' ' + devProgram()!.args : ''}`, false, false);
      started.catch(() => {});
      await Promise.race([started, sleep(2000)]);
      let taken = false;
      // (A refused connection takes a few hundred ms to report: the time is kept by the clock, not by counting.)
      for (const until = performance.now() + 6000; performance.now() < until && !taken;) {
        await sleep(100);
        const s = await Encoder.status(port, key);
        if (s === 'ours') return new Encoder(port, key);
        taken = s === 'other'; // the port was taken between the look and the start: the next one
      }
      // (Six seconds and nothing answering: the program didn't start; not tried on every port.)
      if (!taken) break;
    }
    throw new EncodeError('视频编码程序未能启动');
  }

  /**
   * One request; its answer's text. The answer is always read to the end: a request whose answer was left unread kept
   * its body (a Blob of 18 MB) in the browser until the page's garbage collector got to it, and a few hundred frames in
   * the browser ran out of blob memory (ERR_BLOB_OUT_OF_MEMORY, at about 2 GB).
   */
  private async call(path: string, body: BodyInit | undefined, headers: Record<string, string> = {}): Promise<string> {
    const r = await fetch(this.url(path), { method: 'POST', headers: { 'x-bmv-key': this.key, ...headers }, body })
      .catch(e => { throw new EncodeError(`无法连接视频编码程序（${path}${headers['x-bmv-i'] ? ' ' + headers['x-bmv-i'] : ''}）：${(e as Error)?.message || e}`); });
    const text = await r.text().catch(() => '');
    if (!r.ok) throw new EncodeError(text || `编码程序出错（${r.status}）`);
    return text;
  }

  /** Opens the file; which encoder it got. */
  async begin(spec: EncodeBegin): Promise<'hardware' | 'software'> {
    return JSON.parse(await this.call('begin', JSON.stringify(spec), { 'content-type': 'application/json' })).encoder;
  }

  /** The song's audio (nothing: a silent video); must come before the first frame. */
  async audio(pcm: Int16Array | null): Promise<void> {
    await this.call('audio', pcm ? new Blob([pcm as BlobPart]) : new Blob([]));
  }

  /** Frames `i`, `i`+1, … (NV12, one after the other in `bytes`). The bytes are copied, so the caller may reuse them at once. */
  async frames(i: number, bytes: Uint8Array): Promise<void> {
    await this.call('frame', new Blob([bytes as BlobPart]), { 'x-bmv-i': String(i) });
  }

  /** Once every frame is sent: resolves when the file is written. */
  async finish(frames: number): Promise<EncodeDone> {
    return JSON.parse(await this.call('finish', undefined, { 'x-bmv-frames': String(frames) })) as EncodeDone;
  }

  /** Stops and deletes the unfinished file. */
  async cancel(): Promise<void> { await this.call('cancel', undefined).catch(() => {}); }

  /** Ends the program. */
  async quit(): Promise<void> { await this.call('quit', undefined).catch(() => {}); }
}
