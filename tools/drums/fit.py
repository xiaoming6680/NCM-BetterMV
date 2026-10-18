# Fit the drum gates on candidate features (features.ts csv + refonsets.py json, in the cwd), each song held out of
# its own fit; compared with the gate in hits.ts ("current", CURRENT below: keep it in step). A song with no reference
# hits of the kind (a drumless ballad) only adds negatives: it is left out of the mean F and shows its false hits.
#   python fit.py kick|snare song1 song2 …                      all features, then a backward search for a small model
#   python fit.py kick|snare song… --try "f1,f2;f1,f3"          held-out F of the given feature sets
#   python fit.py kick|snare song… --final "f1,f2"              weights for hits.ts (fitted on all songs)
#   python fit.py kick song… --tail "f1,f2"                      the tail-kick gate over the src 1 rows (see --tail below)
#   python fit.py kick song… --tail-final "f1,f2"               its weights for hits.ts, given KICK_GATE
import sys, json
import numpy as np
from sklearn.linear_model import LogisticRegression
kind = sys.argv[1]; songs = [a for a in sys.argv[2:] if not a.startswith('--') and ',' not in a and ';' not in a]
FEATS = {
    'kick':  ['lodf', 'lloc', 'ldom', 'decay60', 'decay150', 'lpre', 'lflux', 'lcross', 'grid4', 'grid8', 'grid16', 'sweep'],
    'snare': ['lodf', 'lloc', 'ldom', 'decay60', 'decay150', 'lpre', 'lflux', 'lcross', 'lmh', 'grid4', 'grid8', 'grid16'],
}[kind]
# The gates of hits.ts (KICK_GATE / SNARE_GATE), over this script's feature names.
CURRENT = {
    'kick':  ({'lodf': -0.343, 'ldom': 3.0915, 'lpre': 0.0594, 'decay150': -1.077, 'grid8': -6.3, 'grid16': -4.9591, 'sweep': -1.7644}, 2.1636, 0.46),
    'snare': ({'lodf': 3.188, 'ldom': -0.2099, 'lpre': -0.8695, 'decay150': -2.6032, 'grid4': -8.6747, 'grid8': -11.9825}, 3.7696, 0.55),
}[kind]
def load(s, src=0):
    import csv
    rows = [r for r in csv.DictReader(open(f'{s}-{kind}.csv')) if int(r.get('src', 0)) == src]
    ref = json.load(open(f'{s}-ref.json'))[kind]
    d = {k: np.array([float(r[k]) for r in rows]) for k in (rows[0].keys() if rows else [])}
    eps = 1e-4
    if rows:
        d['lodf'] = np.log(d['odfRel'] + eps); d['lloc'] = np.log(d['odfLocal'] + eps); d['ldom'] = np.log(d['dominance'] + eps)
        d['lpre'] = np.log(d['pre'] + eps); d['lflux'] = np.log(d['flux'] + eps); d['lcross'] = np.log(d['cross'] + eps); d['lmh'] = np.log(d['midHigh'] + eps)
    return d, len(ref)
data = {s: load(s) for s in songs}
rated = lambda ss: [s for s in ss if data[s][1]]
def current_rule(d):
    w, b, thr = CURRENT
    logit = b + sum(v * d[k] for k, v in w.items())
    return 1 / (1 + np.exp(-logit)) >= thr
def prf(keep, d, nref):
    tp = int((keep & (d['label'] == 1)).sum()); p = tp / max(1, keep.sum()); r = tp / max(1, nref)
    return p, r, 2 * p * r / max(1e-9, p + r)
X = lambda d, feats: np.stack([d[f] for f in feats], 1)
def evaluate(feats, C=1.0, verbose=True):
    tot_cur, tot_new = [], []
    for held in songs:
        tr = [s for s in songs if s != held]
        Xtr = np.concatenate([X(data[s][0], feats) for s in tr]); ytr = np.concatenate([data[s][0]['label'] for s in tr])
        mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
        m = LogisticRegression(C=C, max_iter=2000).fit((Xtr - mu) / sd, ytr)
        # threshold maximising summed F on the training songs
        best_t, best_f = 0.5, -1
        for t in np.linspace(0.1, 0.9, 33):
            f = np.mean([prf(m.predict_proba((X(data[s][0], feats) - mu) / sd)[:, 1] >= t, data[s][0], data[s][1])[2] for s in rated(tr)])
            if f > best_f: best_f, best_t = f, t
        d, nref = data[held]
        keep = m.predict_proba((X(d, feats) - mu) / sd)[:, 1] >= best_t
        c, n = prf(current_rule(d), d, nref), prf(keep, d, nref)
        if nref: tot_cur.append(c); tot_new.append(n)
        fc, fn = int((current_rule(d) & (d['label'] == 0)).sum()), int((keep & (d['label'] == 0)).sum())
        if verbose: print(f'  {held:14s} current P/R/F {c[0]:.2f}/{c[1]:.2f}/{c[2]:.2f} false {fc:4d}   fitted {n[0]:.2f}/{n[1]:.2f}/{n[2]:.2f} false {fn:4d}  (thr {best_t:.2f})')
    mc, mn = np.mean([c[2] for c in tot_cur]), np.mean([n[2] for n in tot_new])
    print(f'  mean F  current {mc:.3f}  fitted {mn:.3f}   feats {feats}')
    return mn
# Tail kicks (hits.ts KICK_TAIL_GATE): the src 1 rows with ≥ TAIL_MIN kicks of probability ≥ TAIL_SURE within ±TAIL_SPAN s
# (by the kick gate) get a feature context = ln(1 + that count) and a gate of their own; held-out F counts a reference
# kick as found when any kept kick of either kind is within 50 ms (two kept peaks can share one).
TAIL_SURE, TAIL_MIN, TAIL_SPAN = 0.9, 5, 2.0
if '--tail' in sys.argv or '--tail-final' in sys.argv:
    final = '--tail-final' in sys.argv
    tfeats = sys.argv[sys.argv.index('--tail-final' if final else '--tail') + 1].split(',')
    mfeats = list(CURRENT[0])
    tail = {s: load(s, 1)[0] for s in songs}
    nrow = lambda d: len(d['t']) if d else 0
    refs = {s: np.sort([h[0] for h in json.load(open(f'{s}-ref.json'))[kind]]) for s in songs}
    sig = lambda z: 1 / (1 + np.exp(-z))
    def covered(times, ref):
        if not len(ref) or not len(times): return np.zeros(len(ref), bool)
        kt = np.sort(times); i = np.minimum(np.searchsorted(kt, ref - 0.05), len(kt) - 1)
        return (kt[i] >= ref - 0.05) & (kt[i] <= ref + 0.05)
    def prf_of(s, keep_m, keep_t):
        d, td, ref = data[s][0], tail[s], refs[s]
        if not len(ref): return 0.0, 0.0, 0.0
        kept = np.concatenate([d['label'][keep_m], td['label'][keep_t] if nrow(td) else []])
        p = kept.mean() if len(kept) else 0; r = covered(np.concatenate([d['t'][keep_m], td['t'][keep_t] if nrow(td) else []]), ref).mean()
        return p, r, 2 * p * r / max(1e-9, p + r)
    f_of = lambda s, keep_m, keep_t: prf_of(s, keep_m, keep_t)[2]
    def main_gate(tr):
        # the kick gate fitted on the training songs (as evaluate), or KICK_GATE for the final weights
        if final: return np.array([CURRENT[0][k] for k in mfeats]), CURRENT[1], CURRENT[2]
        Xtr = np.concatenate([X(data[s][0], mfeats) for s in tr]); ytr = np.concatenate([data[s][0]['label'] for s in tr])
        mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
        m = LogisticRegression(C=1.0, max_iter=2000).fit((Xtr - mu) / sd, ytr)
        w, b = m.coef_[0] / sd, m.intercept_[0] - (m.coef_[0] * mu / sd).sum()
        thr = max(np.linspace(0.1, 0.9, 33), key=lambda t: np.mean([f_of(s, sig(X(data[s][0], mfeats) @ w + b) >= t, np.zeros(nrow(tail[s]), bool)) for s in rated(tr)]))
        return w, b, thr
    def context(w, b):
        for s in songs:
            d, td = data[s][0], tail[s]
            if not nrow(td): continue
            sure = np.sort(d['t'][sig(X(d, mfeats) @ w + b) >= TAIL_SURE])
            n = np.searchsorted(sure, td['t'] + TAIL_SPAN) - np.searchsorted(sure, td['t'] - TAIL_SPAN)
            td['n'] = n; td['context'] = np.log1p(n)
    def tail_gate(tr, w, b, thr, grid):
        rows = [s for s in tr if nrow(tail[s])]
        Xt = np.concatenate([X(tail[s], tfeats)[tail[s]['n'] >= TAIL_MIN] for s in rows]); yt = np.concatenate([tail[s]['label'][tail[s]['n'] >= TAIL_MIN] for s in rows])
        mu, sd = Xt.mean(0), Xt.std(0) + 1e-9
        m = LogisticRegression(C=1.0, max_iter=2000).fit((Xt - mu) / sd, yt)
        tw, tb = m.coef_[0] / sd, m.intercept_[0] - (m.coef_[0] * mu / sd).sum()
        keep_m = {s: sig(X(data[s][0], mfeats) @ w + b) >= thr for s in songs}
        keep_t = lambda s, t: (sig(X(tail[s], tfeats) @ tw + tb) >= t) & (tail[s]['n'] >= TAIL_MIN) if nrow(tail[s]) else np.zeros(0, bool)
        tthr = max(grid, key=lambda t: np.mean([f_of(s, keep_m[s], keep_t(s, t)) for s in rated(tr)]))
        return tw, tb, tthr, keep_m, keep_t
    if final:
        w, b, thr = main_gate(songs); context(w, b)
        tw, tb, tthr, keep_m, keep_t = tail_gate(songs, w, b, thr, np.linspace(0.1, 0.9, 81))
        print('weights', {k: round(float(v), 4) for k, v in zip(tfeats, tw)}, 'bias', round(float(tb), 4), 'threshold', round(float(tthr), 3))
        for s in songs:
            print(f'  {s:14s} F {f_of(s, keep_m[s], np.zeros(nrow(tail[s]), bool)):.2f} -> {f_of(s, keep_m[s], keep_t(s, tthr)):.2f}  tail kept {int(keep_t(s, tthr).sum())}')
        sys.exit()
    tot0, tot = [], []
    for held in songs:
        tr = [s for s in songs if s != held]
        w, b, thr = main_gate(tr); context(w, b)
        tw, tb, tthr, keep_m, keep_t = tail_gate(tr, w, b, thr, np.linspace(0.1, 0.9, 33))
        d, td = data[held][0], tail[held]; km, kt = keep_m[held], keep_t(held, tthr)
        m0, m1 = prf_of(held, km, np.zeros(nrow(td), bool)), prf_of(held, km, kt)
        if len(refs[held]): tot0.append(m0[2]); tot.append(m1[2])
        false0 = int((km & (d['label'] == 0)).sum()); false1 = false0 + int((kt & (td['label'] == 0)).sum() if nrow(td) else 0)
        print(f'  {held:14s} P/R/F {m0[0]:.2f}/{m0[1]:.2f}/{m0[2]:.2f} -> {m1[0]:.2f}/{m1[1]:.2f}/{m1[2]:.2f}   false {false0:4d} -> {false1:4d}   tail kept {int(kt.sum()):4d}  (thr {thr:.3f} / {tthr:.3f})')
    print(f'  mean F  kick gate {np.mean(tot0):.3f}  with tail kicks {np.mean(tot):.3f}   tail feats {tfeats}')
    sys.exit()
if '--final' in sys.argv:
    feats = sys.argv[sys.argv.index('--final') + 1].split(',')
    Xa = np.concatenate([X(data[s][0], feats) for s in songs]); ya = np.concatenate([data[s][0]['label'] for s in songs])
    mu, sd = Xa.mean(0), Xa.std(0) + 1e-9
    m = LogisticRegression(C=1.0, max_iter=2000).fit((Xa - mu) / sd, ya)
    w = m.coef_[0] / sd; b0 = m.intercept_[0] - (m.coef_[0] * mu / sd).sum()
    best_t, best_f = 0.5, -1
    for t in np.linspace(0.1, 0.9, 81):
        f = np.mean([prf(1 / (1 + np.exp(-(X(data[s][0], feats) @ w + b0))) >= t, data[s][0], data[s][1])[2] for s in rated(songs)])
        if f > best_f: best_f, best_t = f, t
    print('weights', {k: round(float(v), 4) for k, v in zip(feats, w)}, 'bias', round(float(b0), 4), 'threshold', round(float(best_t), 3), 'mean F (in-sample)', round(float(best_f), 3))
    for s_ in songs:
        d, nref = data[s_]; keep = 1 / (1 + np.exp(-(X(d, feats) @ w + b0))) >= best_t
        print('  ', s_, 'P/R/F', ' '.join(f'{v:.2f}' for v in prf(keep, d, nref)))
    sys.exit()
if '--try' in sys.argv:
    for fs in sys.argv[sys.argv.index('--try') + 1].split(';'):
        evaluate(fs.split(','))
    sys.exit()
print(kind, 'held-out per song:')
evaluate(FEATS)
# greedy backward elimination for a smaller model
feats = list(FEATS)
base = evaluate(feats, verbose=False)
while len(feats) > 3:
    scores = [(evaluate([f for f in feats if f != g], verbose=False), g) for g in feats]
    s, g = max(scores)
    if s < base - 0.005: break
    feats.remove(g); base = s
print('smallest model within 0.005:', feats)
evaluate(feats)
# final fit on all songs: weights in original (unstandardised) units for TS
Xa = np.concatenate([X(data[s][0], feats) for s in songs]); ya = np.concatenate([data[s][0]['label'] for s in songs])
mu, sd = Xa.mean(0), Xa.std(0) + 1e-9
m = LogisticRegression(C=1.0, max_iter=2000).fit((Xa - mu) / sd, ya)
w = m.coef_[0] / sd; b0 = m.intercept_[0] - (m.coef_[0] * mu / sd).sum()
best_t, best_f = 0.5, -1
for t in np.linspace(0.1, 0.9, 33):
    f = np.mean([prf(1 / (1 + np.exp(-(X(data[s][0], feats) @ w + b0))) >= t, data[s][0], data[s][1])[2] for s in rated(songs)])
    if f > best_f: best_f, best_t = f, t
print('weights', dict(zip(feats, np.round(w, 4))), 'bias', round(b0, 4), 'threshold', round(best_t, 3), 'mean F all', round(best_f, 3))
