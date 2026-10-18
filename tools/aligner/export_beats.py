# Export Beat This! (CPJKU, ISMIR 2024; code and weights MIT) for the pack: the model as ONNX (beat and downbeat
# logits per 50 fps frame, any number of frames) and its mel filterbank as .npy, so the pack computes the log-mel
# input with numpy (src: beat_this.preprocessing.LogMelSpect). Development only: needs torch, torchaudio, beat_this.
#   python tools/aligner/export_beats.py <final0.ckpt> <out dir>
import os, sys
import numpy as np
import torch, torchaudio
from beat_this.inference import load_model

ckpt, out = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'build/aligner/models'
os.makedirs(out, exist_ok=True)
model = load_model(ckpt, 'cpu').eval()


class Logits(torch.nn.Module):
    """(1, frames, 128) log-mel → (1, frames) beat logits, (1, frames) downbeat logits."""
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, spect):
        y = self.m(spect)
        return y['beat'], y['downbeat']


path = os.path.join(out, 'beat_this.onnx')
with torch.no_grad():
    torch.onnx.export(Logits(model), (torch.randn(1, 1500, 128),), path, input_names=['spect'],
                      output_names=['beat', 'downbeat'], dynamic_axes={'spect': {1: 't'}, 'beat': {1: 't'}, 'downbeat': {1: 't'}},
                      opset_version=17, dynamo=False)
# MelSpectrogram(sample_rate=22050, n_fft=1024, f_min=30, f_max=11000, n_mels=128, mel_scale='slaney'): (513, 128).
fb = torchaudio.functional.melscale_fbanks(513, 30.0, 11000.0, 128, 22050, norm=None, mel_scale='slaney')
np.save(os.path.join(out, 'beat_mel.npy'), fb.numpy().astype(np.float32))
print('wrote', path, os.path.getsize(path) // 1_000_000, 'MB, and beat_mel.npy')
