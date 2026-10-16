# Where the NetEase client caches songs (<id>-<quality>-<md5>.uc + .idx), for the dev tools outside the client.
# Same order as tools/ncm-cache.ts: BMV_NCM_CACHE, then the client's 缓存目录 setting as the plugin last recorded it
# (<BetterNCM data>\BetterMV\ncm-cache.json, see src/plugin/source.ts), then the default folder.
import json, os


def ncm_cache_dir():
    if os.environ.get('BMV_NCM_CACHE'):
        return os.environ['BMV_NCM_CACHE']
    try:
        record = os.path.join(os.environ.get('BETTERNCM_PROFILE') or r'C:\betterncm', 'BetterMV', 'ncm-cache.json')
        with open(record, encoding='utf-8') as f:
            songs = json.load(f).get('songs')
        if isinstance(songs, str) and os.path.isdir(songs):
            return songs
    except (OSError, ValueError, AttributeError):
        pass
    return os.path.expandvars(r'%LOCALAPPDATA%\NetEase\CloudMusic\Cache\Cache')
