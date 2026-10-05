# Export MMS-FA (torchaudio.pipelines.MMS_FA, CC-BY-NC 4.0) to ONNX for the aligner pack, its MatMuls quantised to
# int8 (1.26 GB → 355 MB; on 58 songs the word times are as good as fp32's, docs/ALIGNER.md). Development only:
# needs torch, torchaudio and onnxruntime.
#   python tools/aligner/export_model.py <out dir>
import os, sys
import torch, torchaudio
from onnxruntime.quantization import quantize_dynamic, QuantType

out = sys.argv[1] if len(sys.argv) > 1 else 'build/aligner/models'
os.makedirs(out, exist_ok=True)
model = torchaudio.pipelines.MMS_FA.get_model(with_star=False).eval()


class Logits(torch.nn.Module):
    """The bare wav2vec2 model: input already normalised, output raw logits (log-softmax and the star column are
    added by fa.py)."""
    def __init__(self, m):
        super().__init__()
        self.m = m.model

    def forward(self, audio):
        return self.m(audio)[0]


fp32 = os.path.join(out, 'mms_fa.fp32.onnx')
torch.onnx.export(Logits(model), (torch.randn(1, 16000 * 10),), fp32, input_names=['audio'], output_names=['logits'],
                  dynamic_axes={'audio': {1: 'n'}, 'logits': {1: 't'}}, opset_version=17, dynamo=False)
quantize_dynamic(fp32, os.path.join(out, 'mms_fa.onnx'), weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul'])
os.remove(fp32)
print('wrote', os.path.join(out, 'mms_fa.onnx'), os.path.getsize(os.path.join(out, 'mms_fa.onnx')) // 1_000_000, 'MB')
