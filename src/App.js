// ═══════════════════════════════════════════════════════════════
// CELESTIAL PAD v4.5 — Cleanup + Readability Pass
// FatOscillator unison → Chebyshev → tape EQ → VHS wow → delay cascade → cathedral reverb → stereo drift
// Bloom envelope + fatsawtooth layer. Dbmaj9 spread voicing. Freeverb @ 24kHz.
//
// CodeSandbox Setup:
//   1. Create a React sandbox (https://react.new)
//   2. Add dependency: tone
//   3. Replace src/App.js with this file
// ═══════════════════════════════════════════════════════════════

import React, { useRef, useState, useCallback, useEffect } from "react";
import * as Tone from "tone";

// Voicing presets — note classes assigned to planets.
// Voicing: Dbmaj9 spread — Kid A territory. Fully submerged.
// Sorted: Db2 - Ab3 - Db4 - F4 - Ab4 - C5 - Eb5
// Intervals: P5 - P4 - M3 - m3 - M3 - m3  (all safe per low interval limits)

// Per-planet voicing: octave register + velocity (0-1)
// Range: oct 2-5 (mid-heavy). Color tones above E3, root/5th only below.
const PLANETS = {
  Sun: { octave: 4, vel: 1.0, glyph: "\u2609" }, // Db4 — root, center
  Moon: { octave: 5, vel: 0.5, glyph: "\u263D" }, // C5  — maj7, floating
  Mercury: { octave: 5, vel: 0.3, glyph: "\u263F" }, // Eb5 — 9th, sparkle
  Venus: { octave: 4, vel: 1.0, glyph: "\u2640" }, // F4  — maj3, warmth
  Mars: { octave: 3, vel: 0.8, glyph: "\u2642" }, // Ab3 — 5th, support
  Jupiter: { octave: 2, vel: 1.0, glyph: "\u2643" }, // Db2 — root, deep anchor
  Saturn: { octave: 4, vel: 0.5, glyph: "\u2644" }, // Ab4 — 5th, shimmer
  Uranus: { octave: 5, vel: 0.4, glyph: "\u2645" },
  Neptune: { octave: 5, vel: 0.2, glyph: "\u2646" },
  Pluto: { octave: 2, vel: 0.3, glyph: "\u2647" },
  Ascendant: { octave: 4, vel: 0.9, glyph: "AC" },
};

// Demo voicings — Dbmaj9 (Db F Ab C Eb) spread across planet octave registers
// Single: root. Chord: Dbmaj7. Full: complete Dbmaj9 with doublings.
const CHARTS = {
  single: { Sun: "Db" },
  chord: { Sun: "Db", Venus: "F", Mars: "Ab", Moon: "C" },
  full: {
    Sun: "Db", // oct 4 — root, center
    Moon: "C", // oct 5 — maj7, floating
    Mercury: "Eb", // oct 5 — 9th, sparkle
    Venus: "F", // oct 4 — maj3, warmth
    Mars: "Ab", // oct 3 — 5th, foundation
    Jupiter: "Db", // oct 2 — root, deep anchor
    Saturn: "Ab", // oct 4 — 5th, shimmer
  },
};

// ─── Tuning Constants ────────────────────────────────────────
// Every tweakable number in one place. Change a value here,
// hear it immediately — no need to read the engine code.

const TUNING = {
  sampleRate: 24000,
  // Oscillator
  oscSpread: 55, // cents — detuning between FatOsc voices
  oscCount: 3, // voices per note
  // Envelope (bloom)
  attack: 1.5, // seconds
  decay: 3.5,
  sustain: 0.2, // level 0-1
  release: 5.0,
  // Chebyshev saturation
  chebyOrder: 3,
  chebyWet: 0.65,
  // Tape EQ
  eqHigh: -24, // dB — HF rolloff
  eqMid: 5, // dB
  eqLow: 5, // dB — bass warmth
  eqHighFreq: 3000, // Hz — HF shelf corner
  // VHS wow (vibrato)
  vibratoFreq: 0.25, // Hz
  vibratoDepth: 0.22,
  vibratoWet: 0.8,
  // Delay cascade
  delayTime: 0.6, // seconds
  delayFeedback: 0.68,
  delayWet: 0.5,
  // Cathedral reverb
  reverbRoom: 0.95, // 0-1
  reverbDamp: 1500, // Hz
  reverbWet: 0.97,
  // Stereo drift
  panFreq: 0.04, // Hz — 25s full cycle
  panDepth: 0.7,
  // Stagger
  stagger: 0.45, // seconds between planet triggers
  retriggerGap: 80, // ms between release and re-attack
};

// ─── Audio Engine Factory ────────────────────────────────────

async function createEngine() {
  // 24kHz: all content below 4kHz (EQ rolls off there), Nyquist at 12kHz is plenty.
  // Halves CPU cost of every WebAudio node. Playback hint for larger buffer.
  // lookAhead 0.2 + updateInterval 0.1 = more scheduling headroom on mobile
  // (ambient pads don't need tight timing — stagger dwarfs the jitter)
  Tone.setContext(
    new Tone.Context({
      latencyHint: "playback",
      sampleRate: TUNING.sampleRate,
      lookAhead: 0.2,
      updateInterval: 0.1,
    })
  );
  await Tone.start();

  // ─── FX chain (signal-flow order) ─────────────────────────
  // Chebyshev → EQ3 → Vibrato → FeedbackDelay → Freeverb → AutoPanner → Destination

  // 3rd-order Chebyshev — harmonic crunch, tube-amp saturation
  const chebyshev = new Tone.Chebyshev(TUNING.chebyOrder);
  chebyshev.wet.value = TUNING.chebyWet;

  // Heavy lofi HF rolloff — buries above 3kHz, mid + low warmth boosted for Db2 anchor
  const eq3 = new Tone.EQ3({
    high: TUNING.eqHigh,
    mid: TUNING.eqMid,
    low: TUNING.eqLow,
    highFrequency: TUNING.eqHighFreq,
  });

  // VHS tape wow — slow irregular pitch drift
  const vibrato = new Tone.Vibrato({
    frequency: TUNING.vibratoFreq,
    depth: TUNING.vibratoDepth,
  });
  vibrato.wet.value = TUNING.vibratoWet;

  // Delay cascade — shorter time + high feedback = rhythmic echoes
  // Staggered planet triggers interleave with the echo pattern
  const feedbackDelay = new Tone.FeedbackDelay({
    delayTime: TUNING.delayTime,
    feedback: TUNING.delayFeedback,
  });
  feedbackDelay.wet.value = TUNING.delayWet;

  // Algorithmic reverb — dramatically cheaper than convolution (no 240K-sample IR).
  // At 97% wet the character difference vs convolution is nil.
  // dampening rolls off highs in the tail to match the tape EQ darkening.
  // Freeverb: Tone.js >=14.7.39 uses AudioWorklet internally.
  // If glitchy on mobile, try Tone.Reverb({ decay: 8 }) — convolver may actually be cheaper.
  const reverb = new Tone.Freeverb({
    roomSize: TUNING.reverbRoom,
    dampening: TUNING.reverbDamp,
  });
  reverb.wet.value = TUNING.reverbWet;

  // Glacial stereo drift — 25s full L/R cycle
  const autoPanner = new Tone.AutoPanner({
    frequency: TUNING.panFreq,
    depth: TUNING.panDepth,
  }).start();

  // Single chain call — reads as signal flow, impossible to mis-wire
  // .toDestination() instead of Tone.Destination — resolves against the node's
  // own AudioContext, not the default one (we swap contexts via setContext above).
  chebyshev.chain(eq3, vibrato, feedbackDelay, reverb, autoPanner);
  autoPanner.toDestination();

  // ─── Synth ────────────────────────────────────────────────

  // FatOscillator: detuned saws — Prophet-5 character, thick analog unison
  // Bloom envelope: slow swell, peak, settle to quiet bed, long dissolve into reverb
  const fatPad = new Tone.PolySynth(Tone.Synth, {
    oscillator: {
      type: "fatsawtooth",
      count: TUNING.oscCount,
      spread: TUNING.oscSpread,
    },
    envelope: {
      attack: TUNING.attack,
      decay: TUNING.decay,
      sustain: TUNING.sustain,
      release: TUNING.release,
    },
    volume: -6,
  });
  fatPad.maxPolyphony = 7;
  fatPad.connect(chebyshev);

  return {
    fatPad,
    dispose() {
      [
        fatPad,
        chebyshev,
        eq3,
        vibrato,
        feedbackDelay,
        reverb,
        autoPanner,
      ].forEach((n) => n.dispose());
    },
  };
}

// ─── Component ───────────────────────────────────────────────

export default function App() {
  const engineRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | ready | playing
  const [voices, setVoices] = useState([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  // Trigger a voicing — each planet gets its note at its velocity
  // Planets stagger 0.45s apart (more deliberate unfolding, feeds delay cascade)
  const triggerChart = useCallback((chart) => {
    const eng = engineRef.current;
    if (!eng) return;

    const now = Tone.now();
    const triggered = [];
    const entries = Object.entries(chart);

    entries.forEach(([planet, noteClass], i) => {
      const cfg = PLANETS[planet];
      if (!cfg || !noteClass) return;

      const note = `${noteClass}${cfg.octave}`;
      const onset = i * TUNING.stagger;

      if (cfg.vel > 0) eng.fatPad.triggerAttack(note, now + onset, cfg.vel);

      triggered.push({ planet, glyph: cfg.glyph, note });
    });

    setVoices(triggered);
    setStatus("playing");
  }, []);

  // Init (if needed) + release previous + trigger new chart
  const play = useCallback(
    async (chart) => {
      // Release any currently sounding voices
      if (engineRef.current) {
        engineRef.current.fatPad.releaseAll();
      }

      // First click: build the engine (requires user gesture for AudioContext)
      if (!engineRef.current) {
        engineRef.current = await createEngine();
        setStatus("ready");
      }

      // Brief pause between release and new attack for PolySynth voice reuse
      setTimeout(() => triggerChart(chart), TUNING.retriggerGap);
    },
    [triggerChart]
  );

  // Release all voices — let the reverb tail ring out
  const release = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.fatPad.releaseAll();
    setVoices([]);
    setStatus("ready");
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div className="cel-root">
        <h1 className="cel-title">Celestial Pad</h1>
        <p className="cel-sub">Ambient Synthesizer</p>

        <div className="cel-buttons">
          <button
            type="button"
            className="cel-btn"
            onClick={() => play(CHARTS.single)}
          >
            <span className="cel-btn-glyph">{PLANETS.Sun.glyph}</span>
            <span className="cel-btn-label">Single Note</span>
            <span className="cel-btn-desc">Db root tone</span>
          </button>

          <button
            type="button"
            className="cel-btn"
            onClick={() => play(CHARTS.chord)}
          >
            <span className="cel-btn-glyph">
              {PLANETS.Sun.glyph} {PLANETS.Venus.glyph} {PLANETS.Mars.glyph}{" "}
              {PLANETS.Moon.glyph}
            </span>
            <span className="cel-btn-label">Chord</span>
            <span className="cel-btn-desc">Dbmaj7 &middot; 4 voices</span>
          </button>

          <button
            type="button"
            className="cel-btn cel-btn-primary"
            onClick={() => play(CHARTS.full)}
          >
            <span className="cel-btn-glyph">{"\u2605"}</span>
            <span className="cel-btn-label">Full Voicing</span>
            <span className="cel-btn-desc">Dbmaj9 &middot; 7 voices</span>
          </button>

          <button
            type="button"
            className="cel-btn cel-btn-release"
            onClick={release}
            disabled={status !== "playing"}
          >
            <span className="cel-btn-label">Release</span>
            <span className="cel-btn-desc">Let it fade&hellip;</span>
          </button>
        </div>

        {voices.length > 0 && (
          <div className="cel-voices">
            {voices.map(({ planet, glyph, note }) => (
              <div key={planet} className="cel-voice">
                <span className="cel-voice-glyph">{glyph}</span>
                <span className="cel-voice-planet">{planet}</span>
                <span className="cel-voice-note">{note}</span>
              </div>
            ))}
          </div>
        )}

        <div className="cel-info">
          <p>
            Each planet triggers a voice &mdash; spread across registers,
            staggered in time.
          </p>
          <p>3 detuned oscillators per voice, drowning in reverb and delay.</p>
          <p className="cel-chain">
            Fat saw pad &rarr; Tube saturation &rarr; Tape EQ
            <br />
            &rarr; VHS wow &rarr; Delay cascade
            <br />
            &rarr; Cathedral reverb &rarr; Stereo drift
          </p>
        </div>

        <div className="cel-footer">
          <p>
            v4.5 &middot; Dbmaj9 spread voicing &middot; 24kHz. FatOscillator
            unison, bloom envelope, algorithmic reverb.
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #08080f;
    overflow-x: hidden;
  }

  .cel-root {
    min-height: 100vh;
    background: linear-gradient(170deg, #0a0a1a 0%, #15082e 40%, #0d0d20 100%);
    color: #d8d0e8;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem 1.5rem;
    user-select: none;
    -webkit-user-select: none;
  }

  .cel-title {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 2.8rem;
    font-weight: 400;
    letter-spacing: 0.15em;
    color: #f0e8ff;
    text-shadow: 0 0 30px rgba(180, 140, 255, 0.3);
    animation: cel-glow 6s ease-in-out infinite;
    margin-bottom: 0.5rem;
  }

  @keyframes cel-glow {
    0%, 100% { text-shadow: 0 0 30px rgba(180, 140, 255, 0.2); }
    50% { text-shadow: 0 0 50px rgba(180, 140, 255, 0.5), 0 0 80px rgba(140, 100, 220, 0.2); }
  }

  .cel-sub {
    font-size: 0.95rem;
    color: #8878a0;
    letter-spacing: 0.08em;
    margin-bottom: 2.5rem;
  }

  .cel-buttons {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 2rem;
  }

  .cel-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(180, 140, 255, 0.15);
    border-radius: 12px;
    color: #d8d0e8;
    padding: 1.2rem 1.5rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    min-width: 130px;
    transition: all 0.3s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .cel-btn:hover:not(:disabled) {
    background: rgba(180, 140, 255, 0.1);
    border-color: rgba(180, 140, 255, 0.35);
    transform: translateY(-2px);
    box-shadow: 0 4px 20px rgba(140, 100, 220, 0.15);
  }

  .cel-btn:active:not(:disabled) {
    transform: translateY(0);
    background: rgba(180, 140, 255, 0.18);
  }

  .cel-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .cel-btn-primary {
    border-color: rgba(180, 140, 255, 0.3);
    background: rgba(180, 140, 255, 0.08);
  }

  .cel-btn-primary:hover:not(:disabled) {
    background: rgba(180, 140, 255, 0.18);
    border-color: rgba(180, 140, 255, 0.5);
    box-shadow: 0 4px 30px rgba(140, 100, 220, 0.25);
  }

  .cel-btn-release {
    border-color: rgba(255, 180, 140, 0.15);
  }

  .cel-btn-release:hover:not(:disabled) {
    background: rgba(255, 180, 140, 0.1);
    border-color: rgba(255, 180, 140, 0.35);
  }

  .cel-btn-glyph {
    font-size: 1.4rem;
    color: #c4a0ff;
  }

  .cel-btn-label {
    font-weight: 600;
    font-size: 0.95rem;
    letter-spacing: 0.03em;
  }

  .cel-btn-desc {
    font-size: 0.75rem;
    color: #8070a0;
  }

  .cel-voices {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 2rem;
  }

  .cel-voice {
    background: rgba(180, 140, 255, 0.08);
    border: 1px solid rgba(180, 140, 255, 0.2);
    border-radius: 8px;
    padding: 0.5rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .cel-voice-glyph {
    font-size: 1.1rem;
    color: #c4a0ff;
  }

  .cel-voice-planet {
    font-weight: 600;
    color: #e0d8f0;
  }

  .cel-voice-note {
    color: #8878a0;
    font-size: 0.8rem;
  }

  .cel-info {
    text-align: center;
    max-width: 420px;
    font-size: 0.85rem;
    line-height: 1.6;
    color: #706888;
  }

  .cel-info p {
    margin-bottom: 0.4rem;
  }

  .cel-chain {
    margin-top: 0.8rem;
    font-size: 0.75rem;
    color: #504868;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    line-height: 1.8;
  }

  .cel-footer {
    margin-top: 3rem;
    max-width: 500px;
    text-align: center;
    font-size: 0.7rem;
    color: #3a3050;
    line-height: 1.6;
  }
`;
