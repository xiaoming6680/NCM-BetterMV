# Beat tracking for the pack: Beat This! (CPJKU, ISMIR 2024, MIT) through onnxruntime, its input computed with numpy.
# Matches beat_this.inference.Audio2Beats with the "minimal" postprocessing: log-mel (22 050 Hz, 1024-point STFT,
# hop 441 = 50 fps, 128 slaney mel bands 30 Hz–11 kHz, log1p(1000·x)), chunks of 1500 frames overlapping by 6 at
# each border (the earlier chunk wins), beats and downbeats where the logit peaks above 0 within ±3 frames.
import numpy as np

SR, N_FFT, HOP, FPS = 22050, 1024, 441, 50
CHUNK, BORDER = 1500, 6


def logmel(x, fb):
    """(frames, 128) log-mel of mono float32 audio at 22 050 Hz, as torchaudio's MelSpectrogram(normalized=
    'frame_length', power=1) followed by log1p(1000·x). fb: the (513, 128) filterbank exported with the model."""
    pad = N_FFT // 2
    xp = np.pad(x.astype(np.float32), (pad, pad), mode='reflect')
    n = 1 + len(x) // HOP
    window = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)  # periodic Hann
    out = np.empty((n, fb.shape[1]), np.float32)
    step = 2048  # frames per block (keeps memory small)
    for f0 in range(0, n, step):
        f1 = min(n, f0 + step)
        idx = (np.arange(f0, f1) * HOP)[:, None] + np.arange(N_FFT)[None, :]
        frames = xp[idx] * window
        mag = np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32) / np.float32(np.sqrt(N_FFT))
        out[f0:f1] = np.log1p(1000 * (mag @ fb))
    return out


def chunks(n):
    """Start frames of the chunks (beat_this.inference.split_piece with avoid_short_end)."""
    starts = np.arange(-BORDER, n - BORDER, CHUNK - 2 * BORDER)
    if n > CHUNK - 2 * BORDER: starts[-1] = n - (CHUNK - BORDER)
    return starts


def logits(sess, spect, progress=None):
    """Beat and downbeat logits per frame for the whole song."""
    n = len(spect)
    beat = np.full(n, -1000.0, np.float32); down = np.full(n, -1000.0, np.float32)
    starts = chunks(n)
    preds = []
    for k, s in enumerate(starts):
        lo, hi = max(s, 0), min(s + CHUNK, n)
        x = spect[lo:hi]
        left, right = max(0, -s), max(0, min(BORDER, s + CHUNK - n))
        if left or right: x = np.pad(x, ((left, right), (0, 0)))
        b, d = sess.run(None, {'spect': x[None].astype(np.float32)})
        preds.append((s, b[0], d[0]))
        if progress: progress((k + 1) / len(starts))
    # The earlier chunk wins where they overlap: write the later ones first.
    for s, b, d in reversed(preds):
        b, d = b[BORDER:-BORDER], d[BORDER:-BORDER]
        lo = s + BORDER
        beat[lo:lo + len(b)] = b[:max(0, min(len(b), n - lo))]
        down[lo:lo + len(d)] = d[:max(0, min(len(d), n - lo))]
    return beat, down


def peaks(lg):
    """Frames where the logit is the maximum within ±3 frames and above 0; runs of adjacent frames → their mean."""
    pad = np.pad(lg, 3, constant_values=-1000)
    win = np.lib.stride_tricks.sliding_window_view(pad, 7).max(axis=1)
    fr = np.nonzero((lg == win) & (lg > 0))[0]
    out, p, c = [], None, 0
    for f in fr:
        if p is not None and f - p_last <= 1:
            c += 1; p += (f - p) / c
        else:
            if p is not None: out.append(p)
            p, c = float(f), 1
        p_last = f
    if p is not None: out.append(p)
    return np.array(out)


def track(sess, x, progress=None):
    """Beats and downbeats (s), and the beat / downbeat probability per frame (50 fps)."""
    spect = logmel(x, track.fb)
    beat, down = logits(sess, spect, progress)
    bt = peaks(beat) / FPS
    dn = peaks(down) / FPS
    if len(bt): dn = np.unique(np.array([bt[np.argmin(np.abs(bt - t))] for t in dn]))
    sig = lambda v: 1 / (1 + np.exp(-np.clip(v, -50, 50)))
    return {'beats': bt, 'downbeats': dn, 'beatProb': sig(beat), 'downProb': sig(down)}
