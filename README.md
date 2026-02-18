# Celestial Pad v4.5

Ambient synthesizer built with React and Tone.js. Seven voices of a Dbmaj9 chord, staggered across planetary registers, drowning in reverb and delay.

## Signal Chain

```
FatOsc (3-voice unison, 55¢ spread)
  → Chebyshev saturation
  → Tape EQ (-24dB HF rolloff)
  → VHS wow (slow vibrato)
  → Feedback delay (0.6s, 68%)
  → Freeverb (97% wet)
  → Stereo drift (25s cycle)
```

## Setup

1. Create a React sandbox at [react.new](https://react.new)
2. Add dependency: `tone`
3. Replace `src/App.js` with `App.js`

## Tuning

Every tweakable parameter lives in the `TUNING` object near the top of `App.js`. Change a value, hear the difference — no need to read the engine code.

## Voicings

| Button | Chord | Voices |
|--------|-------|--------|
| Single Note | Db | 1 |
| Chord | Dbmaj7 | 4 |
| Full Voicing | Dbmaj9 | 7 |

Voices are assigned to planets with per-planet octave registers and velocities. Full voicing spans Db2 through Eb5.

## Performance

Runs at 24kHz (all content is below 4kHz after EQ). Freeverb is algorithmic — no convolution IR, instant startup. If reverb glitches on mobile, swap `Tone.Freeverb` for `Tone.Reverb({ decay: 8 })` (see comment in source).
