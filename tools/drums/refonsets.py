# Reference kick / snare / hat onsets from a separated drum stem (the Clarity_MV analyze.py method; snare-band onsets
# whose first 40 ms is treble-led are hats; kicks also from the 100-600 Hz flux, see kick_attacks) -> JSON.
#   python tools/drums/refonsets.py <drums.wav> <ref.json> [mix]
# With the mix (a file soundfile reads, same start), onsets where the stem is 30 dB under the mix are
# dropped: a drumless song's stem is bleed, and the thresholds here are relative to the stem.
import sys, json
import numpy as np, soundfile as sf
from scipy.ndimage import maximum_filter1d, median_filter, uniform_filter1d
from scipy.signal import butter, find_peaks, sosfiltfilt
def band_sos(lo, hi, sr):
    if lo and hi: return butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    if hi: return butter(4, hi, btype="low", fs=sr, output="sos")
    return butter(4, lo, btype="high", fs=sr, output="sos")
def band_onsets(x, sr, lo, hi, win=0.010, hop_s=0.002, min_gap=0.08, rel_db=10.0):
    xb = sosfiltfilt(band_sos(lo, hi, sr), x)
    h = int(hop_s * sr); w = int(win * sr)
    e = np.convolve(xb.astype(np.float64) ** 2, np.ones(w) / w, mode="same")[::h]
    db = 10 * np.log10(e + 1e-10); fps = sr / h
    d = uniform_filter1d(np.diff(db, prepend=db[0]), 3)
    lag = int(0.02 * fps)
    rise = db - np.concatenate([np.full(lag, db[0]), db[:-lag]])
    floor = median_filter(db, int(1.0 * fps) | 1)
    pk, _ = find_peaks(rise, height=rel_db, distance=int(min_gap * fps))
    times, strength = [], []
    for p in pk:
        a = max(0, p - lag); q = a + int(np.argmax(d[a:p + 1]))
        peak_db = db[p:p + int(0.03 * fps)].max()
        if peak_db < floor[p] + 3: continue
        times.append(q / fps); strength.append(peak_db)
    return np.array(times), np.array(strength)
def drum_onsets(d, sr):
    kt, kdb = band_onsets(d, sr, None, 120, win=0.012, min_gap=0.15, rel_db=12)
    st, sdb = band_onsets(d, sr, 1500, 5000, win=0.010, min_gap=0.15, rel_db=10)
    xb = sosfiltfilt(band_sos(500, 5000, sr), d)
    e = np.sqrt(np.convolve(xb.astype(np.float64) ** 2, np.ones(441) / 441, mode="same"))
    tail = np.array([20 * np.log10(e[int((t + 0.04) * sr):int((t + 0.12) * sr)].mean() + 1e-9) for t in st])
    rel = np.array([tail[i] - tail[np.abs(st - st[i]) < 2.5].max() for i in range(len(st))])
    thr = np.percentile(tail, 95) - 25
    keep = (rel > -8) & (tail > thr)
    return (kt, kdb), (st[keep], tail[keep])
def kick_attacks(x, sr, delta=4.0, min_gap=0.06):
    # Onsets of the 100-600 Hz log spectral flux (mean dB rise per bin over 10 ms, against a 0.5 s median): the start
    # of a kick's downward sweep. A < 120 Hz rise misses the kicks of dense patterns (drum & bass, hardcore, J-core,
    # a busy pop chorus) whose sub is still full of the previous kick's tail.
    n, hop = 1024, 88
    win = np.hanning(n).astype(np.float32); nfr = 1 + (len(x) - n) // hop; df = sr / n
    b0, b1 = int(np.ceil(100 / df)), int(600 / df)
    P = np.empty((nfr, b1 - b0 + 1), np.float32)
    for s0 in range(0, nfr, 20000):
        idx = np.arange(n)[None, :] + hop * np.arange(s0, min(nfr, s0 + 20000))[:, None]
        P[s0:s0 + len(idx)] = np.abs(np.fft.rfft(x[idx].astype(np.float32) * win, axis=1)[:, b0:b1 + 1]) ** 2
    db = 10 * np.log10(P + 1e-12); fps = sr / hop; lag = max(1, round(0.01 * fps))
    flux = np.zeros(nfr, np.float32); flux[lag:] = np.maximum(0, db[lag:] - maximum_filter1d(db, 3, axis=1)[:-lag]).mean(1)
    base = median_filter(flux, int(0.5 * fps) | 1)
    lvl = 10 * np.log10(P.sum(1) + 1e-12); loud = np.percentile(lvl, 95)
    pk, _ = find_peaks(flux, distance=int(min_gap * fps))
    keep = np.array([p for p in pk if flux[p] >= base[p] + delta and lvl[min(nfr - 1, p + lag)] >= loud - 35], int)
    return keep * hop / sr + n / 4 / sr
def added_power(x, sr, ts, lo, hi, w=0.025):
    # Mean power the onset adds in a band: the w after it over the w before it (0 if the band falls).
    y = sosfiltfilt(band_sos(lo, hi, sr), x) ** 2
    cs = np.concatenate([[0], np.cumsum(y)])
    S = lambda a, b: cs[min(len(y), max(0, int(b * sr)))] - cs[min(len(y), max(0, int(a * sr)))]
    return np.array([max(0.0, S(t, t + w) - S(t - w, t)) / (w * sr) for t in ts])
def sweep_ratio(x, sr, ts):
    # The 40-500 Hz centroid 75-95 ms after the onset over the one 28-38 ms after (46 ms windows): a kick sweeps down.
    n, hop = 2048, 88
    win = np.hanning(n).astype(np.float32); nfr = 1 + (len(x) - n) // hop; df = sr / n
    b0, b1 = int(np.ceil(40 / df)), int(500 / df); f = np.arange(b0, b1 + 1) * df
    C = np.empty(nfr, np.float32)
    for s0 in range(0, nfr, 20000):
        idx = np.arange(n)[None, :] + hop * np.arange(s0, min(nfr, s0 + 20000))[:, None]
        Pw = np.abs(np.fft.rfft(x[idx].astype(np.float32) * win, axis=1)[:, b0:b1 + 1]) ** 2
        C[s0:s0 + len(idx)] = (Pw * f).sum(1) / (Pw.sum(1) + 1e-12)
    fps, off = sr / hop, n / 2 / sr
    fr = lambda t: int(round((t - off) * fps))
    a = np.array([np.mean(C[max(0, fr(t + 0.028)):fr(t + 0.038) + 1]) for t in ts])
    b = np.array([np.mean(C[max(0, fr(t + 0.075)):fr(t + 0.095) + 1]) for t in ts])
    return b / (a + 1e-9)
def strength01(v):
    if len(v) == 0: return v
    lo, hi = np.percentile(v, 5), np.percentile(v, 95)
    return np.clip((v - lo) / (hi - lo + 1e-9) * 0.8 + 0.2, 0, 1)
x, sr = sf.read(sys.argv[1]); x = x.mean(axis=1) if x.ndim > 1 else x
(kt, kdb), (st, sdb) = drum_onsets(x, sr)
# On the clean stem a snare / clap is mid-led (1-5 kHz over >7 kHz in its first 40 ms, bimodal around +2 dB); the
# rest of the 1.5-5 kHz onsets are hats (open hats on the off-beat).
mid = sosfiltfilt(band_sos(1000, 5000, sr), x); high = sosfiltfilt(band_sos(7000, None, sr), x)
ratio = np.array([10 * np.log10(((mid[int(t*sr):int((t+0.04)*sr)] ** 2).mean() + 1e-12) / ((high[int(t*sr):int((t+0.04)*sr)] ** 2).mean() + 1e-12)) for t in st])
is_snare = ratio >= 2
ht, hdb = band_onsets(x, sr, 7000, None, win=0.006, min_gap=0.06, rel_db=9)
hats = sorted(set([round(float(t), 3) for t in ht]) | set([round(float(t), 3) for t in st[~is_snare]]))
hats = [t for i, t in enumerate(hats) if i == 0 or t - hats[i - 1] > 0.03]
# Kicks: the < 120 Hz rises, and the 100-600 Hz flux onsets whose added power is low-led (40-400 Hz over 1.5-8 kHz),
# or treble-led (a distorted kick's click) but sweeping down (centroid ratio <= 0.6) and not on a snare. Within 60 ms
# the < 120 Hz onset's time is kept.
at = kick_attacks(x, sr)
low_led = 10 * np.log10((added_power(x, sr, at, 40, 400) + 1e-12) / (added_power(x, sr, at, 1500, 8000) + 1e-12)) >= 0
snares = st[is_snare]
on_snare = np.array([snares.size > 0 and np.abs(snares - t).min() < 0.03 for t in at], bool)
at = at[low_led | ((sweep_ratio(x, sr, at) <= 0.6) & ~on_snare)]
merged = []
for t, old in sorted([(float(t), True) for t in kt] + [(float(t), False) for t in at]):
    if merged and t - merged[-1][0] < 0.06:
        if old and not merged[-1][1]: merged[-1] = (t, True)
        continue
    merged.append((t, old))
kt = np.array([t for t, _ in merged])
lowb = sosfiltfilt(band_sos(None, 120, sr), x)
kdb = np.array([10 * np.log10((lowb[int(t * sr):int((t + 0.03) * sr)] ** 2).mean() + 1e-12) for t in kt])
ksn, ssn = strength01(kdb), strength01(sdb[is_snare])
kicks = [[round(float(t), 3), round(float(s), 3)] for t, s in zip(kt, ksn)]
snare_list = [[round(float(t), 3), round(float(s), 3)] for t, s in zip(st[is_snare], ssn)]
hat_list = [[t, 1.0] for t in hats]
if len(sys.argv) > 3:
    m, msr = sf.read(sys.argv[3]); m = m.mean(axis=1) if m.ndim > 1 else m
    db = lambda y, r, t: 10 * np.log10((y[int(t * r):int((t + 0.05) * r)] ** 2).mean() + 1e-12)
    audible = lambda t: db(x, sr, t) >= db(m, msr, t) - 30
    kicks, snare_list, hat_list = [[h for h in v if audible(h[0])] for v in (kicks, snare_list, hat_list)]
json.dump({"kick": kicks, "snare": snare_list, "hat": hat_list}, open(sys.argv[2], "w"))
print(len(kicks), "kicks", len(snare_list), "snares", len(hat_list), "hats")
