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
//   sumBus → Chebyshev → EQ3 → Vibrato → Echo(CrossFade)
//     → Freeverb → Chorus → MonitorEQ → tanh soft clip → destination
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
//   Echo loop   — Hand-wired delay with feedback path containing
//                  lowpass filter + tanh saturator. Each repeat gets
//                  progressively darker and warmer (tape delay character).
//                  Uses CrossFade for dry/wet mix. Placed after vibrato
//                  so echoes inherit the pitch drift.
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
// macros         — Object of 6 macro knob positions (0–1 each).
//                  Each macro drives multiple params via MACRO_DEFS.
//                  Shadow mode temporarily overrides FX params; when
//                  Shadow disengages, macro-derived values are restored.
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
//                  restores macro-derived values.
// Breathe        — Easter egg: cycles oscillator type across all
//                  voices (saw → sine → tri → square). If voices
//                  are active, releases them first, then switches.
//                  Label always says "Breathe" — the osc change
//                  is discoverable, not advertised.
// Listen pills   — Monitor EQ presets for different playback devices.
// Macros         — 6 SVG arc macro knobs (Bloom, Aether, Echo, Drift,
//                  Grit, Tone). Each drives multiple params via curves.
//                  Double-click resets to 0.5. Shift+drag for fine control.
// Natal Chart    — Enter birth data, compute planetary positions via
//                  circular-natal-horoscope-js, remap voice pitches
//                  to zodiac-derived notes.
//
// ═══════════════════════════════════════════════════════════════

import React, { useRef, useState, useCallback, useEffect } from "react";
import * as Tone from "tone";
import { Origin, Horoscope } from "circular-natal-horoscope-js";
import { TUNING, SHADOW, MACROS, CHAINS, ACTIVE_CHAIN, LISTEN_PRESETS } from "./tuning";

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
  title: "'Spiral ST', serif",
  body: "system-ui, -apple-system, sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
};

// 12 planets — chromatic mapping C through B.
// Each carries: note class, microtonal detune from 12-TET (cents),
// octave, velocity (mix weight), glyph, fixed stereo base,
// pan group, osc count, osc spread.
const PLANETS = {
  Pluto: {
    octave: 2,
    vel: 0.7,
    glyph: "\u2647",
    note: "C",
    detuneCents: 0,
    panBase: -0.62,
    panGroup: "A",
    oscCount: 2,
    oscSpread: 55,
  },
  Neptune: {
    octave: 2,
    vel: 0.6,
    glyph: "\u2646",
    note: "Db",
    detuneCents: 0,
    panBase: 0.46,
    panGroup: "D",
    oscCount: 2,
    oscSpread: 40,
  },
  Jupiter: {
    octave: 2,
    vel: 0.8,
    glyph: "\u2643",
    note: "D",
    detuneCents: 0,
    panBase: -0.85,
    panGroup: "A",
    oscCount: 2,
    oscSpread: 55,
  },
  Uranus: {
    octave: 3,
    vel: 0.5,
    glyph: "\u2645",
    note: "Eb",
    detuneCents: 0,
    panBase: 0.72,
    panGroup: "D",
    oscCount: 3,
    oscSpread: 40,
  },
  Saturn: {
    octave: 3,
    vel: 0.6,
    glyph: "\u2644",
    note: "E",
    detuneCents: 0,
    panBase: -0.15,
    panGroup: "B",
    oscCount: 3,
    oscSpread: 45,
  },
  Chiron: {
    octave: 3,
    vel: 0.4,
    glyph: "\u26B7",
    note: "F",
    detuneCents: 0,
    panBase: 0.62,
    panGroup: "D",
    oscCount: 3,
    oscSpread: 40,
  },
  Mars: {
    octave: 4,
    vel: 0.7,
    glyph: "\u2642",
    note: "Gb",
    detuneCents: 0,
    panBase: -0.38,
    panGroup: "B",
    oscCount: 3,
    oscSpread: 50,
  },
  Sun: {
    octave: 4,
    vel: 1.0,
    glyph: "\u2609",
    note: "G",
    detuneCents: 0,
    panBase: 0.15,
    panGroup: "C",
    oscCount: 3,
    oscSpread: 45,
  },
  Venus: {
    octave: 4,
    vel: 0.5,
    glyph: "\u2640",
    note: "Ab",
    detuneCents: 0,
    panBase: 0.38,
    panGroup: "C",
    oscCount: 3,
    oscSpread: 45,
  },
  Ascendant: {
    octave: 4,
    vel: 0.6,
    glyph: "AC",
    note: "A",
    detuneCents: 0,
    panBase: 0.0,
    panGroup: "C",
    oscCount: 3,
    oscSpread: 45,
  },
  Mercury: {
    octave: 5,
    vel: 0.5,
    glyph: "\u263F",
    note: "Bb",
    detuneCents: 0,
    panBase: 0.08,
    panGroup: "D",
    oscCount: 3,
    oscSpread: 40,
  },
  Moon: {
    octave: 5,
    vel: 0.4,
    glyph: "\u263D",
    note: "B",
    detuneCents: 0,
    panBase: -0.23,
    panGroup: "A",
    oscCount: 3,
    oscSpread: 40,
  },
};

const PLANET_COLORS = {
  Sun: ["#f28320", "#f15d22", "#d94126", "#a41d21", "#0c0c0c"],
  Mercury: ["#595856", "#c0bdbc", "#8d8a88", "#f5f6f7", "#0c0c0c"],
  Venus: ["#878a8d", "#d9b292", "#f4dbc4", "#414141", "#0c0c0c"],
  Mars: ["#dabd9d", "#8c5c4a", "#f27b5f", "#c26d5c", "#0c0c0c"],
  Jupiter: ["#282311", "#c08237", "#bfaf9b", "#c0a480", "#0c0c0c"],
  Uranus: ["#3f575a", "#688a8d", "#95bbbe", "#d0ecf0", "#0c0c0c"],
  Neptune: ["#657ba5", "#7495bf", "#4e5d74", "#779ebf", "#0c0c0c"],
  Pluto: ["#4a3a5c", "#7b6898", "#a08cb8", "#c8b8d8", "#0c0c0c"],
  Saturn: ["#8b7355", "#c4a96d", "#e0c98f", "#5a4a32", "#0c0c0c"],
  Chiron: ["#2e6b5a", "#4a9e82", "#78c4a8", "#1a4238", "#0c0c0c"],
  Moon: ["#c0c0c8", "#8888a0", "#e8e8f0", "#606078", "#0c0c0c"],
  Ascendant: ["#d4af37", "#f0d060", "#a08020", "#f8e888", "#0c0c0c"],
};
const COLOR_OFF = "#0c0c0c";
const KNOB_DEFAULT_COLOR = "#9070cc";

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const KEYBOARD_ORDER = Object.keys(PLANETS);
const SHARP_INDICES = new Set([1, 3, 6, 8, 10]);
const SHARP_POSITIONS = ["10%", "24%", "53%", "67%", "81%"];
// Oscillator types cycled by Breathe button (easter egg).
// "fat" variants use multiple detuned oscillators per voice — count/spread
// set per planet in PLANETS config. Saw is default (richest harmonics for
// Chebyshev intermodulation). Sine is purest. Tri is warm. Square is hollow.
const OSC_TYPES = ["fatsawtooth", "fatsine", "fattriangle", "fatsquare"];

// ─── Tuning Constants (imported from tuning.js) ─────────────

// Circle-of-fifths mapping: Aries=C (spring/tonal center), sharps accumulate
// through spring/summer, flats through fall/winter. Libra lands on Gb
// (equidistant in sharps/flats — mirrors Libra's balance).
const ZODIAC_NOTES = {
  aries: "C",
  taurus: "G",
  gemini: "D",
  cancer: "A",
  leo: "E",
  virgo: "B",
  libra: "Gb",
  scorpio: "Db",
  sagittarius: "Ab",
  capricorn: "Eb",
  aquarius: "Bb",
  pisces: "F",
};

// ─── Macro Interpolation Helpers ─────────────────────────
// All macros are 0–1. m=0.5 always produces TUNING defaults.
// "split" variants have a 3-point anchor (min, mid, max).
// "dormant" variants hold base value for m<=0.5, then ramp.
function splitLog(min, mid, max, m) {
  if (m <= 0.5) {
    const t = m / 0.5;
    return min * Math.pow(mid / min, t);
  }
  const t = (m - 0.5) / 0.5;
  return mid * Math.pow(max / mid, t);
}
function splitLinear(min, mid, max, m) {
  if (m <= 0.5) return min + (mid - min) * (m / 0.5);
  return mid + (max - mid) * ((m - 0.5) / 0.5);
}
function dormantLinear(base, max, m) {
  return m <= 0.5 ? base : base + (max - base) * ((m - 0.5) / 0.5);
}
function dormantLog(base, max, m) {
  return m <= 0.5 ? base : base * Math.pow(max / base, (m - 0.5) / 0.5);
}

// ─── Knob Mapping ────────────────────────────────────────────

const KNOB_MAP = {
  // Voice
  attack: {
    apply: (eng, v) => {
      Object.values(eng.synths).forEach((s) => {
        s.set({ envelope: { attack: v } });
      });
    },
  },
  decay: {
    apply: (eng, v) => {
      Object.values(eng.synths).forEach((s) => {
        s.set({ envelope: { decay: v } });
      });
    },
  },
  sustain: {
    apply: (eng, v) => {
      Object.values(eng.synths).forEach((s) => {
        s.set({ envelope: { sustain: v } });
      });
    },
  },
  release: {
    apply: (eng, v) => {
      Object.values(eng.synths).forEach((s) => {
        s.set({ envelope: { release: v } });
      });
    },
  },
  // Grit
  gritDrive: {
    apply: (eng, v) => {
      eng.fx.chebyshev.wet.value = v;
    },
  },
  chebyOrder: {
    apply: (eng, v) => {
      eng.fx.chebyshev.order = v;
    },
  },
  // Tape
  eqHigh: {
    apply: (eng, v) => {
      eng.fx.eq3.high.value = v;
    },
  },
  eqMid: {
    apply: (eng, v) => {
      eng.fx.eq3.mid.value = v;
    },
  },
  eqLow: {
    apply: (eng, v) => {
      eng.fx.eq3.low.value = v;
    },
  },
  // Wobble
  wobbleRate: {
    apply: (eng, v) => {
      eng.fx.vibrato.frequency.value = v;
    },
  },
  wobbleDepth: {
    apply: (eng, v) => {
      eng.fx.vibrato.depth.value = v;
    },
  },
  wobbleMix: {
    apply: (eng, v) => {
      eng.fx.vibrato.wet.value = v;
    },
  },
  // Echo (all ramped — prevents Doppler artifacts + feedback runaway)
  echoTime: {
    apply: (eng, v) => {
      const p = eng.fx.echoDelay.delayTime;
      p.cancelAndHoldAtTime(Tone.now());
      p.rampTo(v, 0.15);
    },
  },
  echoFeedback: {
    apply: (eng, v) => {
      const p = eng.fx.echoFeedbackGain.gain;
      p.cancelAndHoldAtTime(Tone.now());
      p.rampTo(v, 0.08);
    },
  },
  echoMix: {
    apply: (eng, v) => {
      const p = eng.fx.echoCrossfade.fade;
      p.cancelAndHoldAtTime(Tone.now());
      p.rampTo(v, 0.08);
    },
  },
  echoFilterFreq: {
    apply: (eng, v) => {
      const p = eng.fx.echoFilter.frequency;
      p.cancelAndHoldAtTime(Tone.now());
      p.rampTo(v, 0.1);
    },
  },
  // Reverb
  reverbRoom: {
    apply: (eng, v) => {
      eng.fx.reverb.roomSize.value = v;
    },
  },
  reverbDamp: {
    apply: (eng, v) => {
      eng.fx.reverb.dampening = v;
      eng.fx.dampSweep.center = v;
    },
  },
  reverbMix: {
    apply: (eng, v) => {
      eng.fx.reverb.wet.value = v;
    },
  },
  dampSweepRate: {
    apply: (eng, v) => {
      eng.fx.dampSweep.rate = v;
    },
  },
  dampSweepDepth: {
    apply: (eng, v) => {
      eng.fx.dampSweep.depth = v;
    },
  },
  // Space
  panDrift: {
    apply: (eng, v) => {
      Object.values(eng.panLfos).forEach((l) => {
        l.frequency.value = v;
      });
    },
  },
  panWidth: {
    apply: (eng, v) => {
      Object.values(eng.panLfos).forEach((l) => {
        l.amplitude.value = v;
      });
    },
  },
  // Phase
  phaserFreq: {
    apply: (eng, v) => {
      eng.fx.phaser.frequency.value = v;
    },
  },
  phaserOctaves: {
    apply: (eng, v) => {
      eng.fx.phaser.octaves = v;
    },
  },
  phaserBase: {
    apply: (eng, v) => {
      eng.fx.phaser.baseFrequency = v;
    },
  },
  phaserQ: {
    apply: (eng, v) => {
      eng.fx.phaser.Q.value = v;
    },
  },
  phaserMix: {
    apply: (eng, v) => {
      eng.fx.phaser.wet.value = v;
      eng.setBypass("phaser", v === 0);
    },
  },
  // Chorus shimmer (post-reverb, always inline — wet=0 bypasses)
  aetherShimmer: {
    apply: (eng, v) => {
      eng.fx.chorus.wet.value = v;
    },
  },
  // Saturate
  satDrive: {
    apply: (eng, v) => {
      eng.fx.distortion.distortion = v;
    },
  },
  satMix: {
    apply: (eng, v) => {
      eng.fx.distortion.wet.value = v;
      eng.setBypass("distortion", v === 0);
    },
  },
};

// ─── Macro Definitions ───────────────────────────────────
// 6 macro knobs, each 0–1 normalized. 0.5 = TUNING defaults.
// Each macro drives multiple params via opinionated curves.

// Resolve declarative curve arrays into callable functions
const CURVE_RESOLVERS = { splitLog, splitLinear, dormantLinear, dormantLog };

function resolveCurve(spec) {
  if (typeof spec === "function") return spec;
  const [type, ...args] = spec;
  const fn = CURVE_RESOLVERS[type];
  return (m) => fn(...args, m);
}

const RESOLVED_MACROS = Object.fromEntries(
  Object.entries(MACROS).map(([key, def]) => [
    key,
    {
      ...def,
      params: Object.fromEntries(
        Object.entries(def.params).map(([param, spec]) => [
          param,
          resolveCurve(spec),
        ]),
      ),
    },
  ]),
);

function computeAllParams(macroValues) {
  const params = {};
  for (const [macro, val] of Object.entries(macroValues)) {
    for (const [param, fn] of Object.entries(RESOLVED_MACROS[macro].params)) {
      params[param] = fn(val);
    }
  }
  return params;
}

// ─── SVG Arc Knob Component ──────────────────────────────────

const Knob = React.memo(function Knob({
  label,
  value,
  defaultValue,
  min,
  max,
  format,
  onChange,
  mapToNorm,
  mapFromNorm,
}) {
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

  const degToRad = (d) => (d * Math.PI) / 180;
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
  const valuePath =
    clampedNorm > 0.003 ? describeArc(startAngle, valueAngle) : "";
  const pointer = arcPoint(valueAngle);

  const onPointerDown = useCallback(
    (e) => {
      e.target.setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startNorm: clampedNorm };
    },
    [clampedNorm],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!dragRef.current) return;
      const sensitivity = e.shiftKey ? 0.0005 : 0.003;
      const dy = dragRef.current.startY - e.clientY;
      const newNorm = Math.max(
        0,
        Math.min(1, dragRef.current.startNorm + dy * sensitivity),
      );
      const newValue = mapFromNorm
        ? mapFromNorm(newNorm)
        : min + newNorm * (max - min);
      onChange(newValue);
    },
    [min, max, onChange, mapFromNorm],
  );

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
        width={size}
        height={size}
        className="cel-knob-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <path
          d={trackPath}
          fill="none"
          stroke="rgba(180,140,255,0.15)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {valuePath && <path d={valuePath} className="cel-knob-value-arc" />}
        <circle
          cx={pointer.x}
          cy={pointer.y}
          r="4"
          className="cel-knob-pointer"
        />
        <circle
          cx={cx}
          cy={cy}
          r="6"
          fill="rgba(180,140,255,0.08)"
          stroke="rgba(180,140,255,0.2)"
          strokeWidth="1"
        />
      </svg>
      <span className="cel-knob-value">{format ? format(value) : value}</span>
    </div>
  );
});

// ─── Audio Engine Factory ────────────────────────────────────

async function createEngine() {
  Tone.setContext(
    new Tone.Context({
      latencyHint: "playback",
      sampleRate: TUNING.sampleRate,
      lookAhead: 0.2,
      updateInterval: 0.1,
    }),
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

  // ─── Custom echo loop (filter + saturation in feedback path) ───
  const echoDelay = new Tone.Delay({
    delayTime: TUNING.delayTime,
    maxDelay: 2,
  });
  const echoFeedbackGain = new Tone.Gain(TUNING.delayFeedback);
  const echoFilter = new Tone.Filter({
    frequency: TUNING.echoFilterFreq,
    type: "lowpass",
    rolloff: -12,
  });
  const echoSat = new Tone.WaveShaper(
    (v) => Math.tanh(v * TUNING.echoSatDrive),
    1024,
  );
  const echoCrossfade = new Tone.CrossFade(TUNING.delayWet);
  const echoInputGain = new Tone.Gain(TUNING.echoInputGain);

  // Feedback loop: delay out → filter → saturator → gain → delay in
  echoDelay.connect(echoFilter);
  echoFilter.connect(echoSat);
  echoSat.connect(echoFeedbackGain);
  echoFeedbackGain.connect(echoDelay);

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
    _eventId: null,
    start() {
      if (this._eventId !== null) this.stop();
      if (Tone.Transport.state !== "started") Tone.Transport.start();
      const tickSec = 0.05;
      this._eventId = Tone.Transport.scheduleRepeat(() => {
        if (this.depth <= 0) return;
        this._phase += 2 * Math.PI * this.rate * tickSec;
        if (this._phase > 2 * Math.PI) this._phase -= 2 * Math.PI;
        const mod = Math.sin(this._phase);
        const logCenter = Math.log(this.center);
        const logRange = this.depth * 2.5;
        const val = Math.exp(logCenter + mod * logRange);
        reverb.dampening = Math.max(200, Math.min(8000, val));
      }, tickSec);
    },
    stop() {
      if (this._eventId !== null) {
        Tone.Transport.clear(this._eventId);
        this._eventId = null;
      }
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

  const chorus = new Tone.Chorus({
    frequency: 0.8,
    delayTime: 12,
    depth: 0.6,
  });
  chorus.wet.value = 0.0;

  const distortion = new Tone.Distortion({
    distortion: TUNING.distortion,
    oversample: "4x",
  });
  distortion.wet.value = TUNING.distortionWet;

  // tanh soft clip — preserves Freeverb resonant peaks that Limiter(-1) killed
  const softClip = new Tone.WaveShaper((val) => Math.tanh(val), 4096);
  softClip.oversample = "2x";

  // Summing bus — all panners feed here so voices intermodulate through Chebyshev
  const sumBus = new Tone.Gain(1);

  // ─── Chain builder ───
  function wireChain(src, nodes, config) {
    const { order, bypass } = config;
    let prev = src;
    for (const name of order) {
      if (name === "ECHO") {
        prev.connect(nodes.echoCrossfade.a);
        prev.connect(nodes.echoInputGain);
        nodes.echoInputGain.connect(nodes.echoDelay);
        nodes.echoDelay.connect(nodes.echoCrossfade.b);
        prev = nodes.echoCrossfade;
      } else {
        prev.connect(nodes[name]);
        prev = nodes[name];
      }
    }
    prev.toDestination();

    const bypassState = {};
    const bypassable = {};
    for (const [name, cfg] of Object.entries(bypass)) {
      bypassState[name] = true;
      bypassable[name] = {
        node: nodes[name],
        prev: nodes[cfg.after],
        next: nodes[cfg.before],
      };
    }
    return { bypassState, bypassable };
  }

  const chainNodes = {
    chebyshev, eq3, vibrato, reverb, chorus, monitorEQ, softClip,
    phaser, distortion, echoCrossfade, echoDelay, echoInputGain,
  };
  const { bypassState, bypassable } = wireChain(sumBus, chainNodes, CHAINS[ACTIVE_CHAIN]);

  function setBypass(name, bypassed) {
    if (bypassState[name] === bypassed) return;
    const b = bypassable[name];
    try {
      if (bypassed) {
        b.prev.disconnect(b.node);
        b.node.disconnect(b.next);
        b.prev.connect(b.next);
      } else {
        b.prev.disconnect(b.next);
        b.prev.connect(b.node);
        b.node.connect(b.next);
      }
      bypassState[name] = bypassed;
    } catch (e) {
      /* ignore disconnect errors during rapid toggling */
    }
  }

  // ─── Per-planet synths + panners ──────────────────────────

  const synths = {};
  const panners = {};
  const spreadTracker = {};

  Object.entries(PLANETS).forEach(([name, cfg]) => {
    const panner = new Tone.Panner(cfg.panBase);
    const synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 2,
      voice: Tone.Synth,
      options: {
        oscillator: {
          type: "fatsawtooth",
          count: cfg.oscCount,
          spread: cfg.oscSpread,
        },
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
  ["A", "B", "C", "D"].forEach((group) => {
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
    setBypass,
    fx: {
      reverb,
      echoDelay,
      echoFeedbackGain,
      echoFilter,
      echoSat,
      echoCrossfade,
      echoInputGain,
      chorus,
      vibrato,
      chebyshev,
      eq3,
      monitorEQ,
      phaser,
      distortion,
      dampSweep,
    },
    dispose() {
      dampSweep.stop();
      Object.values(synths).forEach((s) => s.dispose());
      Object.values(panners).forEach((p) => p.dispose());
      Object.values(panLfos).forEach((l) => l.dispose());
      [
        sumBus,
        chebyshev,
        distortion,
        eq3,
        vibrato,
        echoDelay,
        echoFeedbackGain,
        echoFilter,
        echoSat,
        echoCrossfade,
        echoInputGain,
        chorus,
        reverb,
        phaser,
        monitorEQ,
        softClip,
      ].forEach((n) => n.dispose());
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
  const visualStateRef = useRef({});
  const keyRefsRef = useRef({});
  const rootRef = useRef(null);
  const emanationRef = useRef(null);
  const shadowRef = useRef(false);
  const macrosRef = useRef(null);
  const pendingOscTypeRef = useRef(null);
  const canvasCtxRef = useRef(null);
  const rafIdRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const keyPositionsRef = useRef({});
  const startLoopRef = useRef(null);
  const lastGlowRef = useRef({});
  const lastAccentRef = useRef(null);
  const colorIndexRef = useRef({});
  const [natalMode, setNatalMode] = useState(false);
  const [natalDate, setNatalDate] = useState("");
  const [natalTime, setNatalTime] = useState("");
  const [natalLat, setNatalLat] = useState("");
  const [natalLng, setNatalLng] = useState("");
  const [natalNotes, setNatalNotes] = useState({});
  const [macros, setMacros] = useState(
    Object.fromEntries(
      Object.entries(RESOLVED_MACROS).map(([k, v]) => [k, v.default]),
    ),
  );

  const setMacro = useCallback((name, value) => {
    setMacros((prev) => {
      const next = { ...prev, [name]: value };
      const eng = engineRef.current;
      if (eng) {
        const def = RESOLVED_MACROS[name];
        for (const [param, fn] of Object.entries(def.params)) {
          const v = fn(value);
          KNOB_MAP[param]?.apply(eng, v);
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      shadowIntervalsRef.current.forEach((id) => clearInterval(id));
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    shadowRef.current = shadow;
  }, [shadow]);
  useEffect(() => {
    macrosRef.current = macros;
  }, [macros]);

  // ─── Position cache (eliminates getBoundingClientRect in rAF) ──
  useEffect(() => {
    const updatePositions = () => {
      const rootEl = rootRef.current;
      if (!rootEl) return;
      const rr = rootEl.getBoundingClientRect();
      const positions = {};
      for (const planet of KEYBOARD_ORDER) {
        const el = keyRefsRef.current[planet];
        if (el) {
          const kr = el.getBoundingClientRect();
          positions[planet] = {
            cx: kr.left + kr.width / 2 - rr.left,
            cy: kr.top + kr.height / 2 - rr.top,
          };
        }
      }
      keyPositionsRef.current = positions;
      // Size canvas to match root + cache 2d context
      const canvas = emanationRef.current;
      if (canvas) {
        canvas.width = rr.width;
        canvas.height = rr.height;
        canvasCtxRef.current = canvas.getContext("2d");
      }
    };
    updatePositions();
    const ro = new ResizeObserver(updatePositions);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener("resize", updatePositions);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updatePositions);
    };
  }, []);

  // ─── Visual color engine (rAF loop) ─────────────────────────
  // Each active planet holds a fixed color (one of 4 colorful palette entries).
  // On release, that color lerps toward #0c0c0c — light dissolves into void.
  // Loop only runs when planets are active (idle = no rAF = saves battery).
  useEffect(() => {
    const [darkR, darkG, darkB] = hexToRgb(COLOR_OFF);

    const tick = (now) => {
      if (!lastFrameTimeRef.current) lastFrameTimeRef.current = now;
      lastFrameTimeRef.current = now;

      let blendR = 0,
        blendG = 0,
        blendB = 0,
        totalWeight = 0;
      const gradients = [];
      let hasActive = false;

      for (const planet in visualStateRef.current) {
        const vs = visualStateRef.current[planet];
        if (!vs) continue;
        hasActive = true;
        if (now < vs.startTime) continue;
        const elapsed = (now - vs.startTime) / 1000;
        let level = vs.envelopeLevel;

        switch (vs.stage) {
          case "attack":
            level = Math.min(1, elapsed / vs.attackTime);
            if (level >= 1) {
              vs.stage = "decay";
              vs.startTime = now;
            }
            break;
          case "decay": {
            const dp = Math.min(1, elapsed / vs.decayTime);
            level = 1 - (1 - vs.sustainLevel) * dp;
            if (dp >= 1) vs.stage = "sustain";
            break;
          }
          case "sustain":
            level = vs.sustainLevel;
            break;
          case "release": {
            const rp = Math.min(1, elapsed / vs.releaseTime);
            level = vs.releaseStartLevel * (1 - rp);
            if (rp >= 1) {
              vs.stage = "idle";
              level = 0;
            }
            break;
          }
          default:
            level = 0;
        }
        vs.envelopeLevel = level;

        const [ar, ag, ab] = vs.activeColor;
        let r = ar,
          g = ag,
          b = ab;

        if (vs.stage === "release" && vs.releaseStartLevel > 0.001) {
          const rp = 1 - level / vs.releaseStartLevel;
          r = Math.round(ar + (darkR - ar) * rp);
          g = Math.round(ag + (darkG - ag) * rp);
          b = Math.round(ab + (darkB - ab) * rp);
        }

        // Key glow — write only when changed (dirty flag)
        const glowAlpha = level > 0.01 ? Math.min(level * 0.5, 0.3) : 0;
        const el = keyRefsRef.current[planet];
        if (el) {
          const prevGlow = lastGlowRef.current[planet];
          if (prevGlow !== glowAlpha) {
            el.style.setProperty(
              "--glow-hue",
              glowAlpha > 0 ? `rgb(${r},${g},${b})` : "transparent",
            );
            el.style.setProperty("--glow-opacity", String(glowAlpha));
            lastGlowRef.current[planet] = glowAlpha;
          }
        }

        // Emanation — push data for canvas draw (no strings, no getBoundingClientRect)
        const pos = keyPositionsRef.current[planet];
        if (pos && level > 0.01) {
          gradients.push({
            cx: pos.cx,
            cy: pos.cy,
            r,
            g,
            b,
            alpha: level * 0.25,
            falloff: shadowRef.current ? 85 : 70,
          });
        }

        if (level > 0.01) {
          blendR += ar * level;
          blendG += ag * level;
          blendB += ab * level;
          totalWeight += level;
        }

        if (vs.stage === "idle") {
          if (el) {
            el.style.setProperty("--glow-opacity", "0");
            lastGlowRef.current[planet] = 0;
          }
          visualStateRef.current[planet] = null; // preserve V8 hidden class
        }
      }

      // Canvas emanation — single GPU-composited draw
      const canvas = emanationRef.current;
      const ctx = canvasCtxRef.current;
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const gd of gradients) {
          const radius = canvas.height * (gd.falloff / 100);
          const grad = ctx.createRadialGradient(
            gd.cx,
            gd.cy,
            0,
            gd.cx,
            gd.cy,
            radius,
          );
          grad.addColorStop(0, `rgba(${gd.r},${gd.g},${gd.b},${gd.alpha})`);
          grad.addColorStop(1, `rgba(${gd.r},${gd.g},${gd.b},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(gd.cx - radius, gd.cy - radius, radius * 2, radius * 2);
        }
      }

      // Knob accent — skip write if unchanged
      const rootEl = rootRef.current;
      if (rootEl) {
        let accent;
        if (totalWeight > 0.01) {
          accent = rgbToHex(
            Math.round(blendR / totalWeight),
            Math.round(blendG / totalWeight),
            Math.round(blendB / totalWeight),
          );
        } else {
          accent = KNOB_DEFAULT_COLOR;
        }
        if (accent !== lastAccentRef.current) {
          rootEl.style.setProperty("--knob-accent", accent);
          lastAccentRef.current = accent;
        }
      }

      // Idle detection — stop rAF when nothing is active
      if (hasActive) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
        lastFrameTimeRef.current = null;
      }
    };

    const startLoop = () => {
      if (!rafIdRef.current) rafIdRef.current = requestAnimationFrame(tick);
    };
    startLoopRef.current = startLoop;

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, []);

  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = await createEngine();
      setStatus("ready");
    }
    return engineRef.current;
  }, []);

  const togglePlanet = useCallback(
    async (planet) => {
      const eng = await ensureEngine();
      const cfg = PLANETS[planet];
      if (!cfg) return;
      const noteClass =
        natalMode && natalNotes[planet] ? natalNotes[planet] : cfg.note;
      const note = `${noteClass}${cfg.octave}`;
      // Derive envelope from bloom macro for visuals
      const bloom = macrosRef.current?.bloom ?? 0.5;
      const attack = RESOLVED_MACROS.bloom.params.attack(bloom);
      const decay = RESOLVED_MACROS.bloom.params.decay(bloom);
      const sustain = RESOLVED_MACROS.bloom.params.sustain(bloom);
      const release = RESOLVED_MACROS.bloom.params.release(bloom);
      setActivePlanets((prev) => {
        const next = new Set(prev);
        if (next.has(planet)) {
          eng.synths[planet].triggerRelease(note, Tone.now());
          next.delete(planet);
          const vs = visualStateRef.current[planet];
          if (vs) {
            vs.releaseStartLevel = vs.envelopeLevel;
            vs.stage = "release";
            vs.startTime = performance.now();
            vs.releaseTime = release;
          }
        } else {
          // Apply pending osc type from breathe before triggering
          if (pendingOscTypeRef.current) {
            Object.values(eng.synths).forEach((s) => {
              s.set({ oscillator: { type: pendingOscTypeRef.current } });
            });
            pendingOscTypeRef.current = null;
          }
          eng.synths[planet].triggerAttack(note, Tone.now(), cfg.vel);
          next.add(planet);
          const pal = PLANET_COLORS[planet];
          const ci = colorIndexRef.current[planet] || 0;
          colorIndexRef.current[planet] = (ci + 1) % 4;
          visualStateRef.current[planet] = {
            stage: "attack",
            startTime: performance.now(),
            envelopeLevel: 0,
            attackTime: attack,
            decayTime: decay,
            sustainLevel: sustain,
            releaseTime: release,
            releaseStartLevel: 0,
            activeColor: pal ? hexToRgb(pal[ci]) : [144, 112, 204],
          };
          if (startLoopRef.current) startLoopRef.current();
        }
        setStatus(next.size > 0 ? "playing" : "ready");
        return next;
      });
    },
    [ensureEngine, natalMode, natalNotes],
  );

  const breathe = useCallback(async () => {
    const eng = await ensureEngine();
    const bloom = macrosRef.current?.bloom ?? 0.5;
    const release = RESOLVED_MACROS.bloom.params.release(bloom);
    if (activePlanets.size > 0) {
      Object.values(eng.synths).forEach((s) => s.releaseAll(Tone.now()));
      for (const planet of activePlanets) {
        const vs = visualStateRef.current[planet];
        if (vs) {
          vs.releaseStartLevel = vs.envelopeLevel;
          vs.stage = "release";
          vs.startTime = performance.now();
          vs.releaseTime = release;
        }
      }
      setActivePlanets(new Set());
      setStatus("ready");
    }
    if (shadow) {
      const { reverb, echoFeedbackGain, echoCrossfade, vibrato, chebyshev } = eng.fx;
      const rt = SHADOW.rampTime;
      const restored = computeAllParams(macrosRef.current);
      shadowIntervalsRef.current.forEach((id) => clearInterval(id));
      shadowIntervalsRef.current = [];
      reverb.wet.rampTo(restored.reverbMix, rt);
      echoFeedbackGain.gain.rampTo(restored.echoFeedback, rt);
      echoCrossfade.fade.rampTo(restored.echoMix, rt);
      vibrato.depth.rampTo(restored.wobbleDepth, rt);
      vibrato.frequency.rampTo(restored.wobbleRate, rt);
      chebyshev.wet.rampTo(restored.gritDrive, rt);
      Object.values(eng.panLfos).forEach((lfo) => {
        lfo.frequency.rampTo(restored.panDrift, rt);
        lfo.amplitude.rampTo(restored.panWidth, rt);
      });
      Object.entries(eng.synths).forEach(([name, synth]) => {
        synth.set({ oscillator: { spread: PLANETS[name].oscSpread } });
        synth.set({ detune: PLANETS[name].detuneCents });
        eng.spreadTracker[name] = PLANETS[name].oscSpread;
      });
      setShadow(false);
    }
    // Defer osc type change — voices may still be releasing
    const next = (oscIndex + 1) % OSC_TYPES.length;
    pendingOscTypeRef.current = OSC_TYPES[next];
    setOscIndex(next);
  }, [activePlanets, ensureEngine, oscIndex, shadow]);

  const toggleShadow = useCallback(async () => {
    const eng = await ensureEngine();
    const { reverb, echoFeedbackGain, echoCrossfade, vibrato, chebyshev } = eng.fx;
    const st = SHADOW;

    if (!shadow) {
      const rt = st.rampTime;
      reverb.wet.rampTo(st.reverbWet, rt);
      echoFeedbackGain.gain.rampTo(st.delayFeedback, rt);
      echoCrossfade.fade.rampTo(st.delayWet, rt);
      vibrato.depth.rampTo(st.vibratoDepth, rt);
      vibrato.frequency.rampTo(st.vibratoFreq, rt);
      chebyshev.wet.rampTo(st.chebyWet, rt);

      Object.values(eng.panLfos).forEach((lfo) => {
        lfo.frequency.rampTo(st.panLfoFreq, rt);
        lfo.amplitude.rampTo(st.panLfoAmplitude, rt);
      });

      // Slow spread ramp — +1 per 60ms tick (~4.8s to reach 120)
      const spreadId = setInterval(() => {
        let allDone = true;
        Object.entries(eng.synths).forEach(([name, synth]) => {
          const current = eng.spreadTracker[name];
          if (current < st.oscSpread) {
            allDone = false;
            const next = Math.min(current + 1, st.oscSpread);
            eng.spreadTracker[name] = next;
            synth.set({ oscillator: { spread: next } });
          }
        });
        if (allDone) {
          clearInterval(spreadId);
          shadowIntervalsRef.current = shadowIntervalsRef.current.filter(
            (id) => id !== spreadId,
          );
        }
      }, 60);

      // Smooth detune drift — lerp toward random targets
      const detuneId = setInterval(() => {
        Object.entries(eng.synths).forEach(([name, synth]) => {
          const base = PLANETS[name]?.detuneCents || 0;
          const current = synth.get().detune || base;
          const target = base + (Math.random() * 2 - 1) * st.detuneRange;
          const next = current + (target - current) * 0.3;
          synth.set({ detune: next });
        });
      }, 1200);

      shadowIntervalsRef.current = [spreadId, detuneId];
    } else {
      shadowIntervalsRef.current.forEach((id) => clearInterval(id));
      shadowIntervalsRef.current = [];

      const rt = st.rampTime;
      const restored = computeAllParams(macrosRef.current);
      reverb.wet.rampTo(restored.reverbMix, rt);
      echoFeedbackGain.gain.rampTo(restored.echoFeedback, rt);
      echoCrossfade.fade.rampTo(restored.echoMix, rt);
      vibrato.depth.rampTo(restored.wobbleDepth, rt);
      vibrato.frequency.rampTo(restored.wobbleRate, rt);
      chebyshev.wet.rampTo(restored.gritDrive, rt);

      Object.values(eng.panLfos).forEach((lfo) => {
        lfo.frequency.rampTo(restored.panDrift, rt);
        lfo.amplitude.rampTo(restored.panWidth, rt);
      });

      Object.entries(eng.synths).forEach(([name, synth]) => {
        synth.set({ oscillator: { spread: PLANETS[name].oscSpread } });
        synth.set({ detune: PLANETS[name].detuneCents });
        eng.spreadTracker[name] = PLANETS[name].oscSpread;
      });
    }
    setShadow((s) => !s);
  }, [shadow, ensureEngine]);

  const applyListenPreset = useCallback(
    async (key) => {
      const eng = await ensureEngine();
      const preset = LISTEN_PRESETS[key];
      if (!preset || !eng.fx.monitorEQ) return;
      eng.fx.monitorEQ.low.value = preset.low;
      eng.fx.monitorEQ.mid.value = preset.mid;
      eng.fx.monitorEQ.high.value = preset.high;
      setListenPreset(key);
    },
    [ensureEngine],
  );

  const computeNatalChart = useCallback(() => {
    if (!natalDate) return;

    const [year, month, day] = natalDate.split("-").map(Number);
    let hour = 12,
      minute = 0;
    if (natalTime) {
      [hour, minute] = natalTime.split(":").map(Number);
    }

    const latitude = parseFloat(natalLat) || 0;
    const longitude = parseFloat(natalLng) || 0;

    const origin = new Origin({
      year,
      month: month - 1,
      date: day,
      hour,
      minute,
      latitude,
      longitude,
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
      Sun: "sun",
      Moon: "moon",
      Mercury: "mercury",
      Venus: "venus",
      Mars: "mars",
      Jupiter: "jupiter",
      Saturn: "saturn",
      Uranus: "uranus",
      Neptune: "neptune",
      Pluto: "pluto",
      Chiron: "chiron",
    };

    Object.entries(bodyMap).forEach(([planet, bodyKey]) => {
      const body = chart.CelestialBodies[bodyKey];
      if (body && body.Sign && body.Sign.label) {
        notes[planet] = ZODIAC_NOTES[body.Sign.label.toLowerCase()] || null;
      }
    });

    // Ascendant only valid with birth time
    if (natalTime && chart.Ascendant && chart.Ascendant.Sign) {
      notes.Ascendant =
        ZODIAC_NOTES[chart.Ascendant.Sign.label.toLowerCase()] || null;
    } else {
      notes.Ascendant = null;
    }

    setNatalNotes(notes);
    setNatalMode(true);
  }, [natalDate, natalTime, natalLat, natalLng]);

  const playNatalChart = useCallback(async () => {
    if (!natalMode) return;
    const eng = await ensureEngine();

    Object.values(eng.synths).forEach((s) => s.releaseAll(Tone.now()));

    setTimeout(() => {
      // Apply pending osc type from breathe before triggering
      if (pendingOscTypeRef.current) {
        Object.values(eng.synths).forEach((s) => {
          s.set({ oscillator: { type: pendingOscTypeRef.current } });
        });
        pendingOscTypeRef.current = null;
      }

      const bloom = macrosRef.current?.bloom ?? 0.5;
      const attack = RESOLVED_MACROS.bloom.params.attack(bloom);
      const decay = RESOLVED_MACROS.bloom.params.decay(bloom);
      const sustain = RESOLVED_MACROS.bloom.params.sustain(bloom);
      const release = RESOLVED_MACROS.bloom.params.release(bloom);

      const now = Tone.now();
      const next = new Set();

      Object.entries(PLANETS).forEach(([planet, cfg], i) => {
        const noteClass = natalNotes[planet];
        if (!noteClass) return;
        const note = `${noteClass}${cfg.octave}`;
        eng.synths[planet].triggerAttack(
          note,
          now + i * TUNING.stagger,
          cfg.vel,
        );
        next.add(planet);
        const pal = PLANET_COLORS[planet];
        const ci = colorIndexRef.current[planet] || 0;
        colorIndexRef.current[planet] = (ci + 1) % 4;
        const perfNow = performance.now();
        visualStateRef.current[planet] = {
          stage: "attack",
          startTime: perfNow + i * TUNING.stagger * 1000,
          envelopeLevel: 0,
          attackTime: attack,
          decayTime: decay,
          sustainLevel: sustain,
          releaseTime: release,
          releaseStartLevel: 0,
          activeColor: pal ? hexToRgb(pal[ci]) : [144, 112, 204],
        };
      });

      setActivePlanets(next);
      setStatus("playing");
      if (startLoopRef.current) startLoopRef.current();
    }, TUNING.retriggerGap);
  }, [natalMode, natalNotes, ensureEngine]);

  return (
    <>
      <style>{CSS}</style>
      <div
        className={`cel-root${shadow ? " cel-eclipse-active" : ""}`}
        ref={rootRef}
      >
        <canvas className="cel-emanation" ref={emanationRef} />
        <div className="cel-oracle">
          <p>.</p>
          <p>. .</p>
          <p>. . .</p>
          <p>. .&nbsp; l o o k &nbsp;. .</p>
          <p>. . . &nbsp;w i t h i n&nbsp; . . .</p>
        </div>
        <div className="cel-keyboard">
          {KEYBOARD_ORDER.filter((_, i) => !SHARP_INDICES.has(i)).map(
            (planet) => {
              const cfg = PLANETS[planet];
              const active = activePlanets.has(planet);
              const isUncertain =
                planet === "Ascendant" && natalMode && !natalTime;
              return (
                <button
                  key={planet}
                  type="button"
                  ref={(el) => {
                    keyRefsRef.current[planet] = el;
                  }}
                  className={`cel-key cel-key-natural${active ? " cel-key-active" : ""}${isUncertain ? " cel-key-uncertain" : ""}`}
                  onClick={() => togglePlanet(planet)}
                >
                  <span className="cel-key-glyph">{cfg.glyph}</span>
                  <span className="cel-key-name">{planet}</span>
                  <span className="cel-key-note">
                    {natalMode && natalNotes[planet]
                      ? natalNotes[planet]
                      : `${cfg.note}${cfg.octave}`}
                  </span>
                </button>
              );
            },
          )}
          {KEYBOARD_ORDER.filter((_, i) => SHARP_INDICES.has(i)).map(
            (planet, i) => {
              const cfg = PLANETS[planet];
              const active = activePlanets.has(planet);
              const isUncertain =
                planet === "Ascendant" && natalMode && !natalTime;
              return (
                <button
                  key={planet}
                  type="button"
                  ref={(el) => {
                    keyRefsRef.current[planet] = el;
                  }}
                  className={`cel-key cel-key-sharp${active ? " cel-key-active" : ""}${isUncertain ? " cel-key-uncertain" : ""}`}
                  style={{ left: SHARP_POSITIONS[i] }}
                  onClick={() => togglePlanet(planet)}
                >
                  <span className="cel-key-glyph">{cfg.glyph}</span>
                  <span className="cel-key-name">{planet}</span>
                </button>
              );
            },
          )}
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

        <div className="cel-macros">
          {Object.entries(RESOLVED_MACROS).map(([key, def]) => (
            <Knob
              key={key}
              label={def.label}
              value={macros[key]}
              defaultValue={def.default}
              min={0}
              max={1}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setMacro(key, v)}
            />
          ))}
        </div>

        {/* Natal Chart — hidden until Lionel provides mapping data
        <details className="cel-natal">
          <summary className="cel-natal-summary">Natal Chart</summary>
          ...
        </details>
        */}

        <div className="cel-footer">
          <p>v11 &middot; 12&times;2 voices &middot; 16kHz &middot; 6 macros</p>
          <h1 className="cel-title">celezdial selekta</h1>
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
    background: #0c0c0c;
    overflow-x: hidden;
  }

  .cel-root {
    position: relative;
    min-height: 100vh;
    background: #0c0c0c;
    color: #d8d0e8;
    font-family: ${FONTS.body};
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2.5rem 1rem;
    user-select: none;
    -webkit-user-select: none;
    isolation: isolate;
  }

  .cel-emanation {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
    contain: strict;
  }

  /* ── Title + Oracle ────────────────────────────────── */

  .cel-title {
    font-family: ${FONTS.title};
    font-size: 2.4rem;
    font-weight: 400;
    letter-spacing: 0.15em;
    color: #f0e8ff;
    text-shadow: 0 0 30px rgba(180, 140, 255, 0.3);
    animation: cel-glow 6s ease-in-out infinite;
    margin-bottom: 0.4rem;
    text-align: center;
  }

  @keyframes cel-glow {
    0%, 100% { text-shadow: 0 0 30px rgba(180, 140, 255, 0.2); }
    50% { text-shadow: 0 0 50px rgba(180, 140, 255, 0.5), 0 0 80px rgba(140, 100, 220, 0.2); }
  }

  .cel-oracle {
    text-align: center;
    color: #706888;
    font-size: 0.75rem;
    letter-spacing: 0.35em;
    line-height: 1.3;
    margin-bottom: 1.8rem;
  }

  .cel-oracle p {
    margin: 0;
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
    overflow: visible;
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
    transition: background 0.25s ease, border-color 0.25s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    padding-bottom: 0.6rem;
    position: relative;
    contain: layout style;
  }

  .cel-key::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: 0 0 16px currentColor;
    opacity: var(--glow-opacity, 0);
    color: var(--glow-hue, transparent);
    pointer-events: none;
    will-change: opacity;
  }

  .cel-key:active {
    transform: scale(0.97);
  }

  .cel-key-natural {
    position: relative;
    flex: 1;
    height: 100%;
    background: #161616;
    border: 1px solid rgba(180, 140, 255, 0.12);
    border-radius: 0 0 8px 8px;
    z-index: 1;
  }

  .cel-key-natural:hover {
    background: #19162f;
    border-color: rgba(180, 140, 255, 0.3);
  }

  .cel-key-sharp {
    position: absolute;
    top: 0;
    width: 9%;
    height: 58%;
    background: #1d0f38;
    border: 1px solid rgba(180, 140, 255, 0.25);
    border-radius: 0 0 6px 6px;
    z-index: 2;
    padding-bottom: 0.4rem;
  }

  .cel-key-sharp:hover {
    background: #301a4e;
    border-color: rgba(180, 140, 255, 0.45);
  }

  .cel-key-active.cel-key-natural {
    background: #221a3a;
    border-color: rgba(180, 140, 255, 0.55);
  }

  .cel-key-active.cel-key-natural:hover {
    background: #2c2046;
    border-color: rgba(180, 140, 255, 0.65);
  }

  .cel-key-active.cel-key-sharp {
    background: #4e288a;
    border-color: rgba(200, 160, 255, 0.6);
  }

  .cel-key-active.cel-key-sharp:hover {
    background: #6032a0;
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

  /* ── Eclipse mode ─────────────────────────────────────── */

  .cel-eclipse-active .cel-key::before {
    box-shadow: 0 0 20px currentColor, 0 0 40px currentColor;
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
    justify-content: center;
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

  /* ── Macro Knobs ───────────────────────────────────── */

  .cel-macros {
    display: flex;
    gap: 1rem;
    justify-content: center;
    max-width: 480px;
    width: 100%;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
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

  .cel-knob-value-arc {
    fill: none;
    stroke: var(--knob-accent, #9070cc);
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke 0.4s ease-out;
  }

  .cel-knob-pointer {
    fill: var(--knob-accent, #b490e8);
    transition: fill 0.4s ease-out;
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
