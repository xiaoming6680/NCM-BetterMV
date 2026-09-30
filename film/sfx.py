"""A film's sound effects on their own track: mouse clicks, whooshes, down-sweeps and reversed-cymbal swells.

    python film/sfx.py events.json out.wav seconds

events.json is the film's PROMO.sfx (film/main.ts): [{"kind": "click" | "whoosh" | "down" | "swell", "T": seconds, "dur": s}].
film/render.ts mixes the result under the songs.
"""
import json
import sys

import numpy as np
import soundfile as sf

import sound
from sound import SR, click, reverb, swell, swoosh_down, whoosh


def main():
    events, out, seconds = json.load(open(sys.argv[1], encoding='utf-8')), sys.argv[2], float(sys.argv[3])
    sound.start(seconds, seed=20260930)
    for e in events:
        t, dur = e['T'], e.get('dur', 0.5)
        if e['kind'] == 'click':
            click(t, 0.55, 2600)
            click(t + 0.035, 0.3, 1500)
        elif e['kind'] == 'whoosh':
            whoosh(t, dur, 0.42, 600, 5200, -0.3, 0.3)
        elif e['kind'] == 'down':
            swoosh_down(t, dur, 0.34)
        elif e['kind'] == 'swell':
            swell(t, dur, 0.28)
    # (start() replaces the module's buses, so they are read through the module.)
    mix = sum(sound.BUS[k] for k in sound.BUS).astype(np.float64)
    mix += reverb(sound.SEND['hall'].astype(np.float64), 2.4) * 0.8 + reverb(sound.SEND['room'].astype(np.float64), 0.6, 0.008, 9000) * 0.5
    mix = mix[:int(seconds * SR)]
    sf.write(out, mix.astype(np.float32), SR, subtype='FLOAT')
    print(f'{out}: {len(events)} effects, peak {20 * np.log10(np.abs(mix).max() + 1e-9):.1f} dBFS')


if __name__ == '__main__':
    main()
