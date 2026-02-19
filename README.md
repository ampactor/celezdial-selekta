# Celezdial Selekta

Polyphonic ambient synthesizer mapped to the zodiac. 12 voices on a chromatic wheel (C–B), toggled by a zodiac keyboard, shaped by 35 knobs across 8 swappable FX chains. Built with React and Tone.js.

## Signal Chain (Zodiac — active default)

```
12 × PolySynth (fatsine, per-sign tuning + Cousto detune)
  → Panners (4 LFO groups, slow stereo drift)
  → sumBus ─────────────────── polyphonic sum before saturation
      → Highpass (35Hz, -12dB/oct)
      → Vibrato (VHS wow, 0.08Hz)
      → Echo (delay → LPF → tanh sat → feedback, hand-wired)
      → EQ3 (tape shelving)
      → Chebyshev (order 2, even harmonics on summed voices)
      → [Distortion — bypassed]
      → Freeverb (room 0.88, swept damping)
      → Chorus (on by default, stereo width)
      → [Phaser — bypassed]
      → Monitor EQ (listening environment comp)
      → Soft clip (tanh limiter)
      → out
```

Summing before Chebyshev is the point — polynomial waveshaping on a polyphonic mix generates sum/difference tones between partials. Order 2 = even harmonics only (octave doubling = warmth). Order 3 creates harsh odd-harmonic intermodulation on dense polyphonic material — avoided for the ambient default.

## Voicing Strategy

Dim7 octave partitioning prevents semitone adjacencies within any octave. The chromatic scale's 12 notes are distributed across three octaves in diminished-seventh groups:

| Octave | Notes | Interval pattern |
|--------|-------|-----------------|
| 3 | C, Eb, Gb, A | dim7 (minor thirds) |
| 4 | D, F, Ab, B | dim7 |
| 5 | Db, E, G, Bb | dim7 |

Within any single octave, the closest interval is a minor third (3 semitones). No semitone or whole-tone clashes when adjacent signs sound together. The three dim7 groups interlock to cover all 12 chromatic pitches.

Velocity follows astrological hierarchy — luminaries (Sun/Moon signs) are loudest, personal planet signs next, social planets quietest:

| Tier | Ruler | Signs | Velocity |
|------|-------|-------|----------|
| Luminary | Sun | Leo | 0.65 |
| Luminary | Moon | Cancer | 0.60 |
| Personal | Mars | Aries, Scorpio | 0.52, 0.48 |
| Personal | Venus | Taurus, Libra | 0.50, 0.47 |
| Personal | Mercury | Gemini, Virgo | 0.48, 0.45 |
| Social | Jupiter | Sagittarius, Pisces | 0.40, 0.38 |
| Social | Saturn | Capricorn, Aquarius | 0.35, 0.33 |

## Voices

| Sign | Note | Oct | Vel | Cousto ¢ | Pan Group | Osc Count | Spread ¢ |
|------|------|-----|-----|----------|-----------|-----------|----------|
| Aquarius ♒︎ | C | 3 | 0.33 | +6 | A | 2 | 5 |
| Pisces ♓︎ | Db | 5 | 0.38 | −6.5 | D | 3 | 12 |
| Aries ♈︎ | D | 4 | 0.52 | −12.5 | B | 2 | 8 |
| Taurus ♉︎ | Eb | 3 | 0.50 | +5 | C | 2 | 5 |
| Gemini ♊︎ | E | 5 | 0.48 | +16.5 | B | 3 | 12 |
| Cancer ♋︎ | F | 4 | 0.60 | +11.5 | D | 2 | 8 |
| Leo ♌︎ | Gb | 3 | 0.65 | +19 | B | 2 | 5 |
| Virgo ♍︎ | G | 5 | 0.45 | +16.5 | A | 3 | 12 |
| Libra ♎︎ | Ab | 4 | 0.47 | +5 | C | 2 | 8 |
| Scorpio ♏︎ | A | 3 | 0.48 | −12.5 | C | 2 | 5 |
| Sagittarius ♐︎ | Bb | 5 | 0.40 | −6.5 | D | 3 | 12 |
| Capricorn ♑︎ | B | 4 | 0.35 | +6 | A | 2 | 8 |

Four pan groups (A–D) each driven by an independent LFO at 0.03Hz. Voices in the same group drift together. Octave 3 voices get 2 oscillators (intimate), octave 5 voices get 3 (wider shimmer). Fletcher-Munson compensation flattens perceived loudness across the range (+5dB oct 3, +2dB oct 3 ref, 0dB oct 4, −2dB oct 5).

## Cousto Planetary Tuning

Hans Cousto's *Cosmic Octave* (1978) — planetary orbital periods octave-transposed into audible frequencies. Each sign is microtonally detuned by its traditional ruling planet's deviation from 12-TET.

Applied at 50% strength (the `detuneCents` column in Voices is half the raw Cousto offset). Enough color to feel the planetary character without quarter-tone shock on dense voicings.

Signs sharing a ruler share the same offset — pairs that are "in tune" with each other through planetary resonance:

| Ruler | Raw ¢ | Applied ¢ | Signs |
|-------|-------|-----------|-------|
| Sun | +38 | +19 | Leo |
| Moon | +23 | +11.5 | Cancer |
| Mercury | +33 | +16.5 | Gemini, Virgo |
| Venus | +10 | +5 | Taurus, Libra |
| Mars | −25 | −12.5 | Aries, Scorpio |
| Jupiter | −13 | −6.5 | Pisces, Sagittarius |
| Saturn | +12 | +6 | Aquarius, Capricorn |

Two independent systems coexist: Lionel's chromatic-calendar determines the note class (C through B), Cousto determines the cents offset within that note. In natal mode, degree-based detune (`(degree - 15) × 3.33¢`) replaces Cousto.

## Astrological System

Traditional (pre-modern) planetary rulership — 7 visible planets, no co-rulers (Uranus, Neptune, Pluto). This matches Cousto's original system and creates cleaner shared-ruler pairs that produce harmonic groupings.

| Sign | Ruler | Tier |
|------|-------|------|
| Leo | Sun | Luminary |
| Cancer | Moon | Luminary |
| Aries | Mars | Personal |
| Scorpio | Mars | Personal |
| Taurus | Venus | Personal |
| Libra | Venus | Personal |
| Gemini | Mercury | Personal |
| Virgo | Mercury | Personal |
| Sagittarius | Jupiter | Social |
| Pisces | Jupiter | Social |
| Capricorn | Saturn | Social |
| Aquarius | Saturn | Social |

## FX Chains

Eight pre-wired chains — same nodes, different order, different character:

| Chain | Order (abbreviated) | Character |
|-------|---------------------|-----------|
| **Zodiac** | vib → echo → eq → cheby → rev → cho | Balanced. Beautiful on load, cosmic at extremes |
| Cathedral | cheby → eq → vib → echo → rev → cho | Saturation first — warm, thick |
| Void | cheby → dist → eq → vib → rev → pha → echo → cho | Reverb before delay — infinite receding echoes |
| Furnace | echo → cheby → dist → eq → vib → rev → cho → pha | Clean echoes re-enter waveshaper — progressively dirtier |
| Tape | vib → cheby → dist → eq → echo → rev → cho → pha | Pitch drift feeds saturation — time-varying harmonics |
| Evolve | vib → echo → rev → pha → cheby → dist → eq → cho | Space before saturation — new harmonics as tails decay |
| Glass | eq → vib → echo → rev → cho → pha | No saturation at all — crystalline |
| Custom | (blank slate — uncomment and reorder) | Build your own |

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

**Eclipse** — Chaos mode. FX params ramp toward extreme values over 16 seconds (feedback 0.87, reverb wet 0.85, chebyshev wet 0.85, spread 120¢, etc.). Toggle off to restore.

**Breathe** — Cycles oscillator type: fatsine → amsine → fattriangle → amtriangle → fmtriangle → fatsawtooth → fmsine → fatsquare.

**Listen** — Monitor EQ presets for headphones, laptop speakers, phone, or loudspeakers.

**Randomize** — Throws the knobs.

## Natal Chart

Enter birth date, time, and location to compute a tropical whole-sign horoscope via `circular-natal-horoscope-js`. Each celestial body (Sun, Moon, Mercury through Pluto, Chiron) activates the voice of its zodiac sign — your chart becomes a chord. If birth time is provided, the Ascendant activates its sign too.

Each body's ecliptic degree within its sign (0–30°) applies microtonal detuning: `(degree - 15) * 3.33¢`. A planet at the start of a sign detunes −50¢, mid-sign stays centered, end of sign +50¢. Two people with Sun in Aries hear different tunings depending on where in Aries their Sun sits.

Partial data is fine:

- **Date only** — valid planetary positions, no Ascendant (needs time)
- **Date + time** — planets + Ascendant (Ascendant accuracy improves with location)
- **All four fields** — fully accurate positions

Manual key exploration is always available — toggling keys doesn't interfere with natal chart flow.

## Setup

```bash
npm install
npm start
```

## Tuning

All sound-shaping numbers live in `src/tuning.js`: TUNING defaults, SHADOW chaos targets, KNOB_DEFS, KNOB_GROUPS, LISTEN_PRESETS, CHAINS, OSC_TYPES, COUSTO_DETUNE, OCTAVE_GAIN. Change a value, hear the difference.

Engine + UI + visuals live in `src/App.js`.

## Deploy

Netlify. `npm run build` → `build/`.
