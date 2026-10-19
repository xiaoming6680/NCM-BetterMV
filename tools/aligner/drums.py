"""ADTOF Frame_RNN ONNX inference, independent of beats/tempo/meter.

Uses the waveform-input conversion by Sillybit-io (CC BY-NC-SA 4.0).
See docs/RHYTHM.md for provenance, pinned checksum and evaluation limits.
No network access here. The plugin installs the optional model and this script.
"""
import hashlib
import numpy as np

MODEL_SHA256 = '189ca3c2bc7339a5f0fdc0bb11069d4bcc4fafabd142e945228c368c379b6227'
SR, FPS = 44100, 100
THRESHOLDS = (0.22, 0.24, 0.32, 0.22, 0.30)


def verify_model(path):
    with open(path, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != MODEL_SHA256:
        raise ValueError('ADTOF model checksum mismatch')


def activations(session, mono, rate, progress=lambda p: None):
    """Bounded 20-second chunks with 2-second context; retain only the centre of each chunk."""
    if rate <= 0:
        raise ValueError('Audio sample rate must be positive')
    if not len(mono):
        return np.zeros((0, 5), np.float32)
    if rate != SR:
        # Compatibility for external callers; the plugin supplies a native 44.1 kHz decode.
        n = int(round(len(mono) * SR / rate))
        mono = np.interp(np.arange(n) * rate / SR, np.arange(len(mono)), mono).astype(np.float32)
    frames = int(np.ceil(len(mono) / (SR // FPS)))
    out = np.zeros((frames, 5), np.float32)
    hop, context = 20 * FPS, 2 * FPS
    for first in range(0, frames, hop):
        last = min(frames, first + hop)
        left, right = max(0, first - context), min(frames, last + context)
        x = mono[left * 441:right * 441]
        # Very short files still need enough samples for the model's framing and convolution.
        if len(x) < 4096:
            x = np.pad(x, (0, 4096 - len(x)))
        pred = session.run(['activations'], {'waveform': x[None].astype(np.float32)})[0][0]
        out[first:last] = pred[first - left:last - left]
        progress(last / max(1, frames))
    return out


def peak_pick(values, threshold):
    """Author thresholds and asymmetric onset windows at 100 fps; merge only within 20 ms."""
    peaks = []
    for i, value in enumerate(values):
        if value < threshold:
            continue
        if value < np.mean(values[max(0, i - 10):i + 2]) + threshold:
            continue
        window = values[max(0, i - 2):i + 2]
        if value != np.max(window) or np.argmax(window) != i - max(0, i - 2):
            continue
        if peaks and i - peaks[-1] <= 2:
            if value > values[peaks[-1]]:
                peaks[-1] = i
        else:
            peaks.append(i)
    return peaks


def track(session, mono, rate, progress=lambda p: None):
    acts = activations(session, mono, rate, progress)
    # Strength from audible attack RMS; model probability contributes confidence, not loudness by itself.
    block = max(1, int(rate * 0.02))
    padded = np.pad(mono, (0, (-len(mono)) % block))
    rms = np.sqrt(np.mean(padded.reshape(-1, block) ** 2, axis=1)) if len(padded) else np.zeros(1)
    level = max(float(np.quantile(rms, 0.95)), 1e-6)
    hits = {'kick': [], 'snare': [], 'hat': []}
    for cls, kind in ((0, 'kick'), (1, 'snare'), (3, 'hat'), (4, 'hat')):
        for frame in peak_pick(acts[:, cls], THRESHOLDS[cls]):
            time = frame / FPS
            if time >= len(mono) / rate:
                continue
            local = float(np.max(rms[min(len(rms) - 1, int(time / 0.02)):min(len(rms), int(time / 0.02) + 3)]))
            if local < level * 0.01:
                continue
            strength = min(1, local / level) * (0.5 + 0.5 * float(acts[frame, cls]))
            hits[kind].append([round(time, 4), round(strength, 4)])
    # Hi-hat/cymbal predictions can coincide. Keep one event per attack, with the stronger amplitude.
    hats = []
    for h in sorted(hits['hat']):
        if hats and h[0] - hats[-1][0] <= 0.02:
            if h[1] > hats[-1][1]: hats[-1] = h
        else:
            hats.append(h)
    hits['hat'] = hats
    return hits
