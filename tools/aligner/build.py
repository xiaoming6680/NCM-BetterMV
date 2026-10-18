# Build the aligner pack's release files into build/aligner/release:
#   aligner-runtime.zip       embeddable Python + numpy + onnxruntime-directml + pypinyin + the scripts
#   mms_fa.onnx.001 …         the lyric model in parts of at most 95 MB (release assets the plugin can hold in memory)
#   beat_this.onnx.001 …      the beat model (tools/aligner/export_beats.py), same, and its beat_mel.npy
#   aligner.json              what the plugin downloads: version, files, sizes, SHA-256
#
#   python tools/aligner/build.py --python <python-3.12.x-embed-amd64.zip> --wheels <dir> --model <mms_fa.onnx>
#       --beats <dir with beat_this.onnx and beat_mel.npy>
# or, when only the scripts changed, on the Python and packages of an earlier runtime:
#   python tools/aligner/build.py --runtime <aligner-runtime.zip> --model … --beats …
# Wheels (Windows x64, CPython 3.12): pip download --platform win_amd64 --python-version 3.12 --only-binary=:all:
#   --no-deps -d <dir> numpy onnxruntime-directml pypinyin
import argparse, glob, hashlib, json, os, shutil, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PART = 95 * 1024 * 1024
VERSION = 2

ap = argparse.ArgumentParser()
ap.add_argument('--python')
ap.add_argument('--wheels')
ap.add_argument('--runtime')
ap.add_argument('--model', required=True)
ap.add_argument('--beats', required=True)
ap.add_argument('--out', default=os.path.join(ROOT, 'build', 'aligner'))
a = ap.parse_args()

stage = os.path.join(a.out, 'stage')
release = os.path.join(a.out, 'release')
shutil.rmtree(stage, ignore_errors=True); shutil.rmtree(release, ignore_errors=True)
os.makedirs(stage); os.makedirs(release)

py = os.path.join(stage, 'python')
if a.runtime:
    # Python and its packages from an earlier runtime; its scripts are replaced below.
    with zipfile.ZipFile(a.runtime) as z: z.extractall(stage)
elif a.python and a.wheels:
    # Python, with site-packages and the pack's folder on its path (an embeddable Python reads only its ._pth).
    with zipfile.ZipFile(a.python) as z: z.extractall(py)
    pth = glob.glob(os.path.join(py, 'python3*._pth'))[0]
    lines = [l for l in open(pth, encoding='utf-8').read().splitlines() if l.strip() and not l.startswith('#')]
    open(pth, 'w', encoding='utf-8').write('\n'.join(lines + ['Lib\\site-packages', '..']) + '\n')
    site = os.path.join(py, 'Lib', 'site-packages')
    os.makedirs(site)
    for whl in sorted(glob.glob(os.path.join(a.wheels, '*.whl'))):
        with zipfile.ZipFile(whl) as z: z.extractall(site)
    # What onnxruntime ships for building and quantising models is not needed to run one.
    for junk in ['onnxruntime/tools', 'onnxruntime/transformers', 'onnxruntime/quantization', 'onnxruntime/datasets']:
        shutil.rmtree(os.path.join(site, junk), ignore_errors=True)
else:
    ap.error('--python and --wheels, or --runtime')
for f in ['align.py', 'fa.py', 'beats.py']: shutil.copy(os.path.join(HERE, f), stage)
shutil.copy(os.path.join(HERE, 'LICENSES.txt'), stage)
json.dump({'version': VERSION}, open(os.path.join(stage, 'version.json'), 'w'))

files = []
def add(path, kind):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    files.append({'name': os.path.basename(path), 'size': os.path.getsize(path), 'sha256': h.hexdigest(), 'kind': kind})

runtime = os.path.join(release, 'aligner-runtime.zip')
with zipfile.ZipFile(runtime, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, _, names in os.walk(stage):
        for n in names:
            p = os.path.join(dirpath, n)
            z.write(p, os.path.relpath(p, stage))
add(runtime, 'zip')
def parts(path, name):
    with open(path, 'rb') as f:
        i = 1
        while True:
            b = f.read(PART)
            if not b: break
            p = os.path.join(release, f'{name}.{i:03d}')
            open(p, 'wb').write(b)
            add(p, 'model')
            i += 1
parts(a.model, 'mms_fa.onnx')
parts(os.path.join(a.beats, 'beat_this.onnx'), 'beat_this.onnx')
shutil.copy(os.path.join(a.beats, 'beat_mel.npy'), release)
add(os.path.join(release, 'beat_mel.npy'), 'model')
json.dump({'version': VERSION, 'files': files}, open(os.path.join(release, 'aligner.json'), 'w'), indent=1)
total = sum(f['size'] for f in files)
print(f'{len(files)} files, {total / 1e6:.0f} MB → {release}')
