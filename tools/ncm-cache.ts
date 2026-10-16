// Where the NetEase client caches songs (<id>-<quality>-<md5>.uc + .idx), for the dev tools outside the client.
// Same order as tools/aligner/ncm_cache.py: BMV_NCM_CACHE, then the client's 缓存目录 setting as the plugin last
// recorded it (<BetterNCM data>\BetterMV\ncm-cache.json, see src/plugin/source.ts), then the default folder.
// The setting itself is in the client's localStorage, encrypted, so the plugin's record is how it gets out.
import fs from 'node:fs';
import path from 'node:path';

export function ncmCacheDir(): string {
  if (process.env.BMV_NCM_CACHE) return process.env.BMV_NCM_CACHE;
  try {
    const record = path.join(process.env.BETTERNCM_PROFILE || 'C:/betterncm', 'BetterMV/ncm-cache.json');
    const songs = JSON.parse(fs.readFileSync(record, 'utf8')).songs;
    if (typeof songs === 'string' && fs.existsSync(songs)) return songs;
  } catch { /* no record yet */ }
  return path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData/Local'), 'NetEase/CloudMusic/Cache/Cache');
}
