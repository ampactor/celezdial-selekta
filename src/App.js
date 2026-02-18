// ═══════════════════════════════════════════════════════════════
// CELESTIAL PAD v8 — Soft Clip · SVG Knobs · Full Control
//
// ─── ARCHITECTURE OVERVIEW ──────────────────────────────────
//
// 12 Tone.PolySynth instances (3 voices each), one per planet. Each:
//   PolySynth (3× fat oscillator, ADSR envelope)
//     → Panner (fixed stereo base + LFO drift per pan group)
//       → sumBus (Gain node — all voices merge here)
//
// The sumBus feeds a serial FX chain ending at destination.
// Voices summing BEFORE saturation is intentional — Chebyshev
// waveshaping on a polyphonic sum creates intermodulation
// distortion (sum/difference tones between partials). This is
// what gives the pad its FM-like shimmer and harmonic density.
//
// ─── FX CHAIN (configurable — see CHAIN CONFIGS below) ──────
//
// Current default: "Cathedral" (Config A)
//   sumBus → Chebyshev → EQ3 → Vibrato → FeedbackDelay
//     → Freeverb → MonitorEQ → tanh soft clip → destination
//
// Each FX node's role:
//   Chebyshev    — Polynomial waveshaper. Generates harmonics from
//                  the summed signal. Order N adds Nth harmonic.
//                  Wet controls dry/saturated blend. At 1.0 (default),
//                  full saturation — maximum intermodulation.
//   EQ3          — 3-band "tape" EQ. High rolled off (-24dB default)
//                  simulates tape head frequency response. Shapes
//                  the saturated signal before time-domain effects.
//   Vibrato      — Slow LFO pitch modulation on the full mix.
//                  Simulates VHS tape wow/flutter. Low rate (0.25Hz)
//                  + moderate depth = seasick drift, not chorus.
//   FeedbackDelay— Single-tap delay with feedback. Placed after
//                  vibrato so echoes inherit the pitch drift.
//   Freeverb     — Schroeder reverb (parallel comb filters + series
//                  allpass). Comb-filter resonances interact with
//                  Chebyshev harmonics — metallic shimmer emerges.
//                  NOT convolution — the resonances are the point.
//   MonitorEQ    — 3-band output EQ for listening environment
//                  compensation. Presets: HP, Laptop, Phone, Speaker.
//   Soft clip    — tanh waveshaper as final limiter. Preserves
//                  Freeverb resonant peaks that Limiter(-1) killed.
//                  4x oversampled to reduce aliasing at clipping.
//
// ─── STATE MODEL ────────────────────────────────────────────
//
// engineRef      — Tone.js audio graph, created on first interaction.
//                  Null until user clicks (browser autoplay policy).
// activePlanets  — Set<string> of currently sounding planet names.
// knobs          — Object mirroring all knob positions. Authoritative
//                  source of truth for non-Shadow parameter values.
//                  Shadow mode temporarily overrides FX params; when
//                  Shadow disengages, knob values are restored.
// oscIndex       — Current position in OSC_TYPES cycle. Breathe
//                  button advances this (hidden osc type switcher).
// shadow         — Boolean. Shadow/Eclipse mode active. Ramps FX
//                  params toward chaos targets over rampTime seconds.
//
// ─── CONTROLS ───────────────────────────────────────────────
//
// Piano keyboard — Toggle individual planet voices on/off.
// Eclipse        — Chaos mode. Ramps all FX toward extreme values,
//                  widens osc spread, randomizes detune. Toggle off
//                  restores knob values.
// Breathe        — Easter egg: cycles oscillator type across all
//                  voices (saw → sine → tri → square). If voices
//                  are active, releases them first, then switches.
//                  Label always says "Breathe" — the osc change
//                  is discoverable, not advertised.
// Listen pills   — Monitor EQ presets for different playback devices.
// Knobs          — 19 SVG arc knobs, drag-to-adjust. Double-click
//                  resets to default. Shift+drag for fine control.
// Natal Chart    — Enter birth data, compute planetary positions via
//                  circular-natal-horoscope-js, remap voice pitches
//                  to zodiac-derived notes.
//
// ═══════════════════════════════════════════════════════════════

import React, { useRef, useState, useCallback, useEffect } from "react";
import * as Tone from "tone";
import { Origin, Horoscope } from "circular-natal-horoscope-js";

// ─── Font Constants ───────────────────────────────────────────
// "'Rudelsberg', serif"
// "'Rudelsberg Alternate', serif"
// "'Rudelsberg Titel', serif"
// "'Rudelsberg Initialen', serif"
// "'Rudelsberg Schmuck', serif"
// "'Rudelsberg Plakatschrift', serif"
// "'Spiral ST', serif"
// "'Gerakent', serif"
// "'Xagetif', serif"
// "'Gesego', serif"
// "'Salty Mussy', serif"
// "'Ruigslay', serif"
// "'Soiglat', serif"
const FONTS = {
  "title": "'Spiral ST', serif",
  body: "system-ui, -apple-system, sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
};

// 12 planets — chromatic mapping C through B.
// Each carries: note class, microtonal detune from 12-TET (cents),
// octave, velocity (mix weight), glyph, fixed stereo base,
// pan group, osc count, osc spread.
const PLANETS = {
  Pluto:     { octave: 2, vel: 0.7, glyph: "\u2647", note: "C",  detuneCents: 0, panBase: -0.62, panGroup: "A", oscCount: 3, oscSpread: 55 },
  Neptune:   { octave: 2, vel: 0.6, glyph: "\u2646", note: "Db", detuneCents: 0, panBase:  0.46, panGroup: "D", oscCount: 3, oscSpread: 40 },
  Jupiter:   { octave: 2, vel: 0.8, glyph: "\u2643", note: "D",  detuneCents: 0, panBase: -0.85, panGroup: "A", oscCount: 3, oscSpread: 55 },
  Uranus:    { octave: 3, vel: 0.5, glyph: "\u2645", note: "Eb", detuneCents: 0, panBase:  0.72, panGroup: "D", oscCount: 3, oscSpread: 40 },
  Saturn:    { octave: 3, vel: 0.6, glyph: "\u2644", note: "E",  detuneCents: 0, panBase: -0.15, panGroup: "B", oscCount: 3, oscSpread: 45 },
  Chiron:    { octave: 3, vel: 0.4, glyph: "\u26B7", note: "F",  detuneCents: 0, panBase:  0.62, panGroup: "D", oscCount: 3, oscSpread: 40 },
  Mars:      { octave: 4, vel: 0.7, glyph: "\u2642", note: "Gb", detuneCents: 0, panBase: -0.38, panGroup: "B", oscCount: 3, oscSpread: 50 },
  Sun:       { octave: 4, vel: 1.0, glyph: "\u2609", note: "G",  detuneCents: 0, panBase:  0.15, panGroup: "C", oscCount: 3, oscSpread: 45 },
  Venus:     { octave: 4, vel: 0.5, glyph: "\u2640", note: "Ab", detuneCents: 0, panBase:  0.38, panGroup: "C", oscCount: 3, oscSpread: 45 },
  Ascendant: { octave: 4, vel: 0.6, glyph: "AC",     note: "A",  detuneCents: 0, panBase:  0.0,  panGroup: "C", oscCount: 3, oscSpread: 45 },
  Mercury:   { octave: 5, vel: 0.5, glyph: "\u263F", note: "Bb", detuneCents: 0, panBase:  0.08, panGroup: "D", oscCount: 3, oscSpread: 40 },
  Moon:      { octave: 5, vel: 0.4, glyph: "\u263D", note: "B",  detuneCents: 0, panBase: -0.23, panGroup: "A", oscCount: 3, oscSpread: 40 },
};

const KEYBOARD_ORDER = Object.keys(PLANETS);
const SHARP_INDICES = new Set([1, 3, 6, 8, 10]);
const SHARP_POSITIONS = ["10%", "24%", "53%", "67%", "81%"];
// Oscillator types cycled by Breathe button (easter egg).
// "fat" variants use multiple detuned oscillators per voice — count/spread
// set per planet in PLANETS config. Saw is default (richest harmonics for
// Chebyshev intermodulation). Sine is purest. Tri is warm. Square is hollow.
const OSC_TYPES = ["fatsawtooth", "fatsine", "fattriangle", "fatsquare"];

// ─── Tuning Constants ────────────────────────────────────────
const TUNING = {
  sampleRate: 24000,
  // Envelope (bloom)
  attack: 1.5,
  decay: 3.5,
  sustain: 0.2,
  release: 5.0,
  // Chebyshev saturation
  chebyOrder: 3,
  chebyWet: 1.0,
  // Tape EQ
  eqHigh: -6,
  eqMid: 3,
  eqLow: 3,
  eqHighFreq: 3000,
  // VHS wow (vibrato)
  vibratoFreq: 0.25,
  vibratoDepth: 0.28,
  vibratoWet: 0.8,
  // Delay cascade
  delayTime: 0.6,
  delayFeedback: 0.68,
  delayWet: 0.5,
  // Algorithmic reverb (Freeverb — comb-filter resonances)
  reverbRoom: 0.95,
  reverbDamp: 1500,
  reverbWet: 0.97,
  // Damp sweep — LFO on reverb dampening for auto comb-filter morphing
  dampSweepRate: 0.08,
  dampSweepDepth: 0.0,
  // Per-voice panning LFOs
  panLfoFreq: 0.05,
  panLfoAmplitude: 0.12,
  // Monitor EQ crossover freqs
  monitorLowFreq: 400,
  monitorHighFreq: 2500,
  // Stagger / retrigger
  stagger: 0.45,
  retriggerGap: 80,
  // Phaser — sweeping allpass comb filters
  phaserFreq: 0.3,
  phaserOctaves: 3,
  phaserBase: 350,
  phaserQ: 10,
  phaserWet: 0.0,
  // Distortion — waveshaping saturator (stacks with Chebyshev)
  distortion: 0.4,
  distortionWet: 0.0,
  // Shadow mode chaos targets
  shadow: {
    reverbWet: 1.0,
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

// Circle-of-fifths mapping: Aries=C (spring/tonal center), sharps accumulate
// through spring/summer, flats through fall/winter. Libra lands on Gb
// (equidistant in sharps/flats — mirrors Libra's balance).
const ZODIAC_NOTES = {
  aries: "C", taurus: "G", gemini: "D", cancer: "A",
  leo: "E", virgo: "B", libra: "Gb", scorpio: "Db",
  sagittarius: "Ab", capricorn: "Eb", aquarius: "Bb", pisces: "F",
};

const LISTEN_PRESETS = {
  headphones:  { low: -2, mid: 0,  high: 1,  label: "HP" },
  laptop:      { low: 6,  mid: 2,  high: 3,  label: "Laptop" },
  phone:       { low: 4,  mid: 3,  high: 2,  label: "Phone" },
  loudspeaker: { low: 3,  mid: -2, high: 0,  label: "Speaker" },
};

// ─── Scaling Helpers ─────────────────────────────────────────
const logScale = (min, max) => ({
  mapFromNorm: n => min * Math.pow(max / min, n),
  mapToNorm: v => Math.log(v / min) / Math.log(max / min),
});
const linearScale = (min, max) => ({
  mapFromNorm: n => min + n * (max - min),
  mapToNorm: v => (v - min) / (max - min),
});

// ─── Knob Mapping ────────────────────────────────────────────

const KNOB_MAP = {
  // Voice
  attack:       { apply: (eng, v) => { Object.values(eng.synths).forEach(s => { s.set({ envelope: { attack: v } }); }); } },
  decay:        { apply: (eng, v) => { Object.values(eng.synths).forEach(s => { s.set({ envelope: { decay: v } }); }); } },
  sustain:      { apply: (eng, v) => { Object.values(eng.synths).forEach(s => { s.set({ envelope: { sustain: v } }); }); } },
  release:      { apply: (eng, v) => { Object.values(eng.synths).forEach(s => { s.set({ envelope: { release: v } }); }); } },
  // Grit
  gritDrive:    { apply: (eng, v) => { eng.fx.chebyshev.wet.value = v; } },
  chebyOrder:   { apply: (eng, v) => { eng.fx.chebyshev.order = v; } },
  // Tape
  eqHigh:       { apply: (eng, v) => { eng.fx.eq3.high.value = v; } },
  eqMid:        { apply: (eng, v) => { eng.fx.eq3.mid.value = v; } },
  eqLow:        { apply: (eng, v) => { eng.fx.eq3.low.value = v; } },
  // Wobble
  wobbleRate:   { apply: (eng, v) => { eng.fx.vibrato.frequency.value = v; } },
  wobbleDepth:  { apply: (eng, v) => { eng.fx.vibrato.depth.value = v; } },
  wobbleMix:    { apply: (eng, v) => { eng.fx.vibrato.wet.value = v; } },
  // Echo
  echoTime:     { apply: (eng, v) => { eng.fx.feedbackDelay.delayTime.value = v; } },
  echoFeedback: { apply: (eng, v) => { eng.fx.feedbackDelay.feedback.value = v; } },
  echoMix:      { apply: (eng, v) => { eng.fx.feedbackDelay.wet.value = v; } },
  // Reverb
  reverbRoom:   { apply: (eng, v) => { eng.fx.reverb.roomSize.value = v; } },
  reverbDamp:   { apply: (eng, v) => { eng.fx.reverb.dampening = v; eng.fx.dampSweep.center = v; } },
  reverbMix:    { apply: (eng, v) => { eng.fx.reverb.wet.value = v; } },
  dampSweepRate:  { apply: (eng, v) => { eng.fx.dampSweep.rate = v; } },
  dampSweepDepth: { apply: (eng, v) => { eng.fx.dampSweep.depth = v; } },
  // Space
  panDrift:     { apply: (eng, v) => { Object.values(eng.panLfos).forEach(l => { l.frequency.value = v; }); } },
  panWidth:     { apply: (eng, v) => { Object.values(eng.panLfos).forEach(l => { l.amplitude.value = v; }); } },
  // Phase
  phaserFreq:   { apply: (eng, v) => { eng.fx.phaser.frequency.value = v; } },
  phaserOctaves:{ apply: (eng, v) => { eng.fx.phaser.octaves = v; } },
  phaserBase:   { apply: (eng, v) => { eng.fx.phaser.baseFrequency = v; } },
  phaserQ:      { apply: (eng, v) => { eng.fx.phaser.Q.value = v; } },
  phaserMix:    { apply: (eng, v) => { eng.fx.phaser.wet.value = v; } },
  // Saturate
  satDrive:     { apply: (eng, v) => { eng.fx.distortion.distortion = v; } },
  satMix:       { apply: (eng, v) => { eng.fx.distortion.wet.value = v; } },
};

// ─── SVG Arc Knob Component ──────────────────────────────────

function Knob({ label, value, defaultValue, min, max, format, onChange, mapToNorm, mapFromNorm }) {
  const dragRef = useRef(null);
  const size = 56;
  const cx = size / 2;
  const cy = size / 2;
  const r = 22;
  const startAngle = -135;
  const endAngle = 135;
  const sweep = endAngle - startAngle; // 270°

  const norm = mapToNorm ? mapToNorm(value) : (value - min) / (max - min);
  const clampedNorm = Math.max(0, Math.min(1, norm));
  const valueAngle = startAngle + clampedNorm * sweep;

  const degToRad = d => (d * Math.PI) / 180;
  const arcPoint = (angle) => ({
    x: cx + r * Math.cos(degToRad(angle - 90)),
    y: cy + r * Math.sin(degToRad(angle - 90)),
  });

  const describeArc = (start, end) => {
    const s = arcPoint(start);
    const e = arcPoint(end);
    const large = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const trackPath = describeArc(startAngle, endAngle);
  const valuePath = clampedNorm > 0.003 ? describeArc(startAngle, valueAngle) : "";
  const pointer = arcPoint(valueAngle);

  const onPointerDown = useCallback((e) => {
    e.target.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startNorm: clampedNorm };
  }, [clampedNorm]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const sensitivity = e.shiftKey ? 0.0005 : 0.003;
    const dy = dragRef.current.startY - e.clientY;
    const newNorm = Math.max(0, Math.min(1, dragRef.current.startNorm + dy * sensitivity));
    const newValue = mapFromNorm ? mapFromNorm(newNorm) : min + newNorm * (max - min);
    onChange(newValue);
  }, [min, max, onChange, mapFromNorm]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onDoubleClick = useCallback(() => {
    onChange(defaultValue);
  }, [defaultValue, onChange]);

  return (
    <div className="cel-knob">
      <span className="cel-knob-label">{label}</span>
      <svg
        width={size} height={size}
        className="cel-knob-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <path d={trackPath} fill="none" stroke="rgba(180,140,255,0.15)" strokeWidth="3" strokeLinecap="round" />
        {valuePath && <path d={valuePath} fill="none" stroke="#9070cc" strokeWidth="3" strokeLinecap="round" />}
        <circle cx={pointer.x} cy={pointer.y} r="4" fill="#b490e8" />
        <circle cx={cx} cy={cy} r="6" fill="rgba(180,140,255,0.08)" stroke="rgba(180,140,255,0.2)" strokeWidth="1" />
      </svg>
      <span className="cel-knob-value">{format ? format(value) : value}</span>
    </div>
  );
}

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

  const reverb = new Tone.Freeverb({
    roomSize: TUNING.reverbRoom,
    dampening: TUNING.reverbDamp,
  });
  reverb.wet.value = TUNING.reverbWet;

  // Damp sweep — sinusoidal modulation of reverb dampening.
  // Sweeps the comb filter cutoff for evolving resonance morphing.
  // depth=0 disables. At depth=1, sweeps full range around center.
  const dampSweep = {
    rate: TUNING.dampSweepRate,
    depth: TUNING.dampSweepDepth,
    center: TUNING.reverbDamp,
    _phase: 0,
    _interval: null,
    start() {
      if (this._interval) clearInterval(this._interval);
      const tickMs = 50;
      this._interval = setInterval(() => {
        if (this.depth <= 0) return;
        this._phase += (2 * Math.PI * this.rate * tickMs) / 1000;
        if (this._phase > 2 * Math.PI) this._phase -= 2 * Math.PI;
        const mod = Math.sin(this._phase);
        // Sweep between 200 and 8000 (log scale) around center
        const logCenter = Math.log(this.center);
        const logRange = this.depth * 2.5;
        const val = Math.exp(logCenter + mod * logRange);
        reverb.dampening = Math.max(200, Math.min(8000, val));
      }, tickMs);
    },
    stop() {
      if (this._interval) { clearInterval(this._interval); this._interval = null; }
    },
  };
  dampSweep.start();

  const monitorEQ = new Tone.EQ3({
    low: 0,
    mid: 0,
    high: 0,
    lowFrequency: TUNING.monitorLowFreq,
    highFrequency: TUNING.monitorHighFreq,
  });

  const phaser = new Tone.Phaser({
    frequency: TUNING.phaserFreq,
    octaves: TUNING.phaserOctaves,
    baseFrequency: TUNING.phaserBase,
    Q: TUNING.phaserQ,
  });
  phaser.wet.value = TUNING.phaserWet;

  const distortion = new Tone.Distortion({
    distortion: TUNING.distortion,
    oversample: "4x",
  });
  distortion.wet.value = TUNING.distortionWet;

  // tanh soft clip — preserves Freeverb resonant peaks that Limiter(-1) killed
  const softClip = new Tone.WaveShaper((val) => Math.tanh(val), 4096);
  softClip.oversample = "4x";

  // Summing bus — all panners feed here so voices intermodulate through Chebyshev
  const sumBus = new Tone.Gain(1);

  // ─── CHAIN CONFIGS ─────────────────────────────────────────
  // Uncomment ONE config block below. Comment out all others.
  // Each config changes the FX ordering, which dramatically
  // changes the sonic character. All use the same FX nodes —
  // only the wiring differs.
  //
  // Phaser + Distortion are inline in every config. They start
  // at wet=0 (bypassed) — turn up their Mix knobs to activate.
  // Distortion sits after Chebyshev (stacked saturation).
  // Phaser sits after reverb (phase-shifts the washed signal).
  //
  // After switching, all knobs still work (they target nodes
  // directly, not chain position). Shadow mode also still works.

  // CONFIG A: "Cathedral" (default)
  // Saturation first — harmonics feed into space effects.
  // Chebyshev intermodulation colors everything downstream.
  // Signal: sum → cheby → dist → eq → vibrato → delay → reverb → phaser → monEQ → clip
  // sumBus.connect(chebyshev);
  // chebyshev.chain(distortion, eq3, vibrato, feedbackDelay, reverb, phaser, monitorEQ, softClip);
  // softClip.toDestination();

  // CONFIG B: "Void"
  // Reverb before delay — delay repeats the already-reverbed
  // signal, creating infinite receding echoes. More diffuse.
  // Signal: sum → cheby → dist → eq → vibrato → reverb → phaser → delay → monEQ → clip
  // sumBus.connect(chebyshev);
  // chebyshev.chain(distortion, eq3, vibrato, reverb, phaser, feedbackDelay, monitorEQ, softClip);
  // softClip.toDestination();

  // CONFIG C: "Furnace"
  // Delay before saturation — clean echoes get waveshaped
  // together with the dry signal. Progressively dirtier.
  // Signal: sum → delay → cheby → dist → eq → vibrato → reverb → phaser → monEQ → clip
  // sumBus.connect(feedbackDelay);
  // feedbackDelay.chain(chebyshev, distortion, eq3, vibrato, reverb, phaser, monitorEQ, softClip);
  // softClip.toDestination();

  // CONFIG D: "Tape"
  // Vibrato (wow/flutter) applied first — pitch drift feeds
  // into saturation, creating time-varying harmonic content.
  // Signal: sum → vibrato → cheby → dist → eq → delay → reverb → phaser → monEQ → clip
  // sumBus.connect(vibrato);
  // vibrato.chain(chebyshev, distortion, eq3, feedbackDelay, reverb, phaser, monitorEQ, softClip);
  // softClip.toDestination();

  // CONFIG F: "Evolve"
  // Space effects BEFORE saturation — reverb/delay tails feed
  // into Chebyshev, generating new harmonics as they decay.
  // The spectral content evolves over time because Chebyshev's
  // nonlinearity responds differently at different input levels.
  // Phaser adds moving comb-filter interference before saturation,
  // creating shifting cancellation nodes that Chebyshev turns into
  // new partials. Maximum harmonic evolution + textural density.
  // Signal: sum → vibrato → delay → reverb → phaser → cheby → dist → eq → monEQ → clip
  sumBus.connect(vibrato);
  vibrato.chain(feedbackDelay, reverb, phaser, chebyshev, distortion, eq3, monitorEQ, softClip);
  softClip.toDestination();

  // CONFIG E: "Glass"
  // No saturation — Chebyshev + Distortion bypassed.
  // Clean voices through EQ, vibrato, delay, reverb. Fragile.
  // Signal: sum → eq → vibrato → delay → reverb → phaser → monEQ → clip
  // sumBus.connect(eq3);
  // eq3.chain(vibrato, feedbackDelay, reverb, phaser, monitorEQ, softClip);
  // softClip.toDestination();

  // ─── Per-planet synths + panners ──────────────────────────

  const synths = {};
  const panners = {};
  const spreadTracker = {};

  Object.entries(PLANETS).forEach(([name, cfg]) => {
    const panner = new Tone.Panner(cfg.panBase);
    const synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 3,
      voice: Tone.Synth,
      options: {
        oscillator: { type: "fatsawtooth", count: cfg.oscCount, spread: cfg.oscSpread },
        envelope: {
          attack: TUNING.attack,
          decay: TUNING.decay,
          sustain: TUNING.sustain,
          release: TUNING.release,
        },
        volume: -12,
      },
    });
    synth.set({ detune: cfg.detuneCents });
    synth.connect(panner);
    panner.connect(sumBus);
    synths[name] = synth;
    panners[name] = panner;
    spreadTracker[name] = cfg.oscSpread;
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
    spreadTracker,
    fx: { reverb, feedbackDelay, vibrato, chebyshev, eq3, monitorEQ, phaser, distortion, dampSweep },
    dispose() {
      dampSweep.stop();
      Object.values(synths).forEach(s => s.dispose());
      Object.values(panners).forEach(p => p.dispose());
      Object.values(panLfos).forEach(l => l.dispose());
      [sumBus, chebyshev, distortion, eq3, vibrato, feedbackDelay, reverb, phaser, monitorEQ, softClip].forEach(n => n.dispose());
    },
  };
}

// ─── Component ───────────────────────────────────────────────

export default function App() {
  const engineRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [activePlanets, setActivePlanets] = useState(new Set());
  const [shadow, setShadow] = useState(false);
  const [oscIndex, setOscIndex] = useState(0);
  const [listenPreset, setListenPreset] = useState("headphones");
  const shadowIntervalsRef = useRef([]);
  const [natalMode, setNatalMode] = useState(false);
  const [natalDate, setNatalDate] = useState("");
  const [natalTime, setNatalTime] = useState("");
  const [natalLat, setNatalLat] = useState("");
  const [natalLng, setNatalLng] = useState("");
  const [natalNotes, setNatalNotes] = useState({});
  const [knobs, setKnobs] = useState({
    attack: TUNING.attack,
    decay: TUNING.decay,
    sustain: TUNING.sustain,
    release: TUNING.release,
    gritDrive: TUNING.chebyWet,
    chebyOrder: TUNING.chebyOrder,
    eqHigh: TUNING.eqHigh,
    eqMid: TUNING.eqMid,
    eqLow: TUNING.eqLow,
    wobbleRate: TUNING.vibratoFreq,
    wobbleDepth: TUNING.vibratoDepth,
    wobbleMix: TUNING.vibratoWet,
    echoTime: TUNING.delayTime,
    echoFeedback: TUNING.delayFeedback,
    echoMix: TUNING.delayWet,
    reverbRoom: TUNING.reverbRoom,
    reverbDamp: TUNING.reverbDamp,
    reverbMix: TUNING.reverbWet,
    panDrift: TUNING.panLfoFreq,
    panWidth: TUNING.panLfoAmplitude,
    phaserFreq: TUNING.phaserFreq,
    phaserOctaves: TUNING.phaserOctaves,
    phaserBase: TUNING.phaserBase,
    phaserQ: TUNING.phaserQ,
    phaserMix: TUNING.phaserWet,
    satDrive: TUNING.distortion,
    satMix: TUNING.distortionWet,
    dampSweepRate: TUNING.dampSweepRate,
    dampSweepDepth: TUNING.dampSweepDepth,
  });

  const setKnob = useCallback((key, value) => {
    setKnobs(prev => ({ ...prev, [key]: value }));
    const eng = engineRef.current;
    if (eng) KNOB_MAP[key]?.apply(eng, value);
  }, []);

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
        eng.synths[planet].triggerRelease(note, Tone.now());
        next.delete(planet);
      } else {
        eng.synths[planet].triggerAttack(note, Tone.now(), cfg.vel);
        next.add(planet);
      }
      setStatus(next.size > 0 ? "playing" : "ready");
      return next;
    });
  }, [ensureEngine, natalMode, natalNotes]);

  const breathe = useCallback(async () => {
    const eng = await ensureEngine();
    if (activePlanets.size > 0) {
      Object.values(eng.synths).forEach(s => s.releaseAll(Tone.now()));
      setActivePlanets(new Set());
      setStatus("ready");
    }
    if (shadow) {
      const { reverb, feedbackDelay, vibrato, chebyshev } = eng.fx;
      const rt = TUNING.shadow.rampTime;
      shadowIntervalsRef.current.forEach(id => clearInterval(id));
      shadowIntervalsRef.current = [];
      reverb.wet.rampTo(knobs.reverbMix, rt);
      feedbackDelay.feedback.rampTo(knobs.echoFeedback, rt);
      feedbackDelay.wet.rampTo(knobs.echoMix, rt);
      vibrato.depth.rampTo(knobs.wobbleDepth, rt);
      vibrato.frequency.rampTo(knobs.wobbleRate, rt);
      chebyshev.wet.rampTo(knobs.gritDrive, rt);
      Object.values(eng.panLfos).forEach(lfo => {
        lfo.frequency.rampTo(knobs.panDrift, rt);
        lfo.amplitude.rampTo(knobs.panWidth, rt);
      });
      Object.entries(eng.synths).forEach(([name, synth]) => {
        synth.set({ oscillator: { spread: PLANETS[name].oscSpread } });
        synth.set({ detune: PLANETS[name].detuneCents });
        eng.spreadTracker[name] = PLANETS[name].oscSpread;
      });
      setShadow(false);
    }
    const next = (oscIndex + 1) % OSC_TYPES.length;
    const type = OSC_TYPES[next];
    Object.values(eng.synths).forEach(s => { s.set({ oscillator: { type } }); });
    setOscIndex(next);
  }, [activePlanets, ensureEngine, oscIndex, shadow, knobs]);

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
          const current = eng.spreadTracker[name];
          if (current < st.oscSpread) {
            const next = Math.min(current + 3, st.oscSpread);
            eng.spreadTracker[name] = next;
            synth.set({ oscillator: { spread: next } });
          }
        });
      }, 60);

      const detuneId = setInterval(() => {
        Object.entries(eng.synths).forEach(([name, synth]) => {
          const base = PLANETS[name]?.detuneCents || 0;
          const target = base + (Math.random() * 2 - 1) * st.detuneRange;
          synth.set({ detune: target });
        });
      }, 800);

      shadowIntervalsRef.current = [spreadId, detuneId];
    } else {
      shadowIntervalsRef.current.forEach(id => clearInterval(id));
      shadowIntervalsRef.current = [];

      const rt = st.rampTime;
      // All ramps use knob values — knobs are authoritative for non-shadow state
      reverb.wet.rampTo(knobs.reverbMix, rt);
      feedbackDelay.feedback.rampTo(knobs.echoFeedback, rt);
      feedbackDelay.wet.rampTo(knobs.echoMix, rt);
      vibrato.depth.rampTo(knobs.wobbleDepth, rt);
      vibrato.frequency.rampTo(knobs.wobbleRate, rt);
      chebyshev.wet.rampTo(knobs.gritDrive, rt);

      Object.values(eng.panLfos).forEach(lfo => {
        lfo.frequency.rampTo(knobs.panDrift, rt);
        lfo.amplitude.rampTo(knobs.panWidth, rt);
      });

      Object.entries(eng.synths).forEach(([name, synth]) => {
        synth.set({ oscillator: { spread: PLANETS[name].oscSpread } });
        synth.set({ detune: PLANETS[name].detuneCents });
        eng.spreadTracker[name] = PLANETS[name].oscSpread;
      });
    }
    setShadow(s => !s);
  }, [shadow, knobs, ensureEngine]);

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

    Object.values(eng.synths).forEach(s => s.releaseAll(Tone.now()));

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

  // Shared scale instances
  const logAttack = logScale(0.01, 8);
  const logDecay = logScale(0.1, 8);
  const logRelease = logScale(0.1, 10);
  const logWobbleRate = logScale(0.01, 2);
  const logEchoTime = logScale(0.05, 1.5);
  const logReverbDamp = logScale(200, 8000);
  const logPanDrift = logScale(0.01, 0.5);
  const linSustain = linearScale(0, 1);
  const linDrive = linearScale(0, 1);
  const linEqHigh = linearScale(-24, 12);
  const linEqMid = linearScale(-12, 12);
  const linEqLow = linearScale(-12, 12);
  const linWobbleDepth = linearScale(0, 1);
  const linWobbleMix = linearScale(0, 1);
  const linEchoFb = linearScale(0, 0.95);
  const linEchoMix = linearScale(0, 1);
  const linReverbRoom = linearScale(0.3, 1.0);
  const linReverbMix = linearScale(0, 1);
  const linPanWidth = linearScale(0, 1);
  const logPhaserFreq = logScale(0.05, 8);
  const linPhaserOct = linearScale(1, 6);
  const logPhaserBase = logScale(100, 4000);
  const linPhaserMix = linearScale(0, 1);
  const linSatDrive = linearScale(0, 1);
  const linSatMix = linearScale(0, 1);
  const logDampSweepRate = logScale(0.01, 1);
  const linDampSweepDepth = linearScale(0, 1);

  // Chebyshev order: odd only 1–11
  const chebyFromNorm = n => {
    const idx = Math.round(n * 5);
    return 1 + idx * 2; // 1,3,5,7,9,11
  };
  const chebyToNorm = v => ((v - 1) / 2) / 5;

  return (
    <>
      <style>{CSS}</style>
      <div className="cel-root">
          <p className="cel-matrix">.</p>
          <p className="cel-matrix">. .</p>
          <p className="cel-matrix">. . .</p>
       <p className="cel-sub">. . . s p a c e d o u t . . .</p>
        <div className="cel-keyboard">
          {KEYBOARD_ORDER.filter((_, i) => !SHARP_INDICES.has(i)).map(planet => {
            const cfg = PLANETS[planet];
            const active = activePlanets.has(planet);
            const isUncertain = planet === "Ascendant" && natalMode && !natalTime;
            return (
              <button
                key={planet}
                type="button"
                className={`cel-key cel-key-natural${active ? " cel-key-active" : ""}${isUncertain ? " cel-key-uncertain" : ""}`}
                onClick={() => togglePlanet(planet)}
              >
                <span className="cel-key-glyph">{cfg.glyph}</span>
                <span className="cel-key-name">{planet}</span>
                <span className="cel-key-note">
                  {natalMode && natalNotes[planet] ? natalNotes[planet] : `${cfg.note}${cfg.octave}`}
                </span>
              </button>
            );
          })}
          {KEYBOARD_ORDER.filter((_, i) => SHARP_INDICES.has(i)).map((planet, i) => {
            const cfg = PLANETS[planet];
            const active = activePlanets.has(planet);
            const isUncertain = planet === "Ascendant" && natalMode && !natalTime;
            return (
              <button
                key={planet}
                type="button"
                className={`cel-key cel-key-sharp${active ? " cel-key-active" : ""}${isUncertain ? " cel-key-uncertain" : ""}`}
                style={{ left: SHARP_POSITIONS[i] }}
                onClick={() => togglePlanet(planet)}
              >
                <span className="cel-key-glyph">{cfg.glyph}</span>
                <span className="cel-key-name">{planet}</span>
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
            <span className="cel-btn-label">Eclipse</span>
          </button>
          <button
            type="button"
            className="cel-btn cel-breathe-btn"
            onClick={breathe}
          >
            <span className="cel-btn-label">Breathe</span>
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

        <details className="cel-within">
          <summary className="cel-within-summary">. . . w i t h i n . . .</summary>
        <div className="cel-knobs-all">
          <p className="cel-matrix">. . .</p>
          <p className="cel-matrix">. .</p>
          <p className="cel-matrix">.</p>
          <h1 className="cel-title">selezdial selekta</h1>
          <div className="cel-knob-section">
            <span className="cel-section-label">Voice</span>
            <div className="cel-knob-row">
              <Knob label="Attack" value={knobs.attack} defaultValue={TUNING.attack}
                min={0.01} max={8} format={v => `${v.toFixed(1)}s`}
                {...logAttack} onChange={v => setKnob("attack", v)} />
              <Knob label="Decay" value={knobs.decay} defaultValue={TUNING.decay}
                min={0.1} max={8} format={v => `${v.toFixed(1)}s`}
                {...logDecay} onChange={v => setKnob("decay", v)} />
              <Knob label="Sustain" value={knobs.sustain} defaultValue={TUNING.sustain}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linSustain} onChange={v => setKnob("sustain", v)} />
              <Knob label="Release" value={knobs.release} defaultValue={TUNING.release}
                min={0.1} max={10} format={v => `${v.toFixed(1)}s`}
                {...logRelease} onChange={v => setKnob("release", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Grit</span>
            <div className="cel-knob-row">
              <Knob label="Drive" value={knobs.gritDrive} defaultValue={TUNING.chebyWet}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linDrive} onChange={v => setKnob("gritDrive", v)} />
              <Knob label="Order" value={knobs.chebyOrder} defaultValue={TUNING.chebyOrder}
                min={1} max={11} format={v => `${v}${v === 1 ? "st" : v === 3 ? "rd" : "th"}`}
                mapFromNorm={chebyFromNorm} mapToNorm={chebyToNorm}
                onChange={v => setKnob("chebyOrder", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Tape</span>
            <div className="cel-knob-row">
              <Knob label="High" value={knobs.eqHigh} defaultValue={TUNING.eqHigh}
                min={-24} max={12} format={v => `${v > 0 ? "+" : ""}${Math.round(v)}dB`}
                {...linEqHigh} onChange={v => setKnob("eqHigh", v)} />
              <Knob label="Mid" value={knobs.eqMid} defaultValue={TUNING.eqMid}
                min={-12} max={12} format={v => `${v > 0 ? "+" : ""}${Math.round(v)}dB`}
                {...linEqMid} onChange={v => setKnob("eqMid", v)} />
              <Knob label="Low" value={knobs.eqLow} defaultValue={TUNING.eqLow}
                min={-12} max={12} format={v => `${v > 0 ? "+" : ""}${Math.round(v)}dB`}
                {...linEqLow} onChange={v => setKnob("eqLow", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Wobble</span>
            <div className="cel-knob-row">
              <Knob label="Rate" value={knobs.wobbleRate} defaultValue={TUNING.vibratoFreq}
                min={0.01} max={2} format={v => `${v.toFixed(2)}Hz`}
                {...logWobbleRate} onChange={v => setKnob("wobbleRate", v)} />
              <Knob label="Depth" value={knobs.wobbleDepth} defaultValue={TUNING.vibratoDepth}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linWobbleDepth} onChange={v => setKnob("wobbleDepth", v)} />
              <Knob label="Mix" value={knobs.wobbleMix} defaultValue={TUNING.vibratoWet}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linWobbleMix} onChange={v => setKnob("wobbleMix", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Echo</span>
            <div className="cel-knob-row">
              <Knob label="Time" value={knobs.echoTime} defaultValue={TUNING.delayTime}
                min={0.05} max={1.5} format={v => `${v.toFixed(2)}s`}
                {...logEchoTime} onChange={v => setKnob("echoTime", v)} />
              <Knob label="Feedback" value={knobs.echoFeedback} defaultValue={TUNING.delayFeedback}
                min={0} max={0.95} format={v => v.toFixed(2)}
                {...linEchoFb} onChange={v => setKnob("echoFeedback", v)} />
              <Knob label="Mix" value={knobs.echoMix} defaultValue={TUNING.delayWet}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linEchoMix} onChange={v => setKnob("echoMix", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Reverb</span>
            <div className="cel-knob-row">
              <Knob label="Room" value={knobs.reverbRoom} defaultValue={TUNING.reverbRoom}
                min={0.3} max={1.0} format={v => v.toFixed(2)}
                {...linReverbRoom} onChange={v => setKnob("reverbRoom", v)} />
              <Knob label="Damp" value={knobs.reverbDamp} defaultValue={TUNING.reverbDamp}
                min={200} max={8000} format={v => `${Math.round(v)}Hz`}
                {...logReverbDamp} onChange={v => setKnob("reverbDamp", v)} />
              <Knob label="Mix" value={knobs.reverbMix} defaultValue={TUNING.reverbWet}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linReverbMix} onChange={v => setKnob("reverbMix", v)} />
              <Knob label="Sweep" value={knobs.dampSweepDepth} defaultValue={TUNING.dampSweepDepth}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linDampSweepDepth} onChange={v => setKnob("dampSweepDepth", v)} />
              <Knob label="S.Rate" value={knobs.dampSweepRate} defaultValue={TUNING.dampSweepRate}
                min={0.01} max={1} format={v => `${v.toFixed(2)}Hz`}
                {...logDampSweepRate} onChange={v => setKnob("dampSweepRate", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Space</span>
            <div className="cel-knob-row">
              <Knob label="Drift" value={knobs.panDrift} defaultValue={TUNING.panLfoFreq}
                min={0.01} max={0.5} format={v => `${v.toFixed(2)}Hz`}
                {...logPanDrift} onChange={v => setKnob("panDrift", v)} />
              <Knob label="Width" value={knobs.panWidth} defaultValue={TUNING.panLfoAmplitude}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linPanWidth} onChange={v => setKnob("panWidth", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Phase</span>
            <div className="cel-knob-row">
              <Knob label="Rate" value={knobs.phaserFreq} defaultValue={TUNING.phaserFreq}
                min={0.05} max={8} format={v => `${v.toFixed(2)}Hz`}
                {...logPhaserFreq} onChange={v => setKnob("phaserFreq", v)} />
              <Knob label="Octaves" value={knobs.phaserOctaves} defaultValue={TUNING.phaserOctaves}
                min={1} max={6} format={v => Math.round(v)}
                {...linPhaserOct} onChange={v => setKnob("phaserOctaves", Math.round(v))} />
              <Knob label="Base" value={knobs.phaserBase} defaultValue={TUNING.phaserBase}
                min={100} max={4000} format={v => `${Math.round(v)}Hz`}
                {...logPhaserBase} onChange={v => setKnob("phaserBase", v)} />
              <Knob label="Mix" value={knobs.phaserMix} defaultValue={TUNING.phaserWet}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linPhaserMix} onChange={v => setKnob("phaserMix", v)} />
            </div>
          </div>

          <div className="cel-knob-section">
            <span className="cel-section-label">Saturate</span>
            <div className="cel-knob-row">
              <Knob label="Drive" value={knobs.satDrive} defaultValue={TUNING.distortion}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linSatDrive} onChange={v => setKnob("satDrive", v)} />
              <Knob label="Mix" value={knobs.satMix} defaultValue={TUNING.distortionWet}
                min={0} max={1} format={v => v.toFixed(2)}
                {...linSatMix} onChange={v => setKnob("satMix", v)} />
            </div>
          </div>
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
        </details>

        <div className="cel-info">
          <p>Tap planets to build your chord. Each voice has its own stereo position.</p>
          <p className="cel-chain">
            Fat saw &rarr; Panner &rarr; Sum bus &rarr; Saturation &rarr; Tape EQ
            <br />
            &rarr; VHS wow &rarr; Delay &rarr; Algorithmic reverb &rarr; Monitor EQ &rarr; Soft clip
          </p>
        </div>

        <div className="cel-footer">
          <p>v9 &middot; 12&times;3 voices &middot; 24kHz &middot; Full control</p>
        </div>
      </div>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const CSS = `
  @font-face {
    font-family: 'Rudelsberg';
    src: url('/fonts/rudelsberg/Rudelsberg.ttf') format('truetype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Rudelsberg Alternate';
    src: url('/fonts/rudelsberg/RudelsbergAlternate.ttf') format('truetype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Rudelsberg Titel';
    src: url('/fonts/rudelsberg/Rudelsberg-Titel.ttf') format('truetype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Rudelsberg Initialen';
    src: url('/fonts/rudelsberg/Rudelsberg-Initialen.ttf') format('truetype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Rudelsberg Schmuck';
    src: url('/fonts/rudelsberg/Rudelsberg-Schmuck.ttf') format('truetype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Rudelsberg Plakatschrift';
    src: url('/fonts/rudelsberg/Rudelsberg-Plakatschrift.ttf') format('truetype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Spiral ST';
    src: url('/fonts/spiral-st/SpiralST.ttf') format('truetype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Gerakent';
    src: url('/fonts/gerakent/GERAKENTtrial.otf') format('opentype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Xagetif';
    src: url('/fonts/xagetif/Xagetiftrial.otf') format('opentype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Gesego';
    src: url('/fonts/gesego/Gesegotrial.otf') format('opentype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Salty Mussy';
    src: url('/fonts/salty-mussy-demo/Salty Mussy DEMO.otf') format('opentype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Ruigslay';
    src: url('/fonts/ruigslay/Ruigslay.otf') format('opentype');
    font-display: swap;
  }
  @font-face {
    font-family: 'Soiglat';
    src: url('/fonts/soiglat/Soiglat-Regular.ttf') format('truetype');
    font-display: swap;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #08080f;
    overflow-x: hidden;
  }

  .cel-root {
    min-height: 100vh;
    background: linear-gradient(170deg, #0a0a1a 0%, #15082e 40%, #0d0d20 100%);
    color: #d8d0e8;
    font-family: ${FONTS.body};
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2.5rem 1rem;
    user-select: none;
    -webkit-user-select: none;
  }

  .cel-title {
    font-family: ${FONTS["title"]};
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

  .cel-matrix {
    color: #8878a0;
    margin: 0;
    text-align: center;
    line-height: 0.6;
    font-size: 0.3rem;
  }

  .cel-sub {
    font-size: 0.85rem;
    color: #8878a0;
    letter-spacing: 0.08em;
    margin-bottom: 2rem;
    text-align: center;
  }

  /* ── Piano keyboard layout ──────────────────────────── */

  .cel-keyboard {
    position: relative;
    display: flex;
    gap: 2px;
    max-width: 560px;
    width: 100%;
    height: 160px;
    margin-bottom: 1.2rem;
  }

  .cel-key {
    border: none;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 0.15rem;
    color: #d8d0e8;
    transition: all 0.25s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    padding-bottom: 0.6rem;
  }

  .cel-key:active {
    transform: scale(0.97);
  }

  .cel-key-natural {
    flex: 1;
    height: 100%;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(180, 140, 255, 0.12);
    border-radius: 0 0 8px 8px;
    z-index: 1;
  }

  .cel-key-natural:hover {
    background: rgba(180, 140, 255, 0.08);
    border-color: rgba(180, 140, 255, 0.3);
  }

  .cel-key-sharp {
    position: absolute;
    top: 0;
    width: 9%;
    height: 58%;
    background: rgba(30, 15, 60, 0.9);
    border: 1px solid rgba(180, 140, 255, 0.25);
    border-radius: 0 0 6px 6px;
    z-index: 2;
    padding-bottom: 0.4rem;
  }

  .cel-key-sharp:hover {
    background: rgba(50, 25, 80, 0.9);
    border-color: rgba(180, 140, 255, 0.45);
  }

  .cel-key-active.cel-key-natural {
    background: rgba(180, 140, 255, 0.14);
    border-color: rgba(180, 140, 255, 0.55);
    box-shadow: 0 0 16px rgba(140, 100, 220, 0.3), inset 0 0 12px rgba(180, 140, 255, 0.06);
  }

  .cel-key-active.cel-key-natural:hover {
    background: rgba(180, 140, 255, 0.2);
    border-color: rgba(180, 140, 255, 0.65);
  }

  .cel-key-active.cel-key-sharp {
    background: rgba(80, 40, 140, 0.9);
    border-color: rgba(200, 160, 255, 0.6);
    box-shadow: 0 0 12px rgba(140, 100, 220, 0.4), inset 0 0 8px rgba(180, 140, 255, 0.1);
  }

  .cel-key-active.cel-key-sharp:hover {
    background: rgba(100, 50, 160, 0.9);
    border-color: rgba(200, 160, 255, 0.7);
  }

  .cel-key-glyph {
    font-size: 1.3rem;
    color: #c4a0ff;
  }

  .cel-key-sharp .cel-key-glyph {
    font-size: 1rem;
  }

  .cel-key-active .cel-key-glyph {
    color: #e0c8ff;
    text-shadow: 0 0 10px rgba(200, 160, 255, 0.6);
  }

  .cel-key-name {
    font-weight: 600;
    font-size: 0.7rem;
    letter-spacing: 0.02em;
  }

  .cel-key-sharp .cel-key-name {
    font-size: 0.55rem;
  }

  .cel-key-note {
    font-size: 0.6rem;
    color: #8070a0;
  }

  .cel-key-active .cel-key-note {
    color: #b8a0d8;
  }

  .cel-key-uncertain {
    opacity: 0.4;
  }

  /* ── Controls row (Shadow + Breathe) ────────────────── */

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

  /* ── Breathe button ─────────────────────────────────── */

  .cel-breathe-btn {
    border-color: rgba(255, 180, 140, 0.15);
    padding: 0.6rem 2rem;
  }

  .cel-breathe-btn:hover:not(:disabled) {
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

  /* ── within (collapsible knob panel) ──────────────── */

  .cel-within {
    max-width: 440px;
    width: 100%;
    margin-bottom: 1.5rem;
  }

  .cel-within-summary {
    cursor: pointer;
    color: #8878a0;
    font-size: 0.85rem;
    text-align: center;
    padding: 0.5rem;
    letter-spacing: 0.15em;
    list-style: none;
    transition: color 0.3s ease;
  }

  .cel-within-summary::-webkit-details-marker { display: none; }

  .cel-within-summary:hover {
    color: #c4a0ff;
  }

  .cel-within[open] .cel-within-summary {
    color: #b490e8;
    margin-bottom: 0.5rem;
  }

  /* ── SVG Knobs ───────────────────────────────────────── */

  .cel-knobs-all {
    max-width: 440px;
    width: 100%;
    margin-bottom: 1.5rem;
  }

  .cel-knob-section {
    margin-bottom: 1rem;
  }

  .cel-section-label {
    display: block;
    text-align: center;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #504868;
    margin-bottom: 0.3rem;
  }

  .cel-knob-row {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
  }

  .cel-knob {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    flex: 1;
    max-width: 80px;
  }

  .cel-knob-label {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: #8878a0;
    text-transform: uppercase;
  }

  .cel-knob-svg {
    cursor: ns-resize;
    touch-action: none;
  }

  .cel-knob-value {
    font-size: 0.6rem;
    color: #504868;
    font-family: ${FONTS.mono};
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
    font-family: ${FONTS.mono};
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
