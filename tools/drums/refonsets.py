# Reference kick / snare / hat onsets from a separated drum stem (the Clarity_MV analyze.py method; snare-band onsets
# whose first 40 ms is treble-led are hats) -> JSON.
#   python tools/drums/refonsets.py <drums.wav> <ref.json>
import sys, json
import numpy as np, soundfile as sf
from scipy.ndimage import median_filter, uniform_filter1d
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
json.dump({"kick": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(kt, strength01(kdb))],
           "snare": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(st[is_snare], strength01(sdb[is_snare]))],
           "hat": [[t, 1.0] for t in hats]}, open(sys.argv[2], "w"))
print(len(kt), "kicks", int(is_snare.sum()), "snares", len(hats), "hats")
