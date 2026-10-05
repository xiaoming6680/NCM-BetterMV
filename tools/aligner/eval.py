# How well the aligner pack places words: songs in the NetEase cache that have both word-timed (yrc) and line-timed
# (lrc) lyrics; the line-timed ones are aligned the way the plugin does it (fa.py on the whole mix at 16 kHz, then
# src/plugin/aligner.ts applyAlignment's rules), the word-timed ones are the answer. Prints word-start error before
# (the plugin's syllable spread) and after.
#
#   python tools/aligner/eval.py --model <mms_fa.onnx> [--cpu] [--ttml <dir>] [ids…]
#
# Needs numpy, onnxruntime (-directml for the GPU), pypinyin and soundfile. Lyrics are fetched from NetEase's public
# API once and kept in dev/align-eval/. --ttml <dir>: AMLL TTML files (<song id>.ttml, community word-timed lyrics)
# as the answer for songs NetEase has no yrc for.
import argparse, glob, io, json, os, re, sys, time, urllib.request
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import fa

CACHE = os.environ.get('BMV_NCM_CACHE') or os.path.expandvars(r'%LOCALAPPDATA%\NetEase\CloudMusic\Cache\Cache')
STORE = os.path.join(ROOT, 'dev', 'align-eval')
MIN_CONF = 0.005  # src/plugin/aligner.ts

ap = argparse.ArgumentParser()
ap.add_argument('ids', nargs='*')
ap.add_argument('--model', required=True)
ap.add_argument('--cpu', action='store_true')
ap.add_argument('--ttml')
a = ap.parse_args()

# --- lyrics, as src/lyrics/parse.ts reads them -------------------------------------------------------------------
STAMP = re.compile(r'\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]')
LEAD = re.compile(r'^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+')
CJK = '぀-ヿ㐀-鿿豈-﫿가-힯'
TOKEN = re.compile(rf'[{CJK}]|[^\s{CJK}]+')
PUNCT = re.compile(r'^[\W_]+$')
OPENING = re.compile(r'^[(\[{（【「『“‘]+$')
CREDIT = re.compile(r'^[^:：]{0,30}(作词|作曲|编曲|制作|Producer|Produced|Written|Composer|Lyricist)[^:：]{0,30}[:：]', re.I)

def lrc_entries(text):
    out = []
    for raw in (text or '').replace('\r', '').split('\n'):
        line = raw.strip()
        lead = LEAD.match(line) if line and line[0] != '{' else None
        if not lead: continue
        for m, s, f in STAMP.findall(lead.group(0)):
            out.append((int(m) * 60 + int(s) + (int(f.ljust(3, '0')) / 1000 if f else 0), line[lead.end():].strip()))
    return sorted(out, key=lambda x: x[0])

def tokenize(text):
    out, pending = [], ''
    for s in TOKEN.findall(text):
        if PUNCT.match(s):
            if OPENING.match(s) or not out: pending += s
            else: out[-1] += s
        else: out.append(pending + s); pending = ''
    return out

def norm(w): return re.sub(r'[\W_]+', '', w.lower())

def spread(tokens, start, end):
    """The plugin's estimate (spreadWords)."""
    w = [fa.syllables(t) for t in tokens]; total = sum(w)
    sung = min(end - start, max(0.6, total * 0.4))
    out, t = [], start
    for x in w: out.append(t); t += sung * x / total
    return out

YRC_LINE = re.compile(r'^\[(\d+),(\d+)\](.*)$')
YRC_WORD = re.compile(r'\((\d+),(\d+),\d+\)([^(]*)')
def yrc_lines(text):
    lines = []
    for raw in (text or '').replace('\r', '').split('\n'):
        m = YRC_LINE.match(raw.strip())
        if not m: continue
        words, opened = [], False
        for s, d, t in YRC_WORD.findall(m.group(3)):
            body = t.strip()
            if body and opened and words and not t[:1].isspace() and not re.search(f'[{CJK}]', words[-1][1][-1] + body[0]):
                words[-1] = (words[-1][0], words[-1][1] + body)
            elif body: words.append((int(s) / 1000, body))
            opened = bool(body) and not t[-1:].isspace()
        out = []
        for s, t in words:
            if PUNCT.match(t):
                if out and not OPENING.match(t): out[-1] = (out[-1][0], out[-1][1] + t)
                continue
            out.append((s, t))
        if out: lines.append(out)
    return lines

def ttml_lines(text):
    sec = lambda x: sum(float(p) * 60 ** i for i, p in enumerate(reversed(x.split(':'))))
    out = []
    for body in re.findall(r'<p [^>]*>(.*?)</p>', text, re.S):
        body = re.sub(r'<span[^>]*ttm:role="x-(bg|translation|roman)"[^>]*>.*?</span>', '', body, flags=re.S)
        spans = re.findall(r'<span begin="([\d:.]+)" end="[\d:.]+"[^>]*>([^<]*)</span>', body)
        if spans: out.append([(sec(b), w) for b, w in spans])
    return out

def pairs(lrc, truth):
    """lrc lines matched to answer lines with the same words: [{start, next, tokens, truth}]."""
    entries = [(t, x) for t, x in lrc_entries(lrc) if x]
    out = []
    for i, (t, text) in enumerate(entries):
        toks = tokenize(text)
        if not toks or CREDIT.search(text): continue
        key = ''.join(map(norm, toks))
        best = None
        for words in truth:
            if abs(words[0][0] - t) < 2 and ''.join(norm(w) for _, w in words) == key and len(words) == len(toks):
                if best is None or abs(words[0][0] - t) < abs(best[0][0] - t): best = words
        if best: out.append({'start': t, 'next': entries[i + 1][0] if i + 1 < len(entries) else t + 8, 'tokens': toks, 'truth': [s for s, _ in best]})
    # Answers made for another edit of the song (or of the lyrics) are no answer.
    if out and np.median([abs(p['start'] - p['truth'][0]) for p in out]) > 0.6: return []
    return out

# --- the plugin's rules for using an alignment (applyAlignment, starts only) -------------------------------------
def apply(tokens, r):
    if r['conf'] is None or r['conf'] < MIN_CONF: return None
    st = [w[0] if w and w[0] is not None else None for w in r['words']]
    known = [j for j, s in enumerate(st) if s is not None]
    if not known: return None
    syl = [fa.syllables(t) for t in tokens]
    t = [None] * len(tokens)
    for j in known: t[j] = st[j]
    for j in range(known[0] - 1, -1, -1): t[j] = t[j + 1] - 0.3 * syl[j]
    for k in range(len(known) - 1):
        x, y = known[k], known[k + 1]; total = sum(syl[x:y]); acc = 0
        for j in range(x + 1, y): acc += syl[j - 1]; t[j] = t[x] + (t[y] - t[x]) * acc / total
    for j in range(known[-1] + 1, len(t)): t[j] = t[j - 1] + 0.3 * syl[j - 1]
    for j in range(1, len(t)): t[j] = max(t[j], t[j - 1])
    return t

# --- songs ---------------------------------------------------------------------------------------------------------
def cached_audio():
    out = {}
    for name in os.listdir(CACHE):
        m = re.match(r'^(\d+)-(\d+)-[0-9a-f]+\.uc$', name)
        if not m: continue
        try:
            idx = json.load(open(os.path.join(CACHE, name[:-3] + '.idx'), encoding='utf-8'))
            if idx['zone'] != [f"0 {int(idx['size']) - 1}"]: continue
        except Exception: continue
        if m.group(1) not in out or int(m.group(2)) > out[m.group(1)][1]: out[m.group(1)] = (name, int(m.group(2)))
    return {k: os.path.join(CACHE, v[0]) for k, v in out.items()}

def lyric(sid):
    path = os.path.join(STORE, 'lyrics', sid + '.json')
    if os.path.exists(path): return json.load(open(path, encoding='utf-8'))
    url = f'https://music.163.com/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id={sid}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/'})
    d = json.loads(urllib.request.urlopen(req, timeout=10).read().decode('utf-8'))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
    time.sleep(0.5)
    return d

import onnxruntime as ort
sess = ort.InferenceSession(a.model, providers=([] if a.cpu else ['DmlExecutionProvider']) + ['CPUExecutionProvider'])
audio_files = cached_audio()
ids = a.ids or sorted(audio_files)
err = {'before': [], 'after': [], 'first': [], 'rest': []}
lines_used = [0, 0]
t_align = 0.0
for sid in ids:
    if sid not in audio_files: continue
    try: doc = lyric(sid)
    except Exception as e: print(sid, '歌词没取到', e); continue
    lrc = (doc.get('lrc') or {}).get('lyric')
    ttml = os.path.join(a.ttml, sid + '.ttml') if a.ttml else None
    truth = ttml_lines(open(ttml, encoding='utf-8').read()) if ttml and os.path.exists(ttml) else yrc_lines((doc.get('yrc') or {}).get('lyric'))
    ps = pairs(lrc, truth) if lrc and truth else []
    if not ps: continue
    raw = (np.frombuffer(open(audio_files[sid], 'rb').read(), np.uint8) ^ 0xA3).tobytes()
    y, rate = sf.read(io.BytesIO(raw), dtype='float32', always_2d=True)
    t0 = time.time()
    lp = fa.emissions(sess, fa.resample(y.mean(1), rate))
    res = fa.align(lp, [{'start': p['start'], 'next': p['next'], 'words': p['tokens']} for p in ps])
    t_align += time.time() - t0
    song = []
    for p, r in zip(ps, res):
        base = spread(p['tokens'], p['start'], p['next'])
        got = apply(p['tokens'], r)
        lines_used[0] += got is not None; lines_used[1] += 1
        for j, (e, b, tr) in enumerate(zip(got or base, base, p['truth'])):
            err['after'].append(abs(e - tr)); err['before'].append(abs(b - tr)); err['first' if j == 0 else 'rest'].append(abs(e - tr))
            song.append(abs(e - tr))
    print(sid, f'{len(ps)} 句', f'误差中位数 {np.median(song):.3f} s', flush=True)

def summary(e):
    e = np.array(e)
    return f'{len(e)} 个词 · 中位数 {np.median(e):.3f} s · ≤0.1 s {np.mean(e <= 0.1):.1%} · ≤0.25 s {np.mean(e <= 0.25):.1%}' if len(e) else '—'
print(f'对齐用时 {t_align:.0f} s，用上对齐的句子 {lines_used[0]}/{lines_used[1]}')
print('估算  ', summary(err['before']))
print('对齐后', summary(err['after']))
print('  句首', summary(err['first']))
print('  其余', summary(err['rest']))
