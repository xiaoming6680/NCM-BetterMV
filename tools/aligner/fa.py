# Lyric forced alignment for BetterMV's optional aligner pack: numpy + onnxruntime only.
#
# NetEase gives most songs line-timed lyrics only; the plugin then spreads each line's words over the line by syllable
# count. This finds when each word is actually sung: MMS-FA (Meta's multilingual CTC aligner, 1 130 languages through
# romanised text) gives per-frame letter probabilities for the vocal track, and a CTC Viterbi fits the line's letters
# to them, each line held near its line timestamp so a repeated line can't slide onto the repeat next to it.
# Measured in docs/ALIGNER.md.
import re
import numpy as np

LABELS = ['-', 'a', 'i', 'e', 'n', 'o', 'u', 't', 's', 'r', 'm', 'k', 'l', 'd', 'g', 'h', 'y', 'b', 'p', 'w', 'c',
          'v', 'j', 'z', 'f', "'", 'q', 'x', '*']
IDX = {c: i for i, c in enumerate(LABELS)}
BLANK, STAR = 0, IDX['*']
RATE, HOP = 16000, 320
FPS = RATE / HOP

HAN = re.compile(r'[㐀-鿿豈-﫿]')
HANGUL = re.compile(r'[가-힣]')

# Kana → romaji (Hepburn-ish; small kana and the long-vowel mark lengthen nothing, which is fine for alignment).
_KANA = dict(zip(
    'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゃゅょっゔ',
    'a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo '
    'ra ri ru re ro wa o n ga gi gu ge go za ji zu ze zo da ji zu de do ba bi bu be bo pa pi pu pe po a i u e o ya yu yo '
    '_ vu'.split()))

def _kana(ch):
    o = ord(ch)
    if 0x30a1 <= o <= 0x30f6: ch = chr(o - 0x60)  # katakana → hiragana
    r = _KANA.get(ch)
    return '' if r in (None, '_') else r

# Hangul syllable → revised romanisation (initial, vowel, final).
_L = 'g kk n d tt r m b pp s ss _ j jj ch k t p h'.split()
_V = 'a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i'.split()
_T = '_ k k k n n n t l k m l l l p l m p p t t ng t t k t p t'.split()

def _hangul(ch):
    o = ord(ch) - 0xac00
    l, v, t = o // 588, (o % 588) // 28, o % 28
    return _L[l].replace('_', '') + _V[v] + (_T[t].replace('_', '') if t else '')

_pinyin = None

def romanize(word):
    """Letter indices the model knows for a word: Han as toneless pinyin, kana and hangul romanised, Latin as is.
    Empty for words with none (numbers, kanji read in Japanese are still read as pinyin — close enough to place)."""
    global _pinyin
    if HAN.search(word):
        if _pinyin is None:
            from pypinyin import lazy_pinyin
            _pinyin = lazy_pinyin
        word = ''.join(_pinyin(word))
    out = []
    for ch in word.lower():
        if '぀' <= ch <= 'ヿ': out.append(_kana(ch))
        elif HANGUL.match(ch): out.append(_hangul(ch))
        else: out.append(ch)
    s = ''.join(out).replace('’', "'").replace('ü', 'u')
    for src, dst in (('àáâãäå', 'a'), ('èéêë', 'e'), ('ìíîï', 'i'), ('òóôõöø', 'o'), ('ùúû', 'u'), ('ç', 'c'), ('ñ', 'n'), ('ýÿ', 'y')):
        s = re.sub(f'[{src}]', dst, s)
    return [IDX[c] for c in s if c in IDX and c not in '*-']

def syllables(word):
    """Rough syllable count, as the plugin counts them (src/lyrics/parse.ts): a CJK character is one."""
    if re.search(r'[぀-ヿ㐀-鿿豈-﫿가-힯]', word): return len(re.findall(r'[぀-ヿ㐀-鿿豈-﫿가-힯]', word))
    groups = re.findall(r'[aeiouy]+', re.sub(r'e$', '', re.sub(r'[^a-z]', '', word.lower())))
    return max(1, len(groups))

OPEN, CLOSE = '(（[【', ')）]】'

def asides(words):
    """Words inside brackets: backing vocals sung over the lead. They are left out of the alignment (forced alignment
    assumes one voice singing one word after another)."""
    out, depth = [], 0
    for w in words:
        if w[:1] in OPEN: depth += 1
        out.append(depth > 0)
        if w[-1:] in CLOSE: depth = max(0, depth - 1)
    return out

def resample(x, src, dst=RATE):
    """Band-limited resampling by FFT, in overlapping blocks (memory stays small for long songs)."""
    if src == dst: return x.astype(np.float32)
    block, pad = src * 30, src
    out = []
    for s in range(0, len(x), block):
        a, b = max(0, s - pad), min(len(x), s + block + pad)
        seg = x[a:b].astype(np.float64)
        n_out = int(round(len(seg) * dst / src))
        spec = np.fft.rfft(seg)
        keep = n_out // 2 + 1
        spec = spec[:keep] if keep <= len(spec) else np.pad(spec, (0, keep - len(spec)))
        y = np.fft.irfft(spec, n_out) * (n_out / len(seg))
        y0 = int(round((s - a) * dst / src))
        y1 = y0 + int(round((min(len(x), s + block) - s) * dst / src))
        out.append(y[y0:y1])
    return np.concatenate(out).astype(np.float32) if out else np.zeros(0, np.float32)

def emissions(sess, audio, chunk=30.0, ctx=1.0, progress=None):
    """Letter log-probabilities [frames, 29] for a 16 kHz track (the star column is 0: it may stand for anything),
    run in overlapping chunks."""
    n = len(audio)
    T = max(0, (n - 400) // HOP + 1)
    out = np.full((T, len(LABELS)), -30.0, np.float32)
    out[:, STAR] = 0.0
    step, c = int(chunk * RATE), int(ctx * RATE)
    starts = list(range(0, n, step))
    for k, s in enumerate(starts):
        a, b = max(0, s - c), min(n, s + step + c)
        x = audio[a:b]
        if len(x) < 4000: continue
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-5)
        lg = sess.run(None, {'audio': x[None].astype(np.float32)})[0][0]
        lg = lg - lg.max(-1, keepdims=True)
        lg = lg - np.log(np.exp(lg).sum(-1, keepdims=True))
        f0 = a // HOP
        f_lo, f_hi = s // HOP, min(T, (s + step) // HOP)
        k0, k1 = f_lo - f0, min(len(lg), f_hi - f0)
        if k1 > k0: out[f_lo:f_lo + (k1 - k0), :-1] = lg[k0:k1]
        if progress: progress((k + 1) / len(starts))
    return out

def viterbi(lp, targets, lo, hi):
    """CTC forced alignment of `targets` on log-probs lp [T, C]; target k may only be emitted in frames lo[k]..hi[k].
    Returns (first frame, last frame, mean log-prob) per target, or None when no path fits the bounds."""
    T, L = len(lp), len(targets)
    S = 2 * L + 1
    lab = np.zeros(S, np.int64); lab[1::2] = targets
    tok = np.zeros(S, bool); tok[1::2] = True
    lo_s = np.zeros(S, np.int64); hi_s = np.full(S, T - 1, np.int64)
    lo_s[1::2] = lo; hi_s[1::2] = hi
    skip = np.zeros(S, bool)
    if L > 1: skip[3::2] = np.asarray(targets[1:]) != np.asarray(targets[:-1])
    NEG = np.float32(-1e9)
    dp = np.full(S, NEG, np.float32)
    dp[0] = lp[0, BLANK]
    if lo_s[1] <= 0 <= hi_s[1]: dp[1] = lp[0, lab[1]]
    back = np.zeros((T, S), np.int8)
    neg1, neg2 = np.array([NEG], np.float32), np.array([NEG, NEG], np.float32)
    for t in range(1, T):
        adv = np.concatenate([neg1, dp[:-1]])
        sk = np.where(skip, np.concatenate([neg2, dp[:-2]]), NEG)
        best = np.maximum(dp, np.maximum(adv, sk))
        back[t] = np.where(best == dp, 0, np.where(best == adv, 1, 2))
        allowed = ~tok | ((lo_s <= t) & (t <= hi_s))
        dp = np.where(allowed, best + lp[t, lab], NEG).astype(np.float32)
    end = S - 1 if dp[S - 1] >= dp[S - 2] else S - 2
    if dp[end] <= NEG / 2: return None
    first = np.full(L, -1, np.int64); last = np.full(L, -1, np.int64)
    score = np.zeros(L); frames = np.zeros(L)
    s = end
    for t in range(T - 1, -1, -1):
        if s % 2:
            k = s // 2
            first[k] = t
            if last[k] < 0: last[k] = t
            score[k] += lp[t, lab[s]]; frames[k] += 1
        s -= int(back[t, s])
    return first, last, score / np.maximum(frames, 1)

def align(lp, lines, pre=0.5, late=1.5, post=0.5, max_group=15.0, base=2.0, per_syllable=0.8, lead=0.04):
    """lines: [{'start': s, 'next': s, 'words': [text]}] (next = the following line's start).
    Returns per line {'words': [[start, end] or None], 'conf': mean letter probability or None}.
    A line's letters stay between its timestamp − pre and the next line's + post, and within base + per_syllable
    seconds a syllable of its start: before a long instrumental the next line is far away, and a hook's letters would
    otherwise drift onto the vocal chops of the drop after it. Starts are moved `lead` earlier: CTC marks a letter a
    frame or two after it begins."""
    dur = len(lp) / FPS
    lines = [dict(l, next=min(l['next'], l['start'] + base + per_syllable * sum(syllables(w) for w in l['words']))) for l in lines]
    result = [{'words': [None] * len(l['words']), 'conf': None} for l in lines]
    groups, cur = [], []
    for i, l in enumerate(lines):
        if cur and (l['start'] - lines[cur[0]]['start'] > max_group or l['start'] - lines[cur[-1]]['next'] > 0.5):
            groups.append(cur); cur = []
        cur.append(i)
    if cur: groups.append(cur)
    for g in groups:
        w0 = max(0.0, lines[g[0]]['start'] - pre)
        w1 = min(dur, max(lines[i]['next'] for i in g) + post)
        f0, f1 = int(w0 * FPS), int(w1 * FPS)
        if f1 - f0 < 10: continue
        span = f1 - f0 - 1
        targets, lo, hi, owner = [STAR], [0], [span], [None]
        for i in g:
            l = lines[i]
            a = max(0, int((l['start'] - pre) * FPS) - f0)
            b = min(span, int((l['next'] + post) * FPS) - f0)
            first_hi = min(b, int((l['start'] + late) * FPS) - f0)
            started = False
            for j, (w, aside) in enumerate(zip(l['words'], asides(l['words']))):
                letters = [] if aside else romanize(w)
                if not letters: continue
                for k, c in enumerate(letters):
                    targets.append(c); lo.append(a); hi.append(b if started else first_hi)
                    owner.append((i, j, k == 0, k == len(letters) - 1))
                    started = True
                targets.append(STAR); lo.append(0); hi.append(span); owner.append(None)
        if len(targets) <= 1: continue
        fit = viterbi(lp[f0:f1], targets, np.array(lo), np.array(hi))
        if fit is None: continue
        first, last, score = fit
        probs = {}
        for k, o in enumerate(owner):
            if o is None: continue
            i, j, is_first, is_last = o
            probs.setdefault(i, []).append(float(np.exp(score[k])))
            cell = result[i]['words'][j] or [None, None]
            if is_first: cell[0] = round(max(0.0, (f0 + first[k]) / FPS - lead), 3)
            if is_last: cell[1] = round((f0 + last[k] + 1) / FPS, 3)
            result[i]['words'][j] = cell
        for i, p in probs.items(): result[i]['conf'] = round(float(np.mean(p)), 4)
    return result
