# BetterMV aligner pack: entry point. The plugin writes a job and starts
#   python\pythonw.exe align.py <job.json>
# and waits for the job's output file. Runs at below-normal priority; the GPU through DirectML when there is one.
#
# Job (UTF-8 JSON):
#   { "version": 1, "id": <song id>,
#     "audio": "<path>", "rate": 44100, "channels": 2,      raw little-endian int16 PCM, interleaved
#     "lines": [{ "start": s, "next": s, "words": [text, …] }],
#     "out": "<path>", "progress": "<path>",
#     "device": "cpu" (optional: skip DirectML), "threads": n (optional: CPU threads),
#     "model": "<path>" (optional: another model file; the dev server's) }
# Output (UTF-8 JSON, written whole when done):
#   { "version": 1, "id": …, "lines": [{ "words": [[start, end] | null, …], "conf": p | null }], "device": "dml" | "cpu",
#     "ms": { … } }   or   { "version": 1, "id": …, "error": "…" }
import json, os, sys, time, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, 'models', 'mms_fa.onnx')
VERSION = 1


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


def model_path():
    """The model ships in parts (release assets stay under 100 MB each); joined on first use."""
    if os.path.exists(MODEL): return MODEL
    parts = sorted(p for p in os.listdir(os.path.dirname(MODEL)) if p.startswith('mms_fa.onnx.'))
    if not parts: raise FileNotFoundError('对齐模型不在：' + MODEL)
    tmp = MODEL + '.joining'
    with open(tmp, 'wb') as out:
        for p in parts:
            with open(os.path.join(os.path.dirname(MODEL), p), 'rb') as f:
                while True:
                    b = f.read(1 << 24)
                    if not b: break
                    out.write(b)
    os.replace(tmp, MODEL)
    for p in parts: os.remove(os.path.join(os.path.dirname(MODEL), p))
    return MODEL


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
