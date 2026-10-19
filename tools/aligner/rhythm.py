"""Versioned plugin wrapper around the installed v2 aligner: beats plus independent drum transcription.
Written alongside align.py/drums.py by the plugin, so existing packs need no runtime replacement.
"""
import json, os, sys, time, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import align


def run(job):
    # Either model may fail independently. Keep the useful result and let TypeScript fall back for the other.
    # beatsFrom: Beat This!'s result for this song from before (the plugin's cache), so only the drums run.
    try:
        if job.get('beatsFrom'):
            with open(job['beatsFrom'], encoding='utf-8') as f:
                result = json.load(f)
            for k in ('drums', 'drumError', 'error'):
                result.pop(k, None)
        else:
            result = align.run(job)
    except Exception as exc:
        result = {'version': 2, 'id': job.get('id'), 'task': 'beats', 'fps': 50,
                  'beats': [], 'downbeats': [], 'beatProb': [], 'downProb': [], 'beatError': str(exc)}
    if job.get('drumModel'):
        try:
            import numpy as np
            import onnxruntime as ort
            import drums
            start = time.time()
            drums.verify_model(job['drumModel'])
            pcm = np.fromfile(job['audio'], dtype='<i2')
            channels = int(job.get('channels', 1))
            mono = pcm.reshape(-1, channels).mean(axis=1).astype(np.float32) / 32768
            options = ort.SessionOptions()
            options.intra_op_num_threads = int(job.get('threads', 2)) or 2
            options.log_severity_level = 3
            session = ort.InferenceSession(job['drumModel'], options, providers=['CPUExecutionProvider'])
            def progress(p):
                if job.get('progress'):
                    align.write_json(job['progress'], {'stage': 'drums', 'progress': 0.8 + 0.2 * p})
            result['drums'] = drums.track(session, mono, int(job['rate']), progress)
            result.setdefault('ms', {})['drums'] = round((time.time() - start) * 1000)
        except Exception as exc:
            result['drumError'] = f'{type(exc).__name__}: {exc}'
    return result


def main():
    align.below_normal_priority()
    job_path = sys.argv[1]
    with open(job_path, encoding='utf-8-sig') as f:
        job = json.load(f)
    try:
        result = run(job)
    except Exception as exc:
        result = {'version': 2, 'id': job.get('id'), 'error': str(exc), 'trace': traceback.format_exc()[-2000:]}
    align.write_json(job['out'], result)
    if job.get('cleanup', True):
        for path in (job.get('audio'), job.get('progress'), job.get('beatsFrom'), job_path):
            try:
                if path: os.remove(path)
            except OSError:
                pass


if __name__ == '__main__':
    main()
