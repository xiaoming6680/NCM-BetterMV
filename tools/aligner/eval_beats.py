# Beat This! (the pack's beats.py) over the evaluation audio, for the eval tools' --beats: every dev/eval-pcm/<id>.s16
# (mono 22 050 Hz int16) and dev/eval-pcm/analysis/<key>.f32 (float32) into dev/eval-pcm/beats/<id or key>.json, in the
# pack's output format. Songs done before are skipped. Run with the pack's Python (numpy, onnxruntime):
#   dev/aligner/python/python.exe tools/aligner/eval_beats.py [--model dev/aligner/models/beat_this.onnx] [--cpu]
import argparse, glob, json, os, sys, time
import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import beats as B

ap = argparse.ArgumentParser()
ap.add_argument('--model', default=os.path.join(ROOT, 'dev/aligner/models/beat_this.onnx'))
ap.add_argument('--cpu', action='store_true')
a = ap.parse_args()
B.track.fb = np.load(os.path.join(os.path.dirname(a.model), 'beat_mel.npy'))
providers = ['CPUExecutionProvider'] if a.cpu else ['DmlExecutionProvider', 'CPUExecutionProvider']
sess = ort.InferenceSession(a.model, providers=[p for p in providers if p in ort.get_available_providers()])
pcm = os.path.join(ROOT, 'dev/eval-pcm')
out = os.path.join(pcm, 'beats')
os.makedirs(out, exist_ok=True)
todo = [(p, 'int16') for p in glob.glob(os.path.join(pcm, '*.s16'))] + [(p, 'float32') for p in glob.glob(os.path.join(pcm, 'analysis', '*.f32'))]
t0, n = time.time(), 0
for path, kind in sorted(todo):
    key = os.path.splitext(os.path.basename(path))[0]
    dst = os.path.join(out, key + '.json')
    if os.path.exists(dst): continue
    x = np.fromfile(path, dtype=kind).astype(np.float32)
    if kind == 'int16': x /= 32768
    r = B.track(sess, x)
    q = lambda v: [round(float(p), 3) for p in v]
    with open(dst + '.tmp', 'w') as f:
        json.dump({'version': 2, 'id': key, 'task': 'beats', 'fps': B.FPS, 'beats': [round(float(t), 4) for t in r['beats']],
                   'downbeats': [round(float(t), 4) for t in r['downbeats']], 'beatProb': q(r['beatProb']), 'downProb': q(r['downProb'])}, f)
    os.replace(dst + '.tmp', dst)
    n += 1
print(f'{n} songs in {time.time() - t0:.0f} s → {out}')
