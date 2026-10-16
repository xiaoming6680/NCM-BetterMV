// OBS output, the plugin's side (docs/OBS.md). A plugin can't listen on a port, so this starts the local server
// (BetterMV OBS, src/obs/helper/BetterMVObs.cs) from the plugin's folder, sends it the song prepared for NetEase's
// playing track and where NetEase is playing, and reads how many OBS pages are connected and shown.
import { OBS_PORT, songFile, type ObsState } from '../obs/snapshot.ts';
import type { PreparedSong } from '../app/prepare.ts';

export interface ObsStatus {
  /** off: output off. starting: the server is being started. on: it answers. error: it couldn't be started (why). */
  kind: 'off' | 'starting' | 'on' | 'error';
  /** The address OBS is given. */
  url: string;
  /** Pages connected, those shown (OBS: in its preview or programme; a browser: its tab in front), those in OBS. */
  pages: number;
  visible: number;
  obs: number;
  error?: string;
}

const APP = 'BetterMV OBS';
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
/** How often the server is asked how many pages it has. */
const STATUS_MS = 2000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Backslashed, without "\." steps (BetterNCM's plugin path reads "C:\betterncm/./plugins_dev\…") or a trailing slash. */
const winPath = (p: string) => p.replace(/\//g, '\\').replace(/\\\.(?=\\)/g, '').replace(/\\+$/, '');

/** The server's status: how it stands only when asked with its key (pages and songs say what is playing). */
interface ServerStatus { app: string; version: string; pages?: number; visible?: number; obs?: number; songs?: string[] }

class ObsOutput {
  status: ObsStatus = { kind: 'off', url: `http://127.0.0.1:${OBS_PORT}/`, pages: 0, visible: 0, obs: 0 };
  private port = OBS_PORT;
  private key = '';
  private listeners = new Set<(s: ObsStatus) => void>();
  /** Bumped by every start and stop: a start overtaken by another gives up. */
  private run = 0;
  private timer = 0;
  /** Song files the server has (from its last status), and the one being sent. */
  private onServer = new Set<string>();
  private sending: string | null = null;
  private stateBusy = false;
  private statePending: ObsState | null = null;

  /** Calls `fn` with the status now and on every change; returns the way to stop. */
  watch(fn: (s: ObsStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(s: Partial<ObsStatus>): void {
    const next = { ...this.status, ...s };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.listeners.forEach(fn => fn(next));
  }

  get on(): boolean { return this.status.kind === 'on' || this.status.kind === 'starting'; }
  /** An OBS page shows the picture: the MV page may rest. */
  get shown(): boolean { return this.status.kind === 'on' && this.status.visible > 0; }

  private api(path: string): string { return `http://127.0.0.1:${this.port}/api/${path}`; }

  private async serverStatus(timeout = 1000): Promise<ServerStatus | 'other' | null> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(this.api('status'), { signal: ctl.signal, cache: 'no-store', headers: { 'x-bmv-key': this.key } });
      const s = await r.json().catch(() => null);
      return s?.app === APP ? s as ServerStatus : 'other';
    } catch {
      return null; // nothing listening (or it didn't answer in time)
    } finally { clearTimeout(t); }
  }

  private post(path: string, body: BodyInit, type?: string): Promise<Response> {
    const headers: Record<string, string> = { 'x-bmv-key': this.key };
    if (type) headers['content-type'] = type;
    return fetch(this.api(path), { method: 'POST', headers, body });
  }

  /**
   * Starts the output: the server already running from this version is kept (NetEase reopened within its two
   * seconds of grace); one from another version is told to quit and replaced; another program on the port is an error.
   */
  async start(port: number, key: string): Promise<void> {
    const run = ++this.run;
    // (Moved to another port: the server on the old one goes.)
    if (port !== this.port && this.status.kind === 'on') await this.post('quit', '').catch(() => {});
    this.port = port;
    this.key = key;
    clearInterval(this.timer);
    this.onServer.clear();
    this.set({ kind: 'starting', url: `http://127.0.0.1:${port}/`, pages: 0, visible: 0, obs: 0, error: undefined });
    try {
      let s = await this.serverStatus();
      if (s === 'other') throw new Error(`端口 ${port} 被占用`);
      if (s && s.version !== VERSION) {
        await this.post('quit', '').catch(() => {});
        for (let i = 0; i < 30 && s; i++) { await sleep(100); s = await this.serverStatus(300); }
        if (s) throw new Error('请重启网易云音乐');
      }
      // (Twice: NetEase reopened at once finds the last server still ending, its program file and port not yet free.)
      for (let attempt = 0; attempt < 2 && !s; attempt++) {
        if (attempt) await sleep(2000);
        await this.launch().catch(() => {});
        for (let i = 0; i < 60 && !s; i++) {
          await sleep(150);
          if (run !== this.run) return;
          const got = await this.serverStatus(500);
          if (got === 'other') throw new Error(`端口 ${port} 被占用`);
          s = got;
        }
      }
      if (!s) throw new Error('服务未能启动');
      if (run !== this.run || !this.took(s)) return;
      this.timer = window.setInterval(() => void this.poll(run), STATUS_MS);
    } catch (e) {
      if (run === this.run) this.set({ kind: 'error', error: (e as Error)?.message || String(e) });
    }
  }

  /** The server program, copied from the plugin's folder to BetterMV\obs in the data folder and started from there. */
  private async launch(): Promise<void> {
    const data = winPath(await betterncm.app.getDataPath());
    // (BetterNCM loads plugins from ./plugins_runtime and ./plugins_dev, relative to its data folder; the server runs
    // elsewhere and needs the whole path.)
    const raw = winPath(plugin.pluginPath);
    const plugin_ = /^[a-z]:\\|^\\\\/i.test(raw) ? raw : `${data}\\${raw.replace(/^\.?\\/, '')}`;
    const dir = data + '\\BetterMV\\obs';
    const exe = dir + '\\bettermv-obs.exe';
    // (Run from a copy: BetterNCM unpacks the plugin's folder anew at each start, and can't while the program runs.)
    // (A copy still held by a server that is ending stays as it was: the same program, started all the same.)
    await betterncm.fs.mkdir(dir).catch(() => false);
    await betterncm.fs.writeFile(exe, await betterncm.fs.readFile(plugin_ + '\\obs\\bettermv-obs.exe')).catch(() => false);
    await betterncm.app.exec(`cmd /c start "" /b "${exe}" --port ${this.port} --root "${plugin_}" --key ${this.key} --version ${VERSION}`, false, false);
  }

  /** The server's status into ours. One that won't tell us how it stands doesn't know our key (left from before): an error. */
  private took(s: ServerStatus): boolean {
    if (s.pages === undefined) {
      clearInterval(this.timer);
      this.set({ kind: 'error', error: '请重启网易云音乐' });
      return false;
    }
    this.onServer = new Set(s.songs);
    this.set({ kind: 'on', pages: s.pages, visible: s.visible ?? 0, obs: s.obs ?? 0, error: undefined });
    return true;
  }

  private async poll(run: number): Promise<void> {
    const s = await this.serverStatus();
    if (run !== this.run) return;
    if (s && s !== 'other') { this.took(s); return; }
    // Gone (ended from outside, or crashed): started again.
    clearInterval(this.timer);
    void this.start(this.port, this.key);
  }

  /** Stops the output: the server is told to quit. */
  async stop(): Promise<void> {
    this.run++;
    clearInterval(this.timer);
    const was = this.status.kind === 'on';
    this.set({ kind: 'off', pages: 0, visible: 0, obs: 0, error: undefined });
    if (was) await this.post('quit', '').catch(() => {});
  }

  /** Whether the server has this song file (sent before, and not dropped since). */
  has(file: string): boolean { return this.onServer.has(file); }

  /** Sends a prepared song as `file` (unless the server has it). Resolves when it is there. */
  async sendSong(song: PreparedSong, file: string): Promise<boolean> {
    if (this.status.kind !== 'on' || this.onServer.has(file) || this.sending === file) return this.onServer.has(file);
    this.sending = file;
    try {
      const r = await this.post('song/' + encodeURIComponent(file), songFile(song), 'application/octet-stream');
      if (r.ok) this.onServer.add(file);
      // (A server left from before with another key: it can't be told anything, nor to quit.)
      else if (r.status === 403) {
        clearInterval(this.timer);
        this.set({ kind: 'error', error: '请重启网易云音乐' });
      }
      return r.ok;
    } catch {
      return false;
    } finally {
      if (this.sending === file) this.sending = null;
    }
  }

  /** Sends where NetEase is playing; while one is on its way, only the newest waiting one follows it. */
  sendState(state: ObsState): void {
    if (this.status.kind !== 'on') return;
    if (this.stateBusy) { this.statePending = state; return; }
    this.stateBusy = true;
    void this.post('state', JSON.stringify(state), 'application/json').catch(() => {}).finally(() => {
      this.stateBusy = false;
      const next = this.statePending;
      this.statePending = null;
      if (next) this.sendState(next);
    });
  }
}

export const obs = new ObsOutput();

/** A key for the server's write requests, kept in the settings (a server left from before still knows it). */
export function obsKey(): string {
  let key = String(plugin.getConfig('obsKey', '') || '');
  if (!/^[0-9a-f]{32}$/.test(key)) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    plugin.setConfig('obsKey', key);
  }
  return key;
}
