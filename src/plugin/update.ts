// Keeping BetterMV current. BetterNCM unpacks every package in its plugins folder at each start, and of packages with
// the same slug the one last in name order is the one that runs (docs/CLIENT.md): a new version dropped beside the old
// one can lose to it (BetterMV-0.10.0 sorts before BetterMV-0.9.3). So the running plugin keeps only the newest
// BetterMV package there, and asks the project's releases for a newer one, which it can download into place (the next
// start of NetEase runs it).
import { strFromU8, unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { execArg } from './exec.ts';

const REPO = 'xiaoming6680/NCM-BetterMV';
const SLUG = 'ncm-better-mv';
const DAY = 24 * 3600 * 1000;

/** The version in plugin/manifest.json (Vite's `define`). */
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '';

/** A published version: its release page, and its package. */
export interface Release { version: string; page: string; asset: string; name: string; size: number }

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest'; at: number }
  /**
   * `installable`: this plugin was installed from a package (a dev install is pointed to the page instead). `auto`:
   * found by the daily check (or by one before this start), not by a check asked for in the settings.
   */
  | { kind: 'available'; release: Release; installable: boolean; auto: boolean }
  | { kind: 'downloading'; release: Release; done: number; total: number }
  /** Downloaded: the package is checked, written into the plugins folder, and the older ones removed. */
  | { kind: 'installing'; release: Release }
  /** A newer package is in place: NetEase's next start runs it. `auto`: found there at start, not installed just now. */
  | { kind: 'ready'; version: string; auto?: boolean }
  | { kind: 'failed'; message: string; release?: Release };

let state: UpdateState = { kind: 'idle' };
const watchers = new Set<(s: UpdateState) => void>();
const set = (s: UpdateState) => { state = s; watchers.forEach(fn => fn(s)); };

/** The update's state now, and every change after (returns the unsubscribe). */
export function watchUpdate(fn: (s: UpdateState) => void): () => void {
  watchers.add(fn);
  fn(state);
  return () => watchers.delete(fn);
}

/** Compares two versions (0.10.0 after 0.9.3); a leading v and anything after the numbers are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (v.replace(/^v/i, '').match(/^\d+(?:\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

interface Manifest { slug?: string; name?: string; version?: string }

/** The manifest in a .plugin file (a zip), or null when the file isn't a plugin package. */
function manifestOf(bytes: Uint8Array): Manifest | null {
  try {
    const m = unzipSync(bytes, { filter: f => f.name === 'manifest.json' })['manifest.json'];
    return m ? JSON.parse(strFromU8(m).replace(/^﻿/, '')) : null;
  } catch { return null; }
}

/** A manifest's slug as BetterNCM takes it (the name, letters and digits only, when it gives none). */
const slugOf = (m: Manifest) => m.slug ?? String(m.name ?? '').replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '-');

let data: Promise<string> | null = null;
const dataPath = () => (data ??= betterncm.app.getDataPath().then(p => p.replace(/[\\/]+$/, '')));
const same = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();

/** The package this plugin was unpacked from (BetterNCM notes it beside the plugin), or null for a dev install. */
async function ownPackage(): Promise<string | null> {
  try {
    const meta = (await betterncm.fs.readFileText(`${plugin.pluginPath}/.plugin.path.meta`)).trim();
    return meta ? `${await dataPath()}\\${meta.replace(/^[\\/]+/, '').replace(/\//g, '\\')}` : null;
  } catch { return null; }
}

interface Package { path: string; version: string }

/** The BetterMV packages in BetterNCM's plugins folder other than `except`, known by their manifests (not file names). */
async function otherPackages(except: string): Promise<Package[]> {
  const out: Package[] = [];
  for (const path of await betterncm.fs.readDir(`${await dataPath()}\\plugins`)) {
    if (!/\.plugin$/i.test(path) || same(path, except)) continue;
    try {
      const m = manifestOf(new Uint8Array(await (await betterncm.fs.readFile(path)).arrayBuffer()));
      if (m && slugOf(m) === SLUG && typeof m.version === 'string') out.push({ path, version: m.version });
    } catch { /* unreadable: not known to be ours */ }
  }
  return out;
}

async function removePackage(path: string): Promise<void> {
  try {
    await betterncm.fs.remove(path);
    console.info('[BetterMV] 已删除旧版插件包', path);
  } catch (e) { console.warn('[BetterMV] 无法删除插件包', path, e); }
}

/**
 * Keeps only the newest BetterMV package in the plugins folder: older ones (and copies of this one) are removed; when
 * a newer one is there, it stays and this one's own package goes, so the next start runs the newer.
 */
async function tidyPackages(): Promise<void> {
  const own = await ownPackage();
  if (!own) return;
  const others = await otherPackages(own);
  if (!others.length) return;
  const newest = others.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
  const keep = compareVersions(newest.version, VERSION) > 0 ? newest : null;
  for (const p of others) if (p !== keep) await removePackage(p.path);
  if (keep) {
    await removePackage(own);
    set({ kind: 'ready', version: keep.version, auto: true });
  }
}

/** A connection to GitHub can hang without failing: a request is given up after `ms` with nothing coming (`poke` on each piece). */
function deadline(ms: number) {
  const abort = new AbortController();
  let timer = 0;
  const poke = () => { clearTimeout(timer); timer = window.setTimeout(() => abort.abort(), ms); };
  poke();
  return { signal: abort.signal, poke, late: () => abort.signal.aborted, stop: () => clearTimeout(timer) };
}

/** `p`, or `message` as an error once `ms` pass without it settling (BetterNCM's file server can stall under load). */
function within<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  return Promise.race([p, new Promise<never>((_, no) => { timer = window.setTimeout(() => no(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}

/** The newest version published with a package (pre-releases, and the aligner pack's release, are not). */
async function latestRelease(): Promise<Release | null> {
  const wait = deadline(15000);
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { cache: 'no-store', signal: wait.signal }).catch(() => null);
  if (!r) { wait.stop(); throw new Error(wait.late() ? '连接 GitHub 超时，请检查网络后重试' : '无法连接 GitHub，请检查网络后重试'); }
  if (r.status === 403 || r.status === 429) { wait.stop(); throw new Error('查询过于频繁，请稍后再试'); }
  if (!r.ok) { wait.stop(); throw new Error(`无法查询新版本（HTTP ${r.status}）`); }
  const list: unknown = await r.json().catch(() => null).finally(wait.stop);
  if (!Array.isArray(list)) throw new Error('版本信息无法读取，请稍后重试');
  let best: Release | null = null;
  for (const x of list) {
    if (!x || x.draft || x.prerelease || !/^v?\d+\.\d+\.\d+$/.test(String(x.tag_name))) continue;
    const a = (Array.isArray(x.assets) ? x.assets : []).find((a: { name?: unknown }) => /^[\w.-]+\.plugin$/i.test(String(a?.name)));
    const url = String(a?.browser_download_url ?? '');
    if (!a || url.indexOf(`https://github.com/${REPO}/releases/download/`) !== 0) continue;
    const version = String(x.tag_name).replace(/^v/i, '');
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, page: String(x.html_url || `https://github.com/${REPO}/releases`), asset: url, name: String(a.name), size: Number(a.size) || 0 };
    }
  }
  return best;
}

/** Asks GitHub for a newer version. `quiet` (the daily check): a failure leaves things as they were. */
export async function checkUpdate(quiet = false): Promise<void> {
  if (state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'installing' || state.kind === 'ready') return;
  const before = state;
  set({ kind: 'checking' });
  try {
    const release = await latestRelease();
    const at = Date.now();
    plugin.setConfig('updateCheckedAt', at);
    plugin.setConfig('updateCheckedBy', VERSION);
    if (release && compareVersions(release.version, VERSION) > 0) {
      plugin.setConfig('updateRelease', JSON.stringify(release));
      set({ kind: 'available', release, installable: !!(await ownPackage()), auto: quiet });
    } else {
      plugin.setConfig('updateRelease', '');
      set({ kind: 'latest', at });
    }
  } catch (e) {
    if (quiet) set(before);
    else set({ kind: 'failed', message: String((e as Error)?.message || e) });
  }
}

async function download(url: string, size: number, onBytes: (done: number) => void): Promise<Blob> {
  // 20 s without a byte (connecting, or midway) and the download is given up.
  const wait = deadline(20000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: wait.signal }).catch(() => {
      throw new Error(wait.late() ? '连接 GitHub 超时，请检查网络后重试' : '无法连接 GitHub，请检查网络后重试');
    });
    if (!r.ok || !r.body) throw new Error(`下载失败（HTTP ${r.status}）`);
    const reader = r.body.getReader();
    const chunks: BlobPart[] = [];
    let got = 0, shown = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => { throw new Error(wait.late() ? '下载超时，请检查网络后重试' : '下载中断，请检查网络后重试'); });
      if (done) break;
      wait.poke();
      chunks.push(value as Uint8Array<ArrayBuffer>);
      got += value.length;
      // The page redraws a few times a second, not on every chunk.
      if (Date.now() - shown > 200) { shown = Date.now(); onBytes(got); }
    }
    onBytes(got);
    if (size && got !== size) throw new Error('下载不完整，请重试');
    return new Blob(chunks);
  } finally { wait.stop(); }
}

/**
 * Downloads a release's package into the plugins folder and removes the older BetterMV packages (this one's own
 * included); NetEase's next start runs the new one. A dev install gets the release page instead.
 */
let busy = false;
export async function installUpdate(release: Release): Promise<void> {
  if (busy || state.kind === 'downloading' || state.kind === 'installing' || state.kind === 'ready') return;
  // A dev install (known since the version was found) gets the page.
  if (state.kind === 'available' && !state.installable) { openPage(release.page); return; }
  busy = true;
  // Under way at once, and a second press does nothing: this plugin's own package is looked up through BetterNCM's
  // file server, which can take seconds to answer while a song is being read.
  set({ kind: 'downloading', release, done: 0, total: release.size });
  try {
    if (!(await within(ownPackage(), 20000, '读取插件文件夹超时，请稍后重试'))) {
      set({ kind: 'available', release, installable: false, auto: false });
      openPage(release.page);
      return;
    }
    const blob = await download(release.asset, release.size, done => set({ kind: 'downloading', release, done, total: release.size }));
    set({ kind: 'installing', release });
    await within((async () => {
      const m = manifestOf(new Uint8Array(await blob.arrayBuffer()));
      if (!m || slugOf(m) !== SLUG || m.version !== release.version) throw new Error('安装包校验失败，请重试');
      const target = `${await dataPath()}\\plugins\\${/^[\w.-]+\.plugin$/i.test(release.name) ? release.name : `BetterMV-${release.version}.plugin`}`;
      if (!(await betterncm.fs.writeFile(target, blob)) || !(await betterncm.fs.exists(target))) throw new Error('无法写入插件文件夹');
      for (const p of await otherPackages(target)) if (compareVersions(p.version, release.version) <= 0) await removePackage(p.path);
    })(), 60000, '安装超时，请稍后重试');
    plugin.setConfig('updateRelease', '');
    set({ kind: 'ready', version: release.version });
  } catch (e) {
    set({ kind: 'failed', message: String((e as Error)?.message || e), release });
  } finally {
    busy = false;
  }
}

/** Opens a page in the system's browser. */
export function openPage(url: string): void {
  try { betterncm.ncm.openUrl(url); } catch { window.open(url); }
}

/** A version's release page (where it is downloaded by hand). */
export const releasePage = (version: string) => `https://github.com/${REPO}/releases/tag/v${version}`;

/** BetterNCM's plugins folder, where a package downloaded by hand goes. */
export const pluginsFolder = async () => `${await dataPath()}\\plugins`;
/**
 * BetterNCM's exec hides the window unless asked, and drops plain quotes (exec.ts): the path goes with its quotes
 * escaped (explorer given a path with a comma unquoted opens Documents), and the window is shown.
 */
export async function openPluginsFolder(): Promise<void> {
  try { await betterncm.app.exec(`explorer ${execArg(await pluginsFolder())}`, false, true); } catch (e) { console.warn('[BetterMV] 无法打开插件文件夹', e); }
}

const nativeApp = () => (typeof betterncm_native === 'undefined' ? undefined : betterncm_native?.app);
/** Whether this BetterNCM can restart NetEase (its plugin manager does so for a plugin that needs it). */
export const canRestart = () => typeof nativeApp()?.restart === 'function';
export function restartNetEase(): void {
  nativeApp()?.restart?.();
}

/**
 * At start: a newer version found before is offered at once; a few seconds on, the plugins folder is tidied and (with
 * `auto`) GitHub is asked again when the last check is a day old, or was made by another version (just updated).
 */
export function startUpdates(auto: boolean): void {
  const last = plugin.getConfig('updateCheckedBy', '') === VERSION ? Number(plugin.getConfig('updateCheckedAt', 0)) || 0 : 0;
  try {
    const r: Release | null = JSON.parse(String(plugin.getConfig('updateRelease', '')) || 'null');
    if (r && typeof r.version === 'string' && compareVersions(r.version, VERSION) > 0) {
      void ownPackage().then(own => { if (state.kind === 'idle') set({ kind: 'available', release: r, installable: !!own, auto: true }); });
    } else if (last) set({ kind: 'latest', at: last });
  } catch { /* checked anew */ }
  window.setTimeout(async () => {
    // (A stalled file server holds up the tidying, not the check.)
    try { await within(tidyPackages(), 30000, '超时'); } catch (e) { console.warn('[BetterMV] 检查旧版插件包失败', e); }
    if (auto && Date.now() - last > DAY) void checkUpdate(true);
  }, 8000);
}
