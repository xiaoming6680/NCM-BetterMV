"""python tools/aligner/test_drums.py [path/to/pinned/adtof_frame_rnn.onnx]

Unit checks need numpy; optional real-model checks also need onnxruntime.
No network or user pack mutation. Model weights remain outside the source tree.
"""
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drums
import rhythm

MODEL = sys.argv.pop(1) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else None


class DrumTests(unittest.TestCase):
    def test_dense_rolls(self):
        a = np.zeros(100)
        a[10:90:6] = 0.9
        self.assertEqual(drums.peak_pick(a, 0.22), list(range(10, 90, 6)))

    def test_checksum_rejects_truncated_model(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b'incomplete model')
        try:
            with self.assertRaises(ValueError):
                drums.verify_model(f.name)
        finally:
            os.unlink(f.name)

    def test_empty_resampling_and_bad_rate(self):
        self.assertEqual(drums.activations(None, np.zeros(0), 22050).shape, (0, 5))
        with self.assertRaises(ValueError):
            drums.activations(None, np.zeros(10), 0)

    @unittest.skipUnless(MODEL, 'pass the optional local model path for inference checks')
    def test_real_inference_short_silent_and_chunk_boundary(self):
        import onnxruntime as ort
        drums.verify_model(MODEL)
        opt = ort.SessionOptions()
        opt.intra_op_num_threads = 2
        session = ort.InferenceSession(MODEL, opt, providers=['CPUExecutionProvider'])
        for rate, n in [(44100, 0), (22050, 1), (44100, 4096), (44100, 882001)]:
            hits = drums.track(session, np.zeros(n, np.float32), rate)
            self.assertEqual(hits, {'kick': [], 'snare': [], 'hat': []})
        x = np.random.default_rng(3).normal(0, 0.01, 22 * 44100).astype(np.float32)
        chunked = drums.activations(session, x, 44100)
        whole = session.run(['activations'], {'waveform': x[None]})[0][0]
        # Centre windows retain their absolute 100 fps time origin across the 20 s seam.
        np.testing.assert_allclose(chunked[1980:2020], whole[1980:2020], atol=0.03)

    @unittest.skipUnless(MODEL, 'pass the optional local model path for worker failure checks')
    def test_models_fail_independently(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = os.path.join(folder, 'silence.pcm')
            np.zeros(44100, '<i2').tofile(audio)
            job = {'task': 'beats', 'audio': audio, 'rate': 44100, 'drumModel': MODEL}
            with patch.object(rhythm.align, 'run', side_effect=RuntimeError('beat model unavailable')):
                result = rhythm.run(job)
            self.assertIn('beatError', result)
            self.assertEqual(result['drums'], {'kick': [], 'snare': [], 'hat': []})
            with patch.object(rhythm.align, 'run', return_value={'beats': [0, 0.5]}):
                result = rhythm.run({**job, 'drumModel': os.path.join(folder, 'missing.onnx')})
            self.assertEqual(result['beats'], [0, 0.5])
            self.assertIn('drumError', result)


if __name__ == '__main__':
    unittest.main()
