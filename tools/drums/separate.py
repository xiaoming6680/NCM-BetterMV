# Separates a song into drums / bass / other / vocals with htdemucs_ft (audio-separator), for fitting the drum gates
# (docs/ANALYSIS.md). Models from BMV_STEM_MODELS (default: the Clarity_MV project's).
#   python tools/drums/separate.py <song.wav> <out dir>
import os, sys, time, types
import numpy as np, soundfile as sf
# torchvision's compiled ops and diffq are only imported, never used by htdemucs_ft: stubbed out.
_tv = types.ModuleType("torchvision"); _tv.ops = types.ModuleType("torchvision.ops")
def _unavailable(*a, **k): raise RuntimeError("stub")
for _n in ("nms", "roi_align", "roi_pool", "batched_nms", "deform_conv2d", "ps_roi_align", "ps_roi_pool"): setattr(_tv.ops, _n, _unavailable)
sys.modules["torchvision"] = _tv; sys.modules["torchvision.ops"] = _tv.ops
_dq = types.ModuleType("diffq")
for _n in ("DiffQuantizer", "UniformQuantizer", "restore_quantized_state"): setattr(_dq, _n, _unavailable)
sys.modules["diffq"] = _dq
from audio_separator.separator import Separator
inp, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
t0 = time.time()
models = os.environ.get("BMV_STEM_MODELS", r"D:\!XM的项目\个人项目\Clarity_MV\analysis\models")
sep = Separator(output_dir=out, model_file_dir=models, output_format="WAV")
sep.load_model(model_filename="htdemucs_ft.yaml")
files = sep.separate(inp, {"Drums": "drums", "Bass": "bass", "Other": "other", "Vocals": "vocals"})
print("done", files, "%.1fs" % (time.time() - t0))
