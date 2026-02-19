# Celezdial Selekta

Polyphonic ambient synthesizer mapped to the zodiac. 12 voices on a chromatic wheel (C–B), toggled by a zodiac keyboard, shaped by 35 knobs across 7 swappable FX chains. Built with React and Tone.js.

## Signal Chain (Zodiac — active default)

```
12 × PolySynth (Fat osc, per-sign tuning)
  → Panners (4 LFO groups, slow stereo drift)
  → sumBus ─────────────────── polyphonic sum before saturation
      → Highpass (30Hz, -12dB/oct)
      → Vibrato (VHS wow, 0.12Hz)
      → Echo (delay → LPF → tanh sat → feedback, hand-wired)
      → EQ3 (tape shelving)
      → Chebyshev (order 3, intermodulation on summed voices)
      → [Distortion — bypassed]
      → Freeverb (room 0.9, swept damping)
      → Chorus
      → [Phaser — bypassed]
      → Monitor EQ (listening environment comp)
      → Soft clip (tanh limiter)
      → out
```

Summing before Chebyshev is the point — polynomial waveshaping on a polyphonic mix generates sum/difference tones between partials. FM-like shimmer that single-voice saturation can't produce.

## Voices

| Sign | Note | Oct | Vel | Pan Group | Osc Count |
|------|------|-----|-----|-----------|-----------|
| Aquarius ♒︎ | C | 2 | 0.7 | A | 2 |
| Pisces ♓︎ | Db | 2 | 0.6 | D | 2 |
| Aries ♈︎ | D | 2 | 0.8 | A | 2 |
| Taurus ♉︎ | Eb | 3 | 0.5 | D | 2 |
| Gemini ♊︎ | E | 3 | 0.6 | B | 3 |
| Cancer ♋︎ | F | 3 | 0.4 | D | 3 |
| Leo ♌︎ | Gb | 4 | 0.7 | B | 3 |
| Virgo ♍︎ | G | 4 | 1.0 | C | 3 |
| Libra ♎︎ | Ab | 4 | 0.5 | C | 3 |
| Scorpio ♏︎ | A | 4 | 0.6 | C | 3 |
| Sagittarius ♐︎ | Bb | 5 | 0.5 | D | 3 |
| Capricorn ♑︎ | B | 5 | 0.4 | A | 3 |

Four pan groups (A–D) each driven by an independent LFO at 0.04Hz. Voices in the same group drift together.

## FX Chains

Seven pre-wired chains — same nodes, different order, different character:

| Chain | Order (abbreviated) | Character |
|-------|---------------------|-----------|
| **Zodiac** | vib → echo → eq → cheby → rev → cho | Balanced. Beautiful on load, cosmic at extremes |
| Cathedral | cheby → eq → vib → echo → rev | Saturation first — warm, thick |
| Void | cheby → dist → eq → vib → rev → pha → echo → cho | Reverb before delay — infinite receding echoes |
| Furnace | echo → cheby → dist → eq → vib → rev → cho → pha | Clean echoes re-enter waveshaper — progressively dirtier |
| Tape | vib → cheby → dist → eq → echo → rev → cho → pha | Pitch drift feeds saturation — time-varying harmonics |
| Evolve | vib → echo → rev → pha → cheby → dist → eq → cho | Space before saturation — new harmonics as tails decay |
| Glass | eq → vib → echo → rev → cho → pha | No saturation at all — crystalline |

## Controls

**Keyboard** — 12 zodiac keys, click to toggle voices on/off. Chromatic layout C through B.

**35 Knobs** — Drag vertically. Shift+drag for fine. Double-click to reset.

| Group | Knobs |
|-------|-------|
| Envelope | ATK, DEC, SUS, REL |
| Vibrato | RATE, DPTH, MIX |
| Pan | RATE, WDTH |
| Echo | TIME, FDBK, MIX, FILT |
| EQ | LOW, MID, HIGH, HI x |
| Chebyshev | ORD, MIX |
| Distortion | DRIV, MIX |
| Reverb | ROOM, DAMP, MIX, MOD, AMT |
| Chorus | RATE, DLY, DPTH, MIX |
| Phaser | RATE, OCT, BASE, Q, MIX |

**Eclipse** — Chaos mode. FX params ramp toward extreme values over 16 seconds (feedback 0.87, reverb wet 0.8, spread 120¢, etc.). Toggle off to restore.

**Breathe** — Cycles oscillator type: fatsawtooth → amsine → fmtriangle → fatsine → amtriangle → fmsine → fattriangle → fatsquare.

**Listen** — Monitor EQ presets for headphones, laptop speakers, phone, or loudspeakers.

**Randomize** — Throws the knobs.

## Natal Chart

Enter birth date, time, and location to compute a tropical whole-sign horoscope via `circular-natal-horoscope-js`. Each celestial body (Sun, Moon, Mercury through Pluto, Chiron) activates the voice of its zodiac sign — your chart becomes a chord. If birth time is provided, the Ascendant activates its sign too.

Each body's ecliptic degree within its sign (0–30°) applies microtonal detuning: `(degree - 15) * 3.33¢`. A planet at the start of a sign detunes -50¢, mid-sign stays centered, end of sign +50¢. Two people with Sun in Aries hear different tunings depending on where in Aries their Sun sits.

## Setup

```bash
npm install
npm start
```

## Tuning

All sound-shaping numbers live in `src/tuning.js`: TUNING defaults, SHADOW chaos targets, KNOB_DEFS, KNOB_GROUPS, LISTEN_PRESETS, CHAINS, OSC_TYPES. Change a value, hear the difference.

Engine + UI + visuals live in `src/App.js`.

## Deploy

Netlify. `npm run build` → `build/`.
