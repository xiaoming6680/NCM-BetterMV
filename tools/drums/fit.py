# Fit the drum gates on candidate features (features.ts csv + refonsets.py json, in the cwd), each song held out of
# its own fit; compared with the gate as it was before 2026-10-01 ("current").
#   python fit.py kick|snare song1 song2 …                      all features, then a backward search for a small model
#   python fit.py kick|snare song… --try "f1,f2;f1,f3"          held-out F of the given feature sets
#   python fit.py kick|snare song… --final "f1,f2"              weights for hits.ts (fitted on all songs)
import sys, json
import numpy as np
from sklearn.linear_model import LogisticRegression
kind = sys.argv[1]; songs = [a for a in sys.argv[2:] if not a.startswith('--') and ',' not in a and ';' not in a]
FEATS = {
    'kick':  ['lodf', 'lloc', 'ldom', 'decay60', 'decay150', 'lpre', 'lflux', 'lcross', 'grid4', 'grid8'],
    'snare': ['lodf', 'lloc', 'ldom', 'decay60', 'decay150', 'lpre', 'lflux', 'lcross', 'lmh', 'grid4', 'grid8'],
}[kind]
if len(sys.argv) > 1 and '--feats' in sys.argv: pass
def load(s):
    import csv
    rows = list(csv.DictReader(open(f'{s}-{kind}.csv')))
    ref = json.load(open(f'{s}-ref.json'))[kind]
    d = {k: np.array([float(r[k]) for r in rows]) for k in rows[0].keys()}
    eps = 1e-4
    d['lodf'] = np.log(d['odfRel'] + eps); d['lloc'] = np.log(d['odfLocal'] + eps); d['ldom'] = np.log(d['dominance'] + eps)
    d['lpre'] = np.log(d['pre'] + eps); d['lflux'] = np.log(d['flux'] + eps); d['lcross'] = np.log(d['cross'] + eps); d['lmh'] = np.log(d['midHigh'] + eps)
    return d, len(ref)
data = {s: load(s) for s in songs}
def current_rule(d):
    # percussive score as in hits.ts
    rc, rs = (1.0, 0.2) if kind == 'kick' else (0.13, 0.06)
    sc = (d['dominance'] - rc) / rs - (d['decay150'] - 0.5) / 0.15
    keep = sc >= -0.5
    if kind == 'snare': keep &= d['midHigh'] >= 2
    return keep
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
            f = np.mean([prf(m.predict_proba((X(data[s][0], feats) - mu) / sd)[:, 1] >= t, data[s][0], data[s][1])[2] for s in tr])
            if f > best_f: best_f, best_t = f, t
        d, nref = data[held]
        keep = m.predict_proba((X(d, feats) - mu) / sd)[:, 1] >= best_t
        c, n = prf(current_rule(d), d, nref), prf(keep, d, nref)
        tot_cur.append(c); tot_new.append(n)
        if verbose: print(f'  {held:5s} current P/R/F {c[0]:.2f}/{c[1]:.2f}/{c[2]:.2f}   fitted {n[0]:.2f}/{n[1]:.2f}/{n[2]:.2f}  (thr {best_t:.2f})')
    mc, mn = np.mean([c[2] for c in tot_cur]), np.mean([n[2] for n in tot_new])
    print(f'  mean F  current {mc:.3f}  fitted {mn:.3f}   feats {feats}')
    return mn
if '--final' in sys.argv:
    feats = sys.argv[sys.argv.index('--final') + 1].split(',')
    Xa = np.concatenate([X(data[s][0], feats) for s in songs]); ya = np.concatenate([data[s][0]['label'] for s in songs])
    mu, sd = Xa.mean(0), Xa.std(0) + 1e-9
    m = LogisticRegression(C=1.0, max_iter=2000).fit((Xa - mu) / sd, ya)
    w = m.coef_[0] / sd; b0 = m.intercept_[0] - (m.coef_[0] * mu / sd).sum()
    best_t, best_f = 0.5, -1
    for t in np.linspace(0.1, 0.9, 81):
        f = np.mean([prf(1 / (1 + np.exp(-(X(data[s][0], feats) @ w + b0))) >= t, data[s][0], data[s][1])[2] for s in songs])
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
    f = np.mean([prf(1 / (1 + np.exp(-(X(data[s][0], feats) @ w + b0))) >= t, data[s][0], data[s][1])[2] for s in songs])
    if f > best_f: best_f, best_t = f, t
print('weights', dict(zip(feats, np.round(w, 4))), 'bias', round(b0, 4), 'threshold', round(best_t, 3), 'mean F all', round(best_f, 3))
