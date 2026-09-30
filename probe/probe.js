// BetterMV probe. Records what NetEase Cloud Music 3.x gives a plugin: player events, real-time audio data,
// the playing song, lyrics and the client's cached audio file. Writes <BetterNCM data>/ncm-better-mv-probe/report.json.
// Read-only apart from switching the client's audio-data stream on (and off again if it was off).
(function () {
    'use strict';
    const VERSION = '0.1.0';
    const KEY = '__betterMvProbe';
    if (window[KEY]) return;
    window[KEY] = { version: VERSION };

    const T0 = performance.now();
    const now = () => Math.round(performance.now() - T0);
    const RECORD_MS = 25000; // playback time to watch before the report is final
    const GIVE_UP_MS = 10 * 60 * 1000;

    const report = {
        probe: VERSION, startedAt: new Date().toISOString(), finished: false,
        env: {}, sdk: {}, song: null, songs: [], events: {}, audioData: null, lyrics: null, cache: null, songUrl: null, errors: []
    };
    window[KEY].report = report;
    const fail = (where, e) => {
        if (report.errors.length < 60) report.errors.push({ at: now(), where, error: String((e && (e.stack || e.message)) || e).slice(0, 600) });
    };
    const cleanups = [];

    // ---------- helpers ----------
    function describe(value, depth) {
        depth = depth || 0;
        if (value === null || value === undefined) return value;
        const type = typeof value;
        if (type === 'number' || type === 'boolean') return value;
        if (type === 'string') return value.length > 160 ? value.slice(0, 160) + '…(' + value.length + ')' : value;
        if (type === 'function') return 'fn ' + (value.name || '');
        if (value instanceof ArrayBuffer) return 'ArrayBuffer(' + value.byteLength + ')';
        if (ArrayBuffer.isView(value)) return value.constructor.name + '(' + value.length + ')';
        if (depth > 2) return Array.isArray(value) ? 'Array(' + value.length + ')' : 'Object';
        if (Array.isArray(value)) return value.slice(0, 8).map(v => describe(v, depth + 1));
        const out = {};
        for (const k of Object.keys(value).slice(0, 40)) { try { out[k] = describe(value[k], depth + 1); } catch (_) { out[k] = '?'; } }
        return out;
    }
    function members(obj) {
        const out = new Set();
        let o = obj;
        for (let i = 0; o && o !== Object.prototype && i < 4; i++, o = Object.getPrototypeOf(o)) {
            for (const k of Object.getOwnPropertyNames(o)) {
                if (k === 'constructor') continue;
                let kind = '';
                try { kind = typeof obj[k] === 'function' ? '()' : ''; } catch (_) {}
                out.add(k + kind);
            }
        }
        return Array.from(out).sort();
    }
    function summarize(list) {
        if (!list.length) return null;
        const s = list.slice().sort((a, b) => a - b), pick = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
        const mean = s.reduce((a, b) => a + b, 0) / s.length;
        return { n: s.length, mean: +mean.toFixed(2), min: s[0], p50: pick(0.5), p95: pick(0.95), max: s[s.length - 1] };
    }
    const delay = ms => new Promise(r => setTimeout(r, ms));

    // ---------- overlay ----------
    let box = null;
    function status(lines) {
        try {
            if (!box) {
                box = document.createElement('div');
                box.style.cssText = 'position:fixed;left:12px;bottom:84px;z-index:2147483647;pointer-events:none;' +
                    'font:12px/1.55 Consolas,"Microsoft YaHei",monospace;color:#e9e6df;background:rgba(10,10,11,.86);' +
                    'border:1px solid #ff4d12;border-radius:6px;padding:8px 10px;max-width:420px;white-space:pre-wrap';
                document.body.appendChild(box);
            }
            box.textContent = lines.join('\n');
        } catch (_) {}
    }

    // ---------- environment ----------
    function probeEnv() {
        const env = report.env;
        env.ua = navigator.userAgent;
        env.href = location.href;
        env.dpr = window.devicePixelRatio;
        env.screen = [screen.width, screen.height];
        env.window = [window.innerWidth, window.innerHeight];
        env.cores = navigator.hardwareConcurrency;
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            env.webgl2 = !!gl;
            if (gl) {
                const info = gl.getExtension('WEBGL_debug_renderer_info');
                env.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                env.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
                env.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
                const lose = gl.getExtension('WEBGL_lose_context');
                if (lose) lose.loseContext();
            }
        } catch (e) { fail('webgl', e); }
        env.offscreenCanvas = typeof OffscreenCanvas === 'function';
        env.audioWorklet = typeof AudioWorkletNode === 'function';
        env.offlineAudioContext = typeof OfflineAudioContext === 'function';
        try {
            const url = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
            const worker = new Worker(url);
            env.blobWorker = 'pending';
            worker.onmessage = () => { env.blobWorker = true; worker.terminate(); URL.revokeObjectURL(url); };
            worker.onerror = e => { env.blobWorker = 'error: ' + (e.message || 'unknown'); worker.terminate(); URL.revokeObjectURL(url); };
        } catch (e) { env.blobWorker = 'throw: ' + e.message; }
        try { env.appConfDomain = window.APP_CONF && window.APP_CONF.domain; } catch (_) {}
        env.legacyNativeCmder = !!window.legacyNativeCmder;
        try {
            env.ncmVersion = betterncm.ncm.getNCMFullVersion();
        } catch (e) { fail('ncmVersion', e); }
    }

    // ---------- client modules ----------
    function getRequire() {
        const chunks = window.webpackJsonp;
        if (!chunks || !Array.isArray(chunks) || chunks.push === Array.prototype.push) return null;
        const id = 'bmv_probe_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        let loader = null;
        chunks.push([[id], { [id]: (module, exports, require) => { loader = require; } }, [[id]]]);
        if (loader && loader.c) { delete loader.c[id]; if (loader.m) delete loader.m[id]; }
        return loader && loader.c ? loader : null;
    }
    function findExport(loader, test) {
        for (const key of Object.keys(loader.c)) {
            const exports = loader.c[key] && loader.c[key].exports;
            if (!exports) continue;
            for (const candidate of [exports, exports.default]) {
                try { if (candidate && typeof candidate === 'object' && test(candidate)) return candidate; } catch (_) {}
            }
        }
        return null;
    }
    async function findClient() {
        for (let i = 0; i < 240; i++) {
            try {
                const loader = getRequire();
                if (loader) {
                    const bridgeModule = findExport(loader, x => x.Bridge && typeof x.Bridge.appendRegisterCall === 'function' && typeof x.Bridge.call === 'function');
                    const playerModule = findExport(loader, x => x.AudioPlayer && typeof x.AudioPlayer.subscribePlayStatus === 'function');
                    const dva = findExport(loader, x => x.a && typeof x.a === 'object' && typeof x.a.getStore === 'function');
                    const store = dva && dva.a.inited && dva.a.app && dva.a.app._store;
                    if (bridgeModule && store && typeof store.subscribe === 'function') {
                        report.sdk.modules = Object.keys(loader.c).length;
                        report.sdk.attempts = i + 1;
                        return { bridge: bridgeModule.Bridge, storage: bridgeModule.Storage, player: playerModule && playerModule.AudioPlayer, store };
                    }
                }
            } catch (e) { if (i % 20 === 0) fail('findClient', e); }
            await delay(500);
        }
        return null;
    }
    function recordStorage(storage) {
        const out = {};
        if (!storage) return null;
        for (const k of members(storage)) {
            const name = k.replace(/\(\)$/, '');
            if (k.endsWith('()')) continue;
            try {
                const v = storage[name];
                if (typeof v === 'string' && (/dir|path|cache|folder/i.test(name) || /^[A-Za-z]:[\\/]/.test(v))) out[name] = v;
            } catch (_) {}
        }
        return out;
    }

    // ---------- song ----------
    function readSong(store) {
        const state = store.getState(), p = state && state.playing;
        if (!p) return null;
        const track = p.curTrack || {};
        return {
            at: now(),
            trackId: p.resourceTrackId, onlineId: p.onlineResourceId, type: p.resourceType, fileType: p.trackFileType,
            name: p.resourceName, artists: (p.resourceArtists || []).map(a => a && a.name),
            album: track.album && (track.album.albumName || track.album.name), cover: p.resourceCoverUrl,
            duration: track.duration, playingKeys: Object.keys(p).slice(0, 120), curTrackKeys: Object.keys(track).slice(0, 80)
        };
    }
    function songId(song) {
        const raw = song && (song.fileType === 'local' && song.onlineId ? song.onlineId : song.trackId);
        return raw && /^\d+$/.test(String(raw)) && String(raw) !== '0' ? String(raw) : null;
    }

    // ---------- lyrics ----------
    async function probeLyrics(id, dataDir) {
        const domain = window.APP_CONF && window.APP_CONF.domain;
        const base = typeof domain === 'string' && /^https:\/\/[\w.-]+$/.test(domain) ? domain : 'https://music.163.com';
        const url = base + '/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=' + encodeURIComponent(id);
        const t = performance.now();
        const response = await fetch(url);
        const json = await response.json();
        const lines = part => (part && typeof part.lyric === 'string' ? part.lyric.split('\n').filter(Boolean) : []);
        const out = {
            id, status: response.status, ms: Math.round(performance.now() - t), keys: Object.keys(json),
            lrc: lines(json.lrc).length, tlyric: lines(json.tlyric).length, yrc: lines(json.yrc).length,
            ytlrc: lines(json.ytlrc).length, yromalrc: lines(json.yromalrc).length, romalrc: lines(json.romalrc).length,
            pureMusic: !!json.pureMusic, lrcHead: lines(json.lrc).slice(0, 5), yrcHead: lines(json.yrc).slice(0, 5), tlyricHead: lines(json.tlyric).slice(0, 5)
        };
        if (dataDir) await betterncm.fs.writeFileText(dataDir + '/lyric-' + id + '.json', JSON.stringify(json));
        return out;
    }

    // ---------- the client's cached copy of the song ----------
    async function cacheDirs(storage) {
        const dirs = [];
        const push = d => { if (d && dirs.indexOf(d) < 0) dirs.push(d.replace(/[\\/]+$/, '')); };
        const stored = recordStorage(storage) || {};
        for (const k of Object.keys(stored)) if (/cache/i.test(k)) push(stored[k]);
        try {
            for (const user of await betterncm.fs.readDir('C:/Users')) {
                const name = String(user).split(/[\\/]/).pop();
                push('C:/Users/' + name + '/AppData/Local/NetEase/CloudMusic/Cache/Cache');
            }
        } catch (e) { fail('readDir C:/Users', e); }
        return dirs;
    }
    async function probeCache(id, storage) {
        const out = { id, tried: [], file: null };
        for (const dir of await cacheDirs(storage)) {
            let entries;
            try { if (!await betterncm.fs.exists(dir)) continue; entries = await betterncm.fs.readDir(dir); } catch (e) { out.tried.push({ dir, error: String(e) }); continue; }
            const names = entries.map(e => String(e).split(/[\\/]/).pop());
            const mine = names.filter(n => n.indexOf(id + '-') === 0);
            out.tried.push({ dir, entries: names.length, matches: mine });
            const uc = mine.filter(n => /\.uc$/i.test(n));
            if (!uc.length) continue;
            // Prefer the highest bitrate code the client cached.
            uc.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
            const name = uc[0], stem = name.replace(/\.uc$/i, '');
            const file = out.file = { dir, name };
            try { file.idx = JSON.parse(await betterncm.fs.readFileText(dir + '/' + stem + '.idx')); } catch (e) { file.idxError = String(e); }
            let t = performance.now();
            const blob = await betterncm.fs.readFile(dir + '/' + name);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            file.bytes = bytes.length;
            file.readMs = Math.round(performance.now() - t);
            t = performance.now();
            const words = bytes.length >>> 2, u32 = new Uint32Array(bytes.buffer, 0, words);
            for (let i = 0; i < words; i++) u32[i] ^= 0xA3A3A3A3;
            for (let i = words * 4; i < bytes.length; i++) bytes[i] ^= 0xA3;
            file.xorMs = Math.round(performance.now() - t);
            file.magic = Array.from(bytes.subarray(0, 4)).map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '\\x' + b.toString(16))).join('');
            t = performance.now();
            try {
                const context = new OfflineAudioContext(1, 1, 22050);
                const audio = await context.decodeAudioData(bytes.buffer);
                file.decodeMs = Math.round(performance.now() - t);
                file.decoded = { duration: +audio.duration.toFixed(3), sampleRate: audio.sampleRate, channels: audio.numberOfChannels, length: audio.length };
            } catch (e) { file.decodeError = String(e); file.decodeMs = Math.round(performance.now() - t); }
            break;
        }
        return out;
    }

    // ---------- song URL API (metadata only, nothing downloaded) ----------
    async function probeSongUrl(id) {
        const domain = window.APP_CONF && window.APP_CONF.domain;
        const base = typeof domain === 'string' && /^https:\/\/[\w.-]+$/.test(domain) ? domain : 'https://music.163.com';
        const url = base + '/api/song/enhance/player/url/v1?ids=' + encodeURIComponent('[' + id + ']') + '&level=standard&encodeType=mp3';
        const attempts = [];
        for (const credentials of ['include', 'omit']) {
            try {
                const response = await fetch(url, { credentials });
                const json = await response.json();
                const d = json && json.data && json.data[0];
                attempts.push({
                    credentials, status: response.status, code: json && json.code,
                    item: d ? { code: d.code, br: d.br, level: d.level, type: d.type, size: d.size, fee: d.fee, freeTrial: !!d.freeTrialInfo, urlHost: d.url ? new URL(d.url).host : null } : null
                });
            } catch (e) { attempts.push({ credentials, error: String(e) }); }
        }
        return attempts;
    }

    // ---------- main ----------
    async function main() {
        probeEnv();
        let dataDir = null;
        try {
            dataDir = (await betterncm.app.getDataPath()).replace(/[\\/]$/, '') + '/ncm-better-mv-probe';
            await betterncm.fs.mkdir(dataDir);
            report.dataDir = dataDir;
        } catch (e) { fail('dataDir', e); }
        const write = async () => {
            if (!dataDir) return;
            try {
                const events = report.events;
                const out = Object.assign({}, report, {
                    events: {
                        PlayProgress: events.PlayProgress && Object.assign({}, events.PlayProgress, { intervals: summarize(events.PlayProgress.intervals), intervalsHead: events.PlayProgress.intervals.slice(0, 60) }),
                        PlayState: events.PlayState, Seek: events.Seek, Load: events.Load, End: events.End
                    },
                    audioData: report.audioData && Object.assign({}, report.audioData, { intervals: summarize(report.audioData.intervals), intervalsHead: report.audioData.intervals.slice(0, 60) })
                });
                await betterncm.fs.writeFileText(dataDir + '/report.json', JSON.stringify(out, null, 1));
            } catch (e) { fail('write', e); }
        };

        status(['BetterMV 探针 ' + VERSION, '正在找网易云的内部模块…']);
        const client = await findClient();
        if (!client) {
            report.sdk.found = false;
            status(['BetterMV 探针', '没找到网易云的内部模块，报告已写入。']);
            report.finished = true;
            await write();
            return;
        }
        const { bridge, storage, player, store } = client;
        report.sdk.found = true;
        report.sdk.bridge = members(bridge);
        report.sdk.player = player ? members(player) : null;
        report.sdk.storage = recordStorage(storage);
        try { report.sdk.frameworkPlaying = describe(betterncm.ncm.getPlaying()); } catch (e) { fail('getPlaying', e); }

        // Player events.
        const ev = report.events;
        const progress = ev.PlayProgress = { count: 0, first: [], intervals: [], samples: [], whilePaused: 0 };
        let lastWall = 0, lastTime = null, playing = false, firstPlayWall = 0, playedMs = 0;
        const listen = (name, handler) => {
            try {
                bridge.appendRegisterCall(name, 'audioplayer', handler);
                cleanups.push(() => { try { bridge.removeRegisterCall(name, 'audioplayer', handler); } catch (_) {} });
            } catch (e) { fail('listen ' + name, e); }
        };
        const small = (name) => { ev[name] = []; return (...args) => { if (ev[name].length < 30) ev[name].push({ at: now(), args: describe(args) }); }; };
        listen('PlayProgress', (...args) => {
            const wall = performance.now();
            progress.count++;
            if (progress.first.length < 3) progress.first.push(describe(args));
            if (lastWall && progress.intervals.length < 5000) progress.intervals.push(+(wall - lastWall).toFixed(2));
            if (lastWall && playing) playedMs += Math.min(wall - lastWall, 1000);
            lastWall = wall;
            lastTime = typeof args[1] === 'number' ? args[1] : lastTime;
            if (!playing) progress.whilePaused++;
            if (progress.samples.length < 120 && (progress.count < 80 || progress.count % 25 === 0)) progress.samples.push([Math.round(wall - T0), lastTime]);
            if (!firstPlayWall) firstPlayWall = wall;
        });
        listen('PlayState', small('PlayState'));
        listen('Seek', small('Seek'));
        listen('Load', small('Load'));
        listen('End', small('End'));
        // PlayProgress only arrives while music plays; use it as the source of truth for "playing".
        setInterval(() => { playing = lastWall > 0 && performance.now() - lastWall < 600; }, 200);

        // Real-time audio data: listen first, then switch the stream on only if nothing arrives by itself.
        const audio = report.audioData = { count: 0, intervals: [], bytes: [Infinity, 0], pts: [], samples: [], firstArg: null, preFlow: 0, enabledBy: null };
        let lastAudio = 0;
        const onAudio = (arg) => {
            const wall = performance.now();
            audio.count++;
            if (lastAudio && audio.intervals.length < 5000) audio.intervals.push(+(wall - lastAudio).toFixed(2));
            lastAudio = wall;
            if (!audio.firstArg) audio.firstArg = describe(arg);
            const data = arg && arg.data;
            if (!(data instanceof ArrayBuffer)) return;
            audio.bytes[0] = Math.min(audio.bytes[0], data.byteLength);
            audio.bytes[1] = Math.max(audio.bytes[1], data.byteLength);
            if (audio.pts.length < 300 && (audio.count < 100 || audio.count % 20 === 0)) audio.pts.push([Math.round(wall - T0), arg.pts, lastTime]);
            if (audio.samples.length < 10 && audio.count % 40 === 1) {
                const sample = { byteLength: data.byteLength };
                if (data.byteLength % 4 === 0) {
                    const f = new Float32Array(data);
                    let min = Infinity, max = -Infinity, sum = 0;
                    for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < min) min = v; if (v > max) max = v; sum += v * v; }
                    sample.f32 = { n: f.length, min: +min.toFixed(4), max: +max.toFixed(4), rms: +Math.sqrt(sum / f.length).toFixed(4), head: Array.from(f.subarray(0, 12)).map(v => +v.toFixed(4)) };
                }
                if (data.byteLength % 2 === 0) {
                    const s = new Int16Array(data);
                    let min = Infinity, max = -Infinity;
                    for (let i = 0; i < s.length; i++) { const v = s[i]; if (v < min) min = v; if (v > max) max = v; }
                    sample.i16 = { n: s.length, min, max, head: Array.from(s.subarray(0, 12)) };
                }
                sample.u8head = Array.from(new Uint8Array(data, 0, Math.min(16, data.byteLength)));
                audio.samples.push(sample);
            }
        };
        listen('AudioData', onAudio);
        let weEnabled = false;
        const enableAudio = async () => {
            audio.preFlow = audio.count;
            if (audio.count > 0) { audio.enabledBy = 'already-flowing'; return; }
            try {
                if (player && typeof player.setAudioDataEnableState === 'function') { await player.setAudioDataEnableState(true); audio.enabledBy = 'AudioPlayer.setAudioDataEnableState'; }
                else { await bridge.call('audioplayer.enableAudioData', 1); audio.enabledBy = 'Bridge.call enableAudioData'; }
                weEnabled = true;
            } catch (e) { fail('enableAudioData', e); }
        };
        cleanups.push(async () => {
            if (!weEnabled) return;
            try {
                if (player && typeof player.setAudioDataEnableState === 'function') await player.setAudioDataEnableState(false);
                else await bridge.call('audioplayer.enableAudioData', 0);
            } catch (_) {}
        });

        // Song changes.
        let currentId = null, busy = Promise.resolve();
        const onSong = () => {
            let song;
            try { song = readSong(store); } catch (e) { fail('readSong', e); return; }
            const id = songId(song);
            if (!song || !id || id === currentId) return;
            currentId = id;
            report.song = song;
            if (report.songs.length < 10) report.songs.push({ at: song.at, id, name: song.name });
            busy = busy.then(async () => {
                try { report.lyrics = await probeLyrics(id, dataDir); } catch (e) { fail('lyrics', e); }
                try { report.songUrl = await probeSongUrl(id); } catch (e) { fail('songUrl', e); }
                await delay(3000); // let the client start caching
                try { report.cache = await probeCache(id, storage); } catch (e) { fail('cache', e); }
                await write();
            });
        };
        try { cleanups.push(store.subscribe(onSong)); } catch (e) { fail('store.subscribe', e); }
        onSong();

        // Wait for playback, then enable audio data after a short listen.
        let audioArmed = false;
        const started = performance.now();
        const timer = setInterval(async () => {
            const lines = ['BetterMV 探针 ' + VERSION];
            if (!report.song) lines.push('请在网易云里播放一首歌（建议《Clarity》）');
            else lines.push('歌曲：' + (report.song.name || '?') + ' · ' + (report.song.artists || []).join('/'));
            if (playing && !audioArmed) { audioArmed = true; setTimeout(enableAudio, 1500); }
            const secs = Math.round(playedMs / 1000);
            lines.push('已记录播放 ' + secs + ' / ' + RECORD_MS / 1000 + ' 秒');
            lines.push('进度事件 ' + progress.count + '　音频数据 ' + audio.count);
            lines.push('歌词 ' + (report.lyrics ? (report.lyrics.yrc ? '有逐字' : report.lyrics.lrc ? '只有逐行' : '无') : '…') +
                '　缓存 ' + (report.cache ? (report.cache.file ? (report.cache.file.decoded ? '已解码 ' + report.cache.file.decodeMs + 'ms' : '找到文件') : '没找到') : '…'));
            if (report.errors.length) lines.push('错误 ' + report.errors.length + ' 条（见报告）');
            status(lines);
            const done = playedMs >= RECORD_MS && report.cache && report.lyrics;
            if (done || performance.now() - started > GIVE_UP_MS) {
                clearInterval(timer);
                await busy;
                for (const fn of cleanups.splice(0)) { try { await fn(); } catch (_) {} }
                report.finished = true;
                report.finishedAt = new Date().toISOString();
                await write();
                status(['BetterMV 探针 ' + VERSION, '完成，报告已写入：', (dataDir || '?') + '/report.json', '可以关掉这个探针了。']);
                setTimeout(() => { if (box) box.remove(); }, 20000);
            } else if (Math.round((performance.now() - started) / 1000) % 5 === 0) {
                await write();
            }
        }, 1000);
    }

    plugin.onLoad(() => { main().catch(e => { fail('main', e); }); });
})();
