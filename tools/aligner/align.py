# BetterMV aligner pack: entry point. The plugin writes a job and starts
#   python\pythonw.exe align.py <job.json>
# and waits for the job's output file. Runs at below-normal priority; the GPU through DirectML when there is one.
# Two kinds of job: word times for a song's lyric lines (the default), and its beats ("task": "beats").
#
# Lyric job (UTF-8 JSON):
#   { "version": 1, "id": <song id>,
#     "audio": "<path>", "rate": 44100, "channels": 2,      raw little-endian int16 PCM, interleaved
#     "lines": [{ "start": s, "next": s, "words": [text, …] }],
#     "out": "<path>", "progress": "<path>",
#     "device": "cpu" (optional: skip DirectML), "threads": n (optional: CPU threads),
#     "model": "<path>" (optional: another model file; the dev server's) }
# Output (UTF-8 JSON, written whole when done):
#   { "version": 2, "id": …, "lines": [{ "words": [[start, end] | null, …], "conf": p | null }], "device": "dml" | "cpu",
#     "ms": { … } }   or   { "version": 2, "id": …, "error": "…" }
#
# Beat job: { "version": 1, "task": "beats", "id": …, "audio", "rate" (22050 expected), "channels", "out", "progress",
#   "device", "threads", "beatModel": "<path>" (optional) }
# Output: { "version": 2, "id": …, "task": "beats", "fps": 50, "beats": [s, …], "downbeats": [s, …],
#   "beatProb": [p, …], "downProb": [p, …] (per frame, 3 decimals), "device", "ms" }
import json, os, sys, time, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, 'models', 'mms_fa.onnx')
BEAT_MODEL = os.path.join(HERE, 'models', 'beat_this.onnx')
VERSION = 2


def below_normal_priority():
    try:
        import ctypes
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
    except Exception:
        pass


def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def model_path(path=MODEL):
    """A model ships in parts (release assets stay under 100 MB each); joined on first use."""
    if os.path.exists(path): return path
    folder, name = os.path.dirname(path), os.path.basename(path)
    parts = sorted(p for p in os.listdir(folder) if p.startswith(name + '.')) if os.path.isdir(folder) else []
    if not parts: raise FileNotFoundError('模型不在：' + path)
    tmp = path + '.joining'
    with open(tmp, 'wb') as out:
        for p in parts:
            with open(os.path.join(folder, p), 'rb') as f:
                while True:
                    b = f.read(1 << 24)
                    if not b: break
                    out.write(b)
    os.replace(tmp, path)
    for p in parts: os.remove(os.path.join(folder, p))
    return path


def session(device=None, threads=0, model=None):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.log_severity_level = 3
    if threads: so.intra_op_num_threads = threads
    path = model or model_path()
    if device != 'cpu' and 'DmlExecutionProvider' in ort.get_available_providers():
        try:
            return ort.InferenceSession(path, so, providers=['DmlExecutionProvider', 'CPUExecutionProvider']), 'dml'
        except Exception:
            pass
    return ort.InferenceSession(path, so, providers=['CPUExecutionProvider']), 'cpu'


def run_beats(job, progress, t0, ms):
    import numpy as np
    import beats
    pcm = np.fromfile(job['audio'], dtype='<i2')
    ch = int(job.get('channels', 1))
    mono = pcm.reshape(-1, ch).mean(axis=1).astype(np.float32) / 32768.0 if ch > 1 else pcm.astype(np.float32) / 32768.0
    rate = int(job['rate'])
    if rate != beats.SR:
        import fa
        mono = fa.resample(mono, rate, beats.SR)
    ms['decode'] = round((time.time() - t0) * 1000)
    t1 = time.time()
    path = model_path(job.get('beatModel') or BEAT_MODEL)
    beats.track.fb = np.load(os.path.join(os.path.dirname(path), 'beat_mel.npy'))
    sess, device = session(job.get('device'), int(job.get('threads', 0)), path)
    ms['model'] = round((time.time() - t1) * 1000)
    t1 = time.time()
    r = beats.track(sess, mono, progress=lambda p: progress('beats', p))
    ms['beats'] = round((time.time() - t1) * 1000)
    ms['total'] = round((time.time() - t0) * 1000)
    q = lambda a: [round(float(v), 3) for v in a]
    return {'version': VERSION, 'id': job.get('id'), 'task': 'beats', 'fps': beats.FPS, 'beats': [round(float(v), 4) for v in r['beats']],
            'downbeats': [round(float(v), 4) for v in r['downbeats']], 'beatProb': q(r['beatProb']), 'downProb': q(r['downProb']),
            'device': device, 'ms': ms}


def run(job):
    import numpy as np
    import fa
    progress_path = job.get('progress')
    t0 = time.time(); ms = {}

    def progress(stage, p):
        if not progress_path: return
        try: write_json(progress_path, {'stage': stage, 'progress': round(p, 3)})
        except OSError: pass

    progress('load', 0)
    if job.get('task') == 'beats': return run_beats(job, progress, t0, ms)
    pcm = np.fromfile(job['audio'], dtype='<i2')
    ch = int(job.get('channels', 1))
    mono = pcm.reshape(-1, ch).mean(axis=1).astype(np.float32) / 32768.0 if ch > 1 else pcm.astype(np.float32) / 32768.0
    audio = fa.resample(mono, int(job['rate']))
    ms['decode'] = round((time.time() - t0) * 1000)

    t1 = time.time()
    sess, device = session(job.get('device'), int(job.get('threads', 0)), job.get('model'))
    ms['model'] = round((time.time() - t1) * 1000)

    t1 = time.time()
    lp = fa.emissions(sess, audio, progress=lambda p: progress('listen', p))
    ms['listen'] = round((time.time() - t1) * 1000)

    t1 = time.time()
    progress('align', 0)
    lines = [{'start': float(l['start']), 'next': float(l['next']), 'words': [str(w) for w in l['words']]} for l in job['lines']]
    result = fa.align(lp, lines)
    ms['align'] = round((time.time() - t1) * 1000)
    ms['total'] = round((time.time() - t0) * 1000)
    return {'version': VERSION, 'id': job.get('id'), 'lines': result, 'device': device, 'ms': ms}


def main():
    below_normal_priority()
    sys.path.insert(0, HERE)
    job_path = sys.argv[1]
    with open(job_path, encoding='utf-8') as f: job = json.load(f)
    try:
        out = run(job)
    except Exception as e:
        out = {'version': VERSION, 'id': job.get('id'), 'error': f'{type(e).__name__}: {e}', 'trace': traceback.format_exc()[-2000:]}
    write_json(job['out'], out)
    for p in (job.get('progress'), job.get('audio') if job.get('cleanup', True) else None, job_path if job.get('cleanup', True) else None):
        try:
            if p and os.path.exists(p): os.remove(p)
        except OSError:
            pass


if __name__ == '__main__':
    main()
