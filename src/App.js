// ═══════════════════════════════════════════════════════════════
// CELESTIAL PAD v6 — 12-Voice Stereo Engine + Shadow v2
// 12x [Synth → Panner] → Chebyshev → tape EQ → VHS wow
//   → delay cascade → convolution reverb → monitor EQ → limiter
//
// Per-planet stereo positioning with grouped LFO drift.
// Tone.Reverb (ConvolverNode) — no AudioWorklet, works on HTTP.
// 12 chromatic pitch classes: Db Ab G C Eb F A D E Gb Bb B
// ═══════════════════════════════════════════════════════════════

import React, { useRef, useState, useCallback, useEffect } from "react";
import * as Tone from "tone";
import { Origin, Horoscope } from "circular-natal-horoscope-js";

// 12 planets — each carries note class, octave, velocity, glyph,
// fixed stereo base, pan group (for LFO), osc count, osc spread.
const PLANETS = {
  Jupiter:   { octave: 2, vel: 1.0, glyph: "\u2643", note: "Db", panBase: -0.85, panGroup: "A", oscCount: 3, oscSpread: 55 },
  Pluto:     { octave: 2, vel: 0.3, glyph: "\u2647", note: "Ab", panBase: -0.62, panGroup: "A", oscCount: 3, oscSpread: 55 },
  Mars:      { octave: 3, vel: 0.8, glyph: "\u2642", note: "G",  panBase: -0.38, panGroup: "B", oscCount: 3, oscSpread: 50 },
  Saturn:    { octave: 4, vel: 0.5, glyph: "\u2644", note: "C",  panBase: -0.15, panGroup: "B", oscCount: 3, oscSpread: 45 },
  Ascendant: { octave: 4, vel: 0.9, glyph: "AC",     note: "Eb", panBase:  0.0,  panGroup: "C", oscCount: 3, oscSpread: 45 },
  Sun:       { octave: 4, vel: 1.0, glyph: "\u2609", note: "F",  panBase:  0.15, panGroup: "C", oscCount: 3, oscSpread: 45 },
  Venus:     { octave: 4, vel: 1.0, glyph: "\u2640", note: "A",  panBase:  0.38, panGroup: "C", oscCount: 3, oscSpread: 45 },
  Chiron:    { octave: 5, vel: 0.6, glyph: "\u26B7", note: "D",  panBase:  0.62, panGroup: "D", oscCount: 2, oscSpread: 40 },
  Neptune:   { octave: 5, vel: 0.2, glyph: "\u2646", note: "E",  panBase:  0.46, panGroup: "D", oscCount: 2, oscSpread: 40 },
  Mercury:   { octave: 5, vel: 0.3, glyph: "\u263F", note: "Gb", panBase:  0.08, panGroup: "D", oscCount: 2, oscSpread: 40 },
  Uranus:    { octave: 5, vel: 0.4, glyph: "\u2645", note: "Bb", panBase:  0.72, panGroup: "D", oscCount: 2, oscSpread: 40 },
  Moon:      { octave: 5, vel: 0.5, glyph: "\u263D", note: "B",  panBase: -0.23, panGroup: "A", oscCount: 2, oscSpread: 40 },
};

// ─── Tuning Constants ────────────────────────────────────────
const TUNING = {
  sampleRate: 24000,
  // Envelope (bloom)
  attack: 2.0,
  decay: 3.5,
  sustain: 0.43,
  release: 2.6,
  // Chebyshev saturation
  chebyOrder: 3,
  chebyWet: 0.77,
  // Tape EQ
  eqHigh: -12,
  eqMid: 5,
  eqLow: 5,
  eqHighFreq: 3000,
  // VHS wow (vibrato)
  vibratoFreq: 0.25,
  vibratoDepth: 0.28,
  vibratoWet: 0.8,
  // Delay cascade
  delayTime: 0.777,
  delayFeedback: 0.58,
  delayWet: 0.64,
  // Convolution reverb
  reverbDecay: 6,
  reverbWet: 0.85,
  // Per-voice panning LFOs
  panLfoFreq: 0.05,
  panLfoAmplitude: 0.12,
  // Monitor EQ crossover freqs
  monitorLowFreq: 400,
  monitorHighFreq: 2500,
  // Stagger / retrigger
  stagger: 0.45,
  retriggerGap: 80,
  // Shadow mode chaos targets
  shadow: {
    reverbWet: 0.96,
    delayFeedback: 0.94,
    delayWet: 0.88,
    vibratoDepth: 0.72,
    vibratoFreq: 0.06,
    chebyWet: 1.0,
    panLfoFreq: 0.18,
    panLfoAmplitude: 0.55,
    oscSpread: 120,
    detuneRange: 15,
    rampTime: 3,
  },
};

// ZODIAC_NOTES: zodiac sign → note class. Placeholder — swap with Lionel's mapping.
const ZODIAC_NOTES = {
  aries: "C", taurus: "Db", gemini: "D", cancer: "Eb", leo: "E", virgo: "F",
  libra: "Gb", scorpio: "G", sagittarius: "Ab", capricorn: "A", aquarius: "Bb", pisces: "B",
};

const LISTEN_PRESETS = {
  headphones:  { low: -2, mid: 0,  high: 1,  label: "HP" },
  laptop:      { low: 6,  mid: 2,  high: 3,  label: "Laptop" },
  phone:       { low: 4,  mid: 3,  high: 2,  label: "Phone" },
  loudspeaker: { low: 3,  mid: -2, high: 0,  label: "Speaker" },
};

// ─── Audio Engine Factory ────────────────────────────────────

async function createEngine() {
  Tone.setContext(
    new Tone.Context({
      latencyHint: "playback",
      sampleRate: TUNING.sampleRate,
      lookAhead: 0.2,
      updateInterval: 0.1,
    })
  );
  await Tone.start();

  // ─── FX chain (constructed before synths so panners have a target) ───

  const chebyshev = new Tone.Chebyshev(TUNING.chebyOrder);
  chebyshev.wet.value = TUNING.chebyWet;

  const eq3 = new Tone.EQ3({
    high: TUNING.eqHigh,
    mid: TUNING.eqMid,
    low: TUNING.eqLow,
    highFrequency: TUNING.eqHighFreq,
  });

  const vibrato = new Tone.Vibrato({
    frequency: TUNING.vibratoFreq,
    depth: TUNING.vibratoDepth,
  });
  vibrato.wet.value = TUNING.vibratoWet;

  const feedbackDelay = new Tone.FeedbackDelay({
    delayTime: TUNING.delayTime,
    feedback: TUNING.delayFeedback,
  });
  feedbackDelay.wet.value = TUNING.delayWet;

  const reverb = new Tone.Reverb({ decay: TUNING.reverbDecay });
  await reverb.generate();
  reverb.wet.value = TUNING.reverbWet;

  const monitorEQ = new Tone.EQ3({
    low: 0,
    mid: 0,
    high: 0,
    lowFrequency: TUNING.monitorLowFreq,
    highFrequency: TUNING.monitorHighFreq,
  });

  const limiter = new Tone.Limiter(-1);

  chebyshev.chain(eq3, vibrato, feedbackDelay, reverb, monitorEQ, limiter);
  limiter.toDestination();

  // ─── Per-planet synths + panners ──────────────────────────

  const synths = {};
  const panners = {};

  Object.entries(PLANETS).forEach(([name, cfg]) => {
    const panner = new Tone.Panner(cfg.panBase);
    const synth = new Tone.Synth({
      oscillator: { type: "fattriangle", count: cfg.oscCount, spread: cfg.oscSpread },
      envelope: {
        attack: TUNING.attack,
        decay: TUNING.decay,
        sustain: TUNING.sustain,
        release: TUNING.release,
      },
      volume: -12,
    });
    synth.connect(panner);
    panner.connect(chebyshev);
    synths[name] = synth;
    panners[name] = panner;
  });

  // ─── Group LFOs — one per panGroup, drift all panners in that group ──

  const panLfos = {};
  ["A", "B", "C", "D"].forEach(group => {
    const lfo = new Tone.LFO({ frequency: TUNING.panLfoFreq, min: -1, max: 1 });
    lfo.amplitude.value = TUNING.panLfoAmplitude;
    lfo.start();
    Object.entries(PLANETS).forEach(([name, cfg]) => {
      if (cfg.panGroup === group) lfo.connect(panners[name].pan);
    });
    panLfos[group] = lfo;
  });

  return {
    synths,
    panners,
    panLfos,
    fx: { reverb, feedbackDelay, vibrato, chebyshev, monitorEQ },
    dispose() {
      Object.values(synths).forEach(s => s.dispose());
      Object.values(panners).forEach(p => p.dispose());
      Object.values(panLfos).forEach(l => l.dispose());
      [chebyshev, eq3, vibrato, feedbackDelay, reverb, monitorEQ, limiter].forEach(n => n.dispose());
    },
  };
}

// ─── Component ───────────────────────────────────────────────

export default function App() {
  const engineRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [activePlanets, setActivePlanets] = useState(new Set());
  const [shadow, setShadow] = useState(false);
  const [listenPreset, setListenPreset] = useState("headphones");
  const shadowIntervalsRef = useRef([]);
  const [natalMode, setNatalMode] = useState(false);
  const [natalDate, setNatalDate] = useState("");
  const [natalTime, setNatalTime] = useState("");
  const [natalLat, setNatalLat] = useState("");
  const [natalLng, setNatalLng] = useState("");
  const [natalNotes, setNatalNotes] = useState({});

  useEffect(() => {
    return () => {
      shadowIntervalsRef.current.forEach(id => clearInterval(id));
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = await createEngine();
      setStatus("ready");
    }
    return engineRef.current;
  }, []);

  const togglePlanet = useCallback(async (planet) => {
    const eng = await ensureEngine();
    const cfg = PLANETS[planet];
    if (!cfg) return;
    const noteClass = natalMode && natalNotes[planet] ? natalNotes[planet] : cfg.note;
    const note = `${noteClass}${cfg.octave}`;
    setActivePlanets(prev => {
      const next = new Set(prev);
      if (next.has(planet)) {
        eng.synths[planet].triggerRelease(Tone.now());
        next.delete(planet);
      } else {
        eng.synths[planet].triggerAttack(note, Tone.now(), cfg.vel);
        next.add(planet);
      }
      setStatus(next.size > 0 ? "playing" : "ready");
      return next;
    });
  }, [ensureEngine, natalMode, natalNotes]);

  const release = useCallback(() => {
    if (!engineRef.current) return;
    Object.values(engineRef.current.synths).forEach(s => s.triggerRelease(Tone.now()));
    setActivePlanets(new Set());
    setStatus("ready");
  }, []);

  const toggleShadow = useCallback(async () => {
    const eng = await ensureEngine();
    const { reverb, feedbackDelay, vibrato, chebyshev } = eng.fx;
    const st = TUNING.shadow;

    if (!shadow) {
      const rt = st.rampTime;
      reverb.wet.rampTo(st.reverbWet, rt);
      feedbackDelay.feedback.rampTo(st.delayFeedback, rt);
      feedbackDelay.wet.rampTo(st.delayWet, rt);
      vibrato.depth.rampTo(st.vibratoDepth, rt);
      vibrato.frequency.rampTo(st.vibratoFreq, rt);
      chebyshev.wet.rampTo(st.chebyWet, rt);

      Object.values(eng.panLfos).forEach(lfo => {
        lfo.frequency.rampTo(st.panLfoFreq, rt);
        lfo.amplitude.rampTo(st.panLfoAmplitude, rt);
      });

      const spreadId = setInterval(() => {
        Object.entries(eng.synths).forEach(([name, synth]) => {
          const current = synth.oscillator.spread;
          if (current < st.oscSpread) {
            synth.oscillator.spread = Math.min(current + 3, st.oscSpread);
          }
        });
      }, 60);

      const detuneId = setInterval(() => {
        Object.values(eng.synths).forEach(synth => {
          const target = (Math.random() * 2 - 1) * st.detuneRange;
          synth.detune.rampTo(target, 0.4);
        });
      }, 800);

      shadowIntervalsRef.current = [spreadId, detuneId];
    } else {
      shadowIntervalsRef.current.forEach(id => clearInterval(id));
      shadowIntervalsRef.current = [];

      const rt = st.rampTime;
      reverb.wet.rampTo(TUNING.reverbWet, rt);
      feedbackDelay.feedback.rampTo(TUNING.delayFeedback, rt);
      feedbackDelay.wet.rampTo(TUNING.delayWet, rt);
      vibrato.depth.rampTo(TUNING.vibratoDepth, rt);
      vibrato.frequency.rampTo(TUNING.vibratoFreq, rt);
      chebyshev.wet.rampTo(TUNING.chebyWet, rt);

      Object.values(eng.panLfos).forEach(lfo => {
        lfo.frequency.rampTo(TUNING.panLfoFreq, rt);
        lfo.amplitude.rampTo(TUNING.panLfoAmplitude, rt);
      });

      Object.entries(eng.synths).forEach(([name, synth]) => {
        synth.oscillator.spread = PLANETS[name].oscSpread;
        synth.detune.rampTo(0, rt);
      });
    }
    setShadow(s => !s);
  }, [shadow, ensureEngine]);

  const applyListenPreset = useCallback(async (key) => {
    const eng = await ensureEngine();
    const preset = LISTEN_PRESETS[key];
    if (!preset || !eng.fx.monitorEQ) return;
    eng.fx.monitorEQ.low.value = preset.low;
    eng.fx.monitorEQ.mid.value = preset.mid;
    eng.fx.monitorEQ.high.value = preset.high;
    setListenPreset(key);
  }, [ensureEngine]);

  const computeNatalChart = useCallback(() => {
    if (!natalDate) return;

    const [year, month, day] = natalDate.split("-").map(Number);
    let hour = 12, minute = 0;
    if (natalTime) {
      [hour, minute] = natalTime.split(":").map(Number);
    }

    const latitude = parseFloat(natalLat) || 0;
    const longitude = parseFloat(natalLng) || 0;

    const origin = new Origin({
      year, month: month - 1, date: day,
      hour, minute,
      latitude, longitude,
    });

    const chart = new Horoscope({
      origin,
      houseSystem: "whole-sign",
      zodiac: "tropical",
      aspectPoints: ["bodies", "points", "angles"],
      aspectWithPoints: ["bodies", "points", "angles"],
      aspectTypes: ["major"],
      language: "en",
    });

    const notes = {};
    const bodyMap = {
      Sun: "sun", Moon: "moon", Mercury: "mercury", Venus: "venus",
      Mars: "mars", Jupiter: "jupiter", Saturn: "saturn",
      Uranus: "uranus", Neptune: "neptune", Pluto: "pluto", Chiron: "chiron",
    };

    Object.entries(bodyMap).forEach(([planet, bodyKey]) => {
      const body = chart.CelestialBodies[bodyKey];
      if (body && body.Sign && body.Sign.label) {
        notes[planet] = ZODIAC_NOTES[body.Sign.label.toLowerCase()] || null;
      }
    });

    // Ascendant only valid with birth time
    if (natalTime && chart.Ascendant && chart.Ascendant.Sign) {
      notes.Ascendant = ZODIAC_NOTES[chart.Ascendant.Sign.label.toLowerCase()] || null;
    } else {
      notes.Ascendant = null;
    }

    setNatalNotes(notes);
    setNatalMode(true);
  }, [natalDate, natalTime, natalLat, natalLng]);

  const playNatalChart = useCallback(async () => {
    if (!natalMode) return;
    const eng = await ensureEngine();

    Object.values(eng.synths).forEach(s => s.triggerRelease(Tone.now()));

    setTimeout(() => {
      const now = Tone.now();
      const next = new Set();

      Object.entries(PLANETS).forEach(([planet, cfg], i) => {
        const noteClass = natalNotes[planet];
        if (!noteClass) return;
        const note = `${noteClass}${cfg.octave}`;
        eng.synths[planet].triggerAttack(note, now + i * TUNING.stagger, cfg.vel);
        next.add(planet);
      });

      setActivePlanets(next);
      setStatus("playing");
    }, TUNING.retriggerGap);
  }, [natalMode, natalNotes, ensureEngine]);

  return (
    <>
      <style>{CSS}</style>
      <div className="cel-root">
        <h1 className="cel-title">Celezdial Selekta</h1>
        <p className="cel-sub">shandcashtle shintashizher, u like?</p>

        <div className="cel-grid">
          {Object.entries(PLANETS).map(([planet, cfg]) => {
            const active = activePlanets.has(planet);
            const isUncertain = planet === "Ascendant" && natalMode && !natalTime;
            return (
              <button
                key={planet}
                type="button"
                className={`cel-planet${active ? " cel-planet-active" : ""}${isUncertain ? " cel-planet-uncertain" : ""}`}
                onClick={() => togglePlanet(planet)}
              >
                <span className="cel-planet-glyph">{cfg.glyph}</span>
                <span className="cel-planet-name">{planet}</span>
                <span className="cel-planet-note">
                  {natalMode && natalNotes[planet] ? natalNotes[planet] : `${cfg.note}${cfg.octave}`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="cel-controls">
          <button
            type="button"
            className={`cel-btn cel-shadow-btn${shadow ? " cel-shadow-active" : ""}`}
            onClick={toggleShadow}
          >
            <span className="cel-btn-glyph">{"\u25D0"}</span>
            <span className="cel-btn-label">Shadow</span>
          </button>
          <button
            type="button"
            className="cel-btn cel-release-btn"
            onClick={release}
            disabled={status !== "playing"}
          >
            <span className="cel-btn-label">Release</span>
          </button>
        </div>

        <div className="cel-listen">
          {Object.entries(LISTEN_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className={`cel-listen-pill${listenPreset === key ? " cel-listen-active" : ""}`}
              onClick={() => applyListenPreset(key)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <details className="cel-natal">
          <summary className="cel-natal-summary">Natal Chart</summary>
          <div className="cel-natal-body">
            <div className="cel-natal-inputs">
              <input
                type="date"
                value={natalDate}
                onChange={e => setNatalDate(e.target.value)}
                className="cel-natal-input"
              />
              <input
                type="time"
                value={natalTime}
                onChange={e => setNatalTime(e.target.value)}
                className="cel-natal-input"
                placeholder="Birth time (optional)"
              />
              <input
                type="number"
                value={natalLat}
                onChange={e => setNatalLat(e.target.value)}
                className="cel-natal-input"
                placeholder="Latitude"
                step="0.01"
              />
              <input
                type="number"
                value={natalLng}
                onChange={e => setNatalLng(e.target.value)}
                className="cel-natal-input"
                placeholder="Longitude"
                step="0.01"
              />
            </div>
            <div className="cel-natal-actions">
              <button type="button" className="cel-btn cel-natal-compute" onClick={computeNatalChart}>
                Compute Chart
              </button>
              <button type="button" className="cel-btn cel-natal-play" onClick={playNatalChart} disabled={!natalMode}>
                Play Chart
              </button>
            </div>
          </div>
        </details>

        <div className="cel-info">
          <p>Tap planets to build your chord. Each voice has its own stereo position.</p>
          <p className="cel-chain">
            Fat saw &rarr; Saturation &rarr; Tape EQ &rarr; VHS wow
            <br />
            &rarr; Delay &rarr; Reverb &rarr; Monitor EQ &rarr; Limiter
          </p>
        </div>

        <div className="cel-footer">
          <p>v6 &middot; 12 voices &middot; 24kHz &middot; Per-planet stereo</p>
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
    padding: 2.5rem 1rem;
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
    text-align: center;
  }

  @keyframes cel-glow {
    0%, 100% { text-shadow: 0 0 30px rgba(180, 140, 255, 0.2); }
    50% { text-shadow: 0 0 50px rgba(180, 140, 255, 0.5), 0 0 80px rgba(140, 100, 220, 0.2); }
  }

  .cel-sub {
    font-size: 0.85rem;
    color: #8878a0;
    letter-spacing: 0.08em;
    margin-bottom: 2rem;
    text-align: center;
  }

  /* ── Planet toggle grid ──────────────────────────────── */

  .cel-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.6rem;
    max-width: 400px;
    width: 100%;
    margin-bottom: 1.2rem;
  }

  .cel-planet {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(180, 140, 255, 0.12);
    border-radius: 10px;
    color: #d8d0e8;
    padding: 0.7rem 0.5rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    width: auto;
    min-width: 0;
    transition: all 0.25s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .cel-planet:hover {
    background: rgba(180, 140, 255, 0.08);
    border-color: rgba(180, 140, 255, 0.3);
  }

  .cel-planet:active {
    transform: scale(0.95);
  }

  .cel-planet-active {
    background: rgba(180, 140, 255, 0.14);
    border-color: rgba(180, 140, 255, 0.55);
    box-shadow: 0 0 16px rgba(140, 100, 220, 0.3), inset 0 0 12px rgba(180, 140, 255, 0.06);
  }

  .cel-planet-active:hover {
    background: rgba(180, 140, 255, 0.2);
    border-color: rgba(180, 140, 255, 0.65);
  }

  .cel-planet-glyph {
    font-size: 1.3rem;
    color: #c4a0ff;
  }

  .cel-planet-active .cel-planet-glyph {
    color: #e0c8ff;
    text-shadow: 0 0 10px rgba(200, 160, 255, 0.6);
  }

  .cel-planet-name {
    font-weight: 600;
    font-size: 0.7rem;
    letter-spacing: 0.02em;
  }

  .cel-planet-note {
    font-size: 0.6rem;
    color: #8070a0;
  }

  .cel-planet-active .cel-planet-note {
    color: #b8a0d8;
  }

  .cel-planet-uncertain {
    opacity: 0.4;
  }

  /* ── Controls row (Shadow + Release) ─────────────────── */

  .cel-controls {
    display: flex;
    gap: 0.8rem;
    justify-content: center;
    margin-bottom: 1rem;
  }

  /* ── Base button ─────────────────────────────────────── */

  .cel-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(180, 140, 255, 0.15);
    border-radius: 10px;
    color: #d8d0e8;
    padding: 0.6rem 1.2rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    transition: all 0.3s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .cel-btn:hover:not(:disabled) {
    background: rgba(180, 140, 255, 0.1);
    border-color: rgba(180, 140, 255, 0.35);
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(140, 100, 220, 0.12);
  }

  .cel-btn:active:not(:disabled) {
    transform: translateY(0);
    background: rgba(180, 140, 255, 0.18);
  }

  .cel-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .cel-btn-glyph {
    font-size: 1.1rem;
    color: #c4a0ff;
  }

  .cel-btn-label {
    font-weight: 600;
    font-size: 0.85rem;
    letter-spacing: 0.03em;
  }

  /* ── Shadow button ───────────────────────────────────── */

  .cel-shadow-btn {
    border-color: rgba(255, 120, 60, 0.2);
    flex-direction: row;
    gap: 0.4rem;
    padding: 0.6rem 1.4rem;
  }

  .cel-shadow-btn:hover:not(:disabled) {
    background: rgba(255, 120, 60, 0.08);
    border-color: rgba(255, 120, 60, 0.35);
    box-shadow: none;
  }

  .cel-shadow-btn .cel-btn-glyph {
    color: #ff9060;
  }

  .cel-shadow-active {
    background: rgba(255, 80, 30, 0.16);
    border-color: rgba(255, 120, 60, 0.6);
    box-shadow: 0 0 16px rgba(255, 80, 30, 0.3), inset 0 0 12px rgba(255, 120, 60, 0.08);
    animation: cel-shadow-pulse 3s ease-in-out infinite;
  }

  .cel-shadow-active:hover:not(:disabled) {
    background: rgba(255, 80, 30, 0.24);
    border-color: rgba(255, 120, 60, 0.7);
  }

  .cel-shadow-active .cel-btn-glyph {
    color: #ffb080;
    text-shadow: 0 0 12px rgba(255, 100, 40, 0.7);
  }

  @keyframes cel-shadow-pulse {
    0%, 100% { box-shadow: 0 0 16px rgba(255, 80, 30, 0.3), inset 0 0 12px rgba(255, 120, 60, 0.08); }
    50% { box-shadow: 0 0 28px rgba(255, 80, 30, 0.5), inset 0 0 16px rgba(255, 120, 60, 0.12); }
  }

  /* ── Release button ──────────────────────────────────── */

  .cel-release-btn {
    border-color: rgba(255, 180, 140, 0.15);
    padding: 0.6rem 2rem;
  }

  .cel-release-btn:hover:not(:disabled) {
    background: rgba(255, 180, 140, 0.1);
    border-color: rgba(255, 180, 140, 0.35);
    box-shadow: none;
  }

  /* ── Listen preset pills ─────────────────────────────── */

  .cel-listen {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .cel-listen-pill {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(180, 140, 255, 0.12);
    border-radius: 20px;
    color: #8878a0;
    padding: 0.3rem 0.8rem;
    font-size: 0.7rem;
    cursor: pointer;
    transition: all 0.2s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .cel-listen-pill:hover {
    background: rgba(180, 140, 255, 0.08);
    color: #d8d0e8;
  }

  .cel-listen-active {
    background: rgba(180, 140, 255, 0.14);
    border-color: rgba(180, 140, 255, 0.5);
    color: #e0c8ff;
  }

  /* ── Natal chart section ─────────────────────────────── */

  .cel-natal {
    max-width: 400px;
    width: 100%;
    margin-bottom: 1.5rem;
  }

  .cel-natal-summary {
    cursor: pointer;
    color: #8878a0;
    font-size: 0.85rem;
    text-align: center;
    padding: 0.5rem;
    letter-spacing: 0.05em;
    list-style: none;
  }

  .cel-natal-summary::-webkit-details-marker { display: none; }

  .cel-natal-body {
    padding: 0.8rem 0;
  }

  .cel-natal-inputs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-bottom: 0.8rem;
  }

  .cel-natal-input {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(180, 140, 255, 0.15);
    border-radius: 8px;
    color: #d8d0e8;
    padding: 0.5rem;
    font-size: 0.8rem;
    font-family: inherit;
    width: 100%;
  }

  .cel-natal-input::placeholder { color: #504868; }

  .cel-natal-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
  }

  .cel-natal-compute {
    border-color: rgba(180, 140, 255, 0.25);
  }

  .cel-natal-play {
    border-color: rgba(180, 140, 255, 0.15);
  }

  /* ── Info / footer ───────────────────────────────────── */

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
    margin-top: 2.5rem;
    max-width: 500px;
    text-align: center;
    font-size: 0.7rem;
    color: #3a3050;
    line-height: 1.6;
  }
`;
