// ═══════════════════════════════════════════════════════════════
// CELESTIAL PAD v13 — Per-Sign Character · Adaptive Voicing
//
// ─── ARCHITECTURE OVERVIEW ──────────────────────────────────
//
// 12 Tone.PolySynth instances (2-voice polyphony each), one per
// zodiac sign. Each sign's oscillator type is determined by its
// ruling planet via PLANETARY_CHARACTER (fat/AM/FM variants).
// SIGN_CHARACTER merges SIGNS + PLANETARY_CHARACTER at init:
//   PolySynth (per-sign oscType, multiplied ADSR envelope)
//     → Panner (fixed stereo base + LFO drift per pan group)
//       → sumBus (Gain node — all voices merge here)
//
// The sumBus feeds a serial FX chain ending at destination.
// Voices summing BEFORE saturation is intentional — Chebyshev
// waveshaping on a polyphonic sum creates intermodulation
// distortion (sum/difference tones between partials). This is
// what gives the pad its FM-like shimmer and harmonic density.
//
// ─── PLANETARY CHARACTER ──────────────────────────────────
//
// Each sign inherits its ruling planet's sonic personality:
//   oscType     — fat (count/spread), AM, or FM variant
//   ADSR muls   — orbital speed ↔ envelope speed
//
// 5 fat-type signs (Leo, Aries, Scorpio, Taurus, Libra) support
// oscCount/spread and Eclipse spread ramp. 3 AM signs (Cancer,
// Sagittarius, Pisces) and 4 FM signs (Gemini, Virgo, Capricorn,
// Aquarius) skip spread — they drift via detune only.
//
// Envelope knobs set a base value; each sign applies its planetary
// multiplier. Mars signs attack in ~60% of base time, Saturn in
// ~150%. Inner-planet voices arrive first — orbital speed = sonic.
//
// ─── FX CHAIN (configurable — see tuning.js CHAINS) ──────
//
// Active default: "Zodiac"
//   sumBus → Vibrato → Echo(CrossFade) → EQ3 → Chebyshev
//     → [Distortion] → Freeverb → Chorus → [Phaser]
//     → MonitorEQ → tanh soft clip → destination
//
// ─── ADAPTIVE VOICING ─────────────────────────────────────
//
// Polyphonic gain compensation: boost = 5 × log10(12 / active).
// 12 voices = 0dB, 6 = +1.5dB, 3 = +3dB, 1 = +5.4dB.
// Applied in toggleSign (before triggerAttack), playNatalChart,
// and breathe. Stacks with OCTAVE_GAIN (Fletcher-Munson).
// NOT applied in randomize (chaotic by design).
//
// ─── STATE MODEL ────────────────────────────────────────────
//
// engineRef      — Tone.js audio graph, created on first interaction.
//                  Null until user clicks (browser autoplay policy).
// activeSigns    — Set<string> of currently sounding sign names.
// params         — Object of 35 direct knob values. Each knob maps
//                  1:1 to an engine parameter via KNOB_MAP. Shadow
//                  mode temporarily overrides FX params; when Shadow
//                  disengages, param values are restored.
// oscIndex       — null | 0–7. null = per-sign planetary defaults.
//                  Breathe cycles: null → 0 → ... → 7 → null → ...
//                  When 0–7, all synths share that OSC_TYPES entry.
// shadow         — Boolean. Shadow/Eclipse mode active. Ramps FX
//                  params toward chaos targets over rampTime seconds.
//
// ─── CONTROLS ───────────────────────────────────────────────
//
// Piano keyboard — Toggle individual planet voices on/off.
// Eclipse        — Chaos mode. Ramps all FX toward extreme values,
//                  widens osc spread (fat types only), randomizes
//                  detune. Toggle off restores saved param values.
// Breathe        — Cycles oscillator type: per-sign → fatsine →
//                  amsine → ... → fatsquare → per-sign. Releases
//                  active voices first, then switches. On per-sign,
//                  each sign uses its planetary default.
// Oracle dots    — Pyramid of dots below controls row. Clicking
//                  opens the Controls veil (knobs, listen, randomize).
//                  Discoverable, not advertised.
// Listen pills   — Monitor EQ presets for different playback devices.
// Knobs          — 35 direct SVG arc knobs, grouped by function.
//                  Each maps 1:1 to an engine parameter. Double-click
//                  resets to default. Shift+drag for fine control.
//                  Envelope knobs apply per-sign multipliers.
// Natal Chart    — Enter birth data, compute planetary positions via
//                  circular-natal-horoscope-js, remap voice pitches
//                  to zodiac-derived notes.
//
// ═══════════════════════════════════════════════════════════════

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import * as Tone from "tone";
import { Origin, Horoscope } from "circular-natal-horoscope-js";
import {
  TUNING,
  SHADOW,
  KNOB_DEFS,
  KNOB_GROUPS,
  CHAINS,
  ACTIVE_CHAIN,
  LISTEN_PRESETS,
  OSC_TYPES,
  OCTAVE_GAIN,
  PLANETARY_CHARACTER,
  SIGN_RULERS,
  NATAL_COMP,
  composeNatalSchedule,
} from "./tuning";

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

// 12 zodiac signs — chromatic mapping C through B.
// Each carries: note class, microtonal detune from 12-TET (cents),
// octave, velocity (mix weight), glyph, fixed stereo base,
// pan group, osc count, osc spread.
// Octave spread: dim7 partitioning — C/Eb/Gb/A in oct 3, D/F/Ab/B in oct 4,
// Db/E/G/Bb in oct 5. No semitone adjacencies within any octave.
// Velocity: luminary-ruled signs (Leo/Cancer) lead, personal planet signs mid,
// social planet signs (Jupiter/Saturn) form the harmonic bed.
// Detune: Cousto planetary frequencies at 50% strength — authentic color
// without quarter-tone shock. Signs sharing a ruler share the same offset.
const SIGNS = {
  Aquarius: {
    octave: 3,
    vel: 0.33,
    glyph: "\u2652\uFE0E",
    note: "C",
    detuneCents: 6, // Saturn ×0.5
    panBase: -0.7,
    panGroup: "A",
    oscCount: 2,
    oscSpread: 5,
  },
  Pisces: {
    octave: 5,
    vel: 0.38,
    glyph: "\u2653\uFE0E",
    note: "Db",
    detuneCents: -6.5, // Jupiter ×0.5
    panBase: 0.65,
    panGroup: "D",
    oscCount: 3,
    oscSpread: 12,
  },
  Aries: {
    octave: 4,
    vel: 0.52,
    glyph: "\u2648\uFE0E",
    note: "D",
    detuneCents: -12.5, // Mars ×0.5
    panBase: -0.4,
    panGroup: "B",
    oscCount: 2,
    oscSpread: 8,
  },
  Taurus: {
    octave: 3,
    vel: 0.5,
    glyph: "\u2649\uFE0E",
    note: "Eb",
    detuneCents: 5, // Venus ×0.5
    panBase: 0.55,
    panGroup: "C",
    oscCount: 2,
    oscSpread: 5,
  },
  Gemini: {
    octave: 5,
    vel: 0.48,
    glyph: "\u264A\uFE0E",
    note: "E",
    detuneCents: 16.5, // Mercury ×0.5
    panBase: -0.3,
    panGroup: "B",
    oscCount: 3,
    oscSpread: 12,
  },
  Cancer: {
    octave: 4,
    vel: 0.6,
    glyph: "\u264B\uFE0E",
    note: "F",
    detuneCents: 11.5, // Moon ×0.5
    panBase: 0.7,
    panGroup: "D",
    oscCount: 2,
    oscSpread: 8,
  },
  Leo: {
    octave: 3,
    vel: 0.65,
    glyph: "\u264C\uFE0E",
    note: "Gb",
    detuneCents: 19, // Sun ×0.5
    panBase: 0.1,
    panGroup: "B",
    oscCount: 2,
    oscSpread: 5,
  },
  Virgo: {
    octave: 5,
    vel: 0.45,
    glyph: "\u264D\uFE0E",
    note: "G",
    detuneCents: 16.5, // Mercury ×0.5
    panBase: -0.6,
    panGroup: "A",
    oscCount: 3,
    oscSpread: 12,
  },
  Libra: {
    octave: 4,
    vel: 0.47,
    glyph: "\u264E\uFE0E",
    note: "Ab",
    detuneCents: 5, // Venus ×0.5
    panBase: 0.35,
    panGroup: "C",
    oscCount: 2,
    oscSpread: 8,
  },
  Scorpio: {
    octave: 3,
    vel: 0.48,
    glyph: "\u264F\uFE0E",
    note: "A",
    detuneCents: -12.5, // Mars ×0.5
    panBase: -0.2,
    panGroup: "C",
    oscCount: 2,
    oscSpread: 5,
  },
  Sagittarius: {
    octave: 5,
    vel: 0.4,
    glyph: "\u2650\uFE0E",
    note: "Bb",
    detuneCents: -6.5, // Jupiter ×0.5
    panBase: 0.15,
    panGroup: "D",
    oscCount: 3,
    oscSpread: 12,
  },
  Capricorn: {
    octave: 4,
    vel: 0.35,
    glyph: "\u2651\uFE0E",
    note: "B",
    detuneCents: 6, // Saturn ×0.5
    panBase: -0.55,
    panGroup: "A",
    oscCount: 2,
    oscSpread: 8,
  },
};

// Merge planetary character into sign config — all engine code reads from this.
const SIGN_CHARACTER = Object.fromEntries(
  Object.entries(SIGNS).map(([name, cfg]) => [
    name,
    { ...cfg, ...PLANETARY_CHARACTER[SIGN_RULERS[name]] },
  ]),
);

// Adaptive voicing: boost gain when fewer voices are active.
// Formula: 5 × log10(12 / activeCount) dB
// 12 voices: 0dB, 6: +1.5dB, 3: +3dB, 1: +5.4dB
function applyAdaptiveVoicing(eng, activeCount) {
  const boost =
    activeCount > 0 ? 5 * Math.log10(12 / Math.max(1, activeCount)) : 0;
  Object.entries(eng.synths).forEach(([name, synth]) => {
    synth.set({
      volume: -9 + (OCTAVE_GAIN[SIGN_CHARACTER[name].octave] || 0) + boost,
    });
  });
}

const SIGN_COLORS = {
  Aquarius: ["#3f575a", "#688a8d", "#95bbbe", "#d0ecf0", "#0c0c0c"],
  Pisces: ["#657ba5", "#7495bf", "#4e5d74", "#779ebf", "#0c0c0c"],
  Aries: ["#dabd9d", "#8c5c4a", "#f27b5f", "#c26d5c", "#0c0c0c"],
  Taurus: ["#878a8d", "#d9b292", "#f4dbc4", "#414141", "#0c0c0c"],
  Gemini: ["#595856", "#c0bdbc", "#8d8a88", "#f5f6f7", "#0c0c0c"],
  Cancer: ["#c0c0c8", "#8888a0", "#e8e8f0", "#606078", "#0c0c0c"],
  Leo: ["#f28320", "#f15d22", "#d94126", "#a41d21", "#0c0c0c"],
  Virgo: ["#8d8a88", "#595856", "#c0bdbc", "#f5f6f7", "#0c0c0c"],
  Libra: ["#d9b292", "#878a8d", "#f4dbc4", "#414141", "#0c0c0c"],
  Scorpio: ["#4a3a5c", "#7b6898", "#a08cb8", "#c8b8d8", "#0c0c0c"],
  Sagittarius: ["#282311", "#c08237", "#bfaf9b", "#c0a480", "#0c0c0c"],
  Capricorn: ["#8b7355", "#c4a96d", "#e0c98f", "#5a4a32", "#0c0c0c"],
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

const VIS_SPEED = 0.65; // visual envelope runs ~35% faster than audio
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

const KEYBOARD_ORDER = Object.keys(SIGNS);
const SHARP_INDICES = new Set([1, 3, 6, 8, 10]);
const SHARP_POSITIONS = ["10%", "24%", "53%", "67%", "81%"];
// OSC_TYPES imported from tuning.js — 8 types cycled by Breathe

// ─── Knob Mapping ────────────────────────────────────────────

const KNOB_MAP = {
  // Voice
  attack: {
    apply: (eng, v) => {
      Object.entries(eng.synths).forEach(([name, s]) => {
        s.set({ envelope: { attack: v * SIGN_CHARACTER[name].attackMul } });
      });
    },
  },
  decay: {
    apply: (eng, v) => {
      Object.entries(eng.synths).forEach(([name, s]) => {
        s.set({ envelope: { decay: v * SIGN_CHARACTER[name].decayMul } });
      });
    },
  },
  sustain: {
    apply: (eng, v) => {
      Object.entries(eng.synths).forEach(([name, s]) => {
        s.set({
          envelope: {
            sustain: Math.min(1, v * SIGN_CHARACTER[name].sustainMul),
          },
        });
      });
    },
  },
  release: {
    apply: (eng, v) => {
      Object.entries(eng.synths).forEach(([name, s]) => {
        s.set({ envelope: { release: v * SIGN_CHARACTER[name].releaseMul } });
      });
    },
  },
  // Grit
  chebyWet: {
    apply: (eng, v) => {
      eng.fx.chebyshev.wet.value = v;
    },
  },
  chebyOrder: {
    apply: (eng, v) => {
      eng.fx.chebyshev.order = v;
    },
  },
  // EQ
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
  // Vibrato
  vibratoFreq: {
    apply: (eng, v) => {
      eng.fx.vibrato.frequency.value = v;
    },
  },
  vibratoDepth: {
    apply: (eng, v) => {
      eng.fx.vibrato.depth.value = v;
    },
  },
  vibratoWet: {
    apply: (eng, v) => {
      eng.fx.vibrato.wet.value = v;
    },
  },
  // Delay (all ramped — prevents Doppler artifacts + feedback runaway)
  delayTime: {
    apply: (eng, v) => {
      const p = eng.fx.echoDelay.delayTime;
      p.cancelAndHoldAtTime(Tone.now());
      p.rampTo(v, 0.15);
    },
  },
  delayFeedback: {
    apply: (eng, v) => {
      const p = eng.fx.echoFeedbackGain.gain;
      p.cancelAndHoldAtTime(Tone.now());
      p.rampTo(v, 0.08);
    },
  },
  delayWet: {
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
  reverbWet: {
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
  panLfoFreq: {
    apply: (eng, v) => {
      Object.values(eng.panLfos).forEach((l) => {
        l.frequency.value = v;
      });
    },
  },
  panLfoAmplitude: {
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
  phaserWet: {
    apply: (eng, v) => {
      eng.fx.phaser.wet.value = v;
      eng.setBypass("phaser", v === 0);
    },
  },
  // Chorus
  chorusWet: {
    apply: (eng, v) => {
      eng.fx.chorus.wet.value = v;
    },
  },
  chorusFreq: {
    apply: (eng, v) => {
      eng.fx.chorus.frequency.value = v;
    },
  },
  chorusDelay: {
    apply: (eng, v) => {
      eng.fx.chorus.delayTime = v;
    },
  },
  chorusDepth: {
    apply: (eng, v) => {
      eng.fx.chorus.depth = v;
    },
  },
  // Saturate
  distortion: {
    apply: (eng, v) => {
      eng.fx.distortion.distortion = v;
    },
  },
  distortionWet: {
    apply: (eng, v) => {
      eng.fx.distortion.wet.value = v;
      eng.setBypass("distortion", v === 0);
    },
  },
  // EQ high frequency
  eqHighFreq: {
    apply: (eng, v) => {
      eng.fx.eq3.highFrequency.value = v;
    },
  },
};

function formatValue(value, def) {
  const u = def.unit || "";
  if (def.scale === "step") return String(Math.round(value));
  if (u === "dB") return `${value > 0 ? "+" : ""}${value.toFixed(0)}`;
  if (u === "Hz")
    return value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : `${value.toFixed(0)}`;
  if (u === "s")
    return value < 1
      ? `${(value * 1000).toFixed(0)}ms`
      : `${value.toFixed(1)}s`;
  if (u === "ms") return `${value.toFixed(0)}ms`;
  if (u === "%") return `${(value * 100).toFixed(0)}%`;
  return value.toFixed(2);
}

// Log/step scale mappers — pure functions, hoisted for stable references
const logMap = (min, max) => ({
  mapFromNorm: (n) => min * Math.pow(max / min, n),
  mapToNorm: (v) => Math.log(v / min) / Math.log(max / min),
});
const stepMap = (min, max) => ({
  mapFromNorm: (n) => Math.round(min + n * (max - min)),
  mapToNorm: (v) => (v - min) / (max - min),
});

// ─── SVG Arc Knob Geometry (hoisted — computed once) ─────────

const DEG_TO_RAD = Math.PI / 180;
const KNOB_R = 22,
  KNOB_CX = 28,
  KNOB_CY = 28;
const KNOB_START = -135,
  KNOB_END = 135,
  KNOB_SWEEP = 270;

const arcPoint = (angle) => ({
  x: KNOB_CX + KNOB_R * Math.cos((angle - 90) * DEG_TO_RAD),
  y: KNOB_CY + KNOB_R * Math.sin((angle - 90) * DEG_TO_RAD),
});

const describeArc = (start, end) => {
  const s = arcPoint(start);
  const e = arcPoint(end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${KNOB_R} ${KNOB_R} 0 ${large} 1 ${e.x} ${e.y}`;
};

const KNOB_TRACK_PATH = describeArc(KNOB_START, KNOB_END);

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

  const norm = mapToNorm ? mapToNorm(value) : (value - min) / (max - min);
  const clampedNorm = Math.max(0, Math.min(1, norm));
  const valueAngle = KNOB_START + clampedNorm * KNOB_SWEEP;

  const valuePath =
    clampedNorm > 0.003 ? describeArc(KNOB_START, valueAngle) : "";
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
        width="56"
        height="56"
        className="cel-knob-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <path
          d={KNOB_TRACK_PATH}
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
          cx={KNOB_CX}
          cy={KNOB_CY}
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

let _enginePromise = null; // creation lock — prevents duplicate contexts

async function createEngine() {
  // iOS: route through media channel — bypasses mute switch (iOS 17+)
  if ("audioSession" in navigator) {
    navigator.audioSession.type = "playback";
  }

  const ctx = new Tone.Context({
    latencyHint: "playback",
    sampleRate: TUNING.sampleRate,
    lookAhead: 0.2,
    updateInterval: 0.1,
  });
  Tone.setContext(ctx);
  await Tone.start();
  // Belt-and-suspenders: wait for the raw AudioContext to actually resume
  if (ctx.rawContext.state !== "running") {
    await ctx.rawContext.resume();
  }

  // iOS: silent keepalive prevents context suspension on lock/background.
  // Pre-iOS 17 fallback for mute switch bypass (inaudible at 1e-37 gain).
  const keepAlive = ctx.rawContext.createOscillator();
  const muteGain = ctx.rawContext.createGain();
  muteGain.gain.value = 1e-37;
  keepAlive.connect(muteGain);
  muteGain.connect(ctx.rawContext.destination);
  keepAlive.start();

  // ─── FX chain (constructed before synths so panners have a target) ───

  const chebyshev = new Tone.Chebyshev(TUNING.chebyOrder);
  chebyshev.wet.value = TUNING.chebyWet;
  chebyshev.oversample = "2x";

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

  const reverbPreDelay = new Tone.Delay({ delayTime: 0.025, maxDelay: 0.1 });
  reverbPreDelay.connect(reverb);

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
    frequency: TUNING.chorusFreq,
    delayTime: TUNING.chorusDelay,
    depth: TUNING.chorusDepth,
  });
  chorus.wet.value = TUNING.chorusWet;

  const distortion = new Tone.Distortion({
    distortion: TUNING.distortion,
    oversample: "2x",
  });
  distortion.wet.value = TUNING.distortionWet;

  // tanh soft clip — preserves Freeverb resonant peaks that Limiter(-1) killed
  const softClip = new Tone.WaveShaper((val) => Math.tanh(val), 4096);
  softClip.oversample = "none";

  // Summing bus — all panners feed here so voices intermodulate through Chebyshev
  const sumBus = new Tone.Gain(1);

  const highpass = new Tone.Filter({
    frequency: TUNING.highpassFreq,
    type: "highpass",
    rolloff: TUNING.highpassRolloff,
  });
  sumBus.connect(highpass);

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
    chebyshev,
    eq3,
    vibrato,
    reverb: reverbPreDelay, // chain sees this as "reverb" node, pre-delay feeds actual reverb
    chorus,
    monitorEQ,
    softClip,
    phaser,
    distortion,
    echoCrossfade,
    echoDelay,
    echoInputGain,
  };
  const { bypassState, bypassable } = wireChain(
    highpass,
    chainNodes,
    CHAINS[ACTIVE_CHAIN],
  );

  function setBypass(name, bypassed) {
    if (bypassState[name] === bypassed) return;
    const b = bypassable[name];
    try {
      if (bypassed) {
        if (b.node.wet) {
          b.node.wet.rampTo(0, 0.05);
          setTimeout(() => {
            try {
              b.prev.disconnect(b.node);
              b.node.disconnect(b.next);
              b.prev.connect(b.next);
            } catch (e) {
              /* ignore */
            }
          }, 60);
        } else {
          b.prev.disconnect(b.node);
          b.node.disconnect(b.next);
          b.prev.connect(b.next);
        }
      } else {
        b.prev.disconnect(b.next);
        b.prev.connect(b.node);
        b.node.connect(b.next);
        if (b.node.wet) b.node.wet.rampTo(b.node.wet.value || 1, 0.05);
      }
      bypassState[name] = bypassed;
    } catch (e) {
      /* ignore */
    }
  }

  // ─── Per-sign synths + panners ──────────────────────────

  const synths = {};
  const panners = {};
  const spreadTracker = {};

  Object.entries(SIGN_CHARACTER).forEach(([name, cfg]) => {
    const panner = new Tone.Panner(cfg.panBase);
    const synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 2,
      voice: Tone.Synth,
      options: {
        oscillator: {
          type: cfg.oscType,
          ...(cfg.oscType.startsWith("fat")
            ? { count: cfg.oscCount, spread: cfg.oscSpread }
            : {}),
        },
        envelope: {
          attack: TUNING.attack * cfg.attackMul,
          decay: TUNING.decay * cfg.decayMul,
          sustain: Math.min(1, TUNING.sustain * cfg.sustainMul),
          release: TUNING.release * cfg.releaseMul,
        },
        volume: -9 + (OCTAVE_GAIN[cfg.octave] || 0),
      },
    });
    synth.set({ detune: cfg.detuneCents });
    synth.connect(panner);
    panner.connect(sumBus);
    synths[name] = synth;
    panners[name] = panner;
    spreadTracker[name] = cfg.oscSpread;
  });

  const detuneTracker = Object.fromEntries(
    Object.keys(SIGN_CHARACTER).map((s) => [s, SIGN_CHARACTER[s].detuneCents]),
  );

  // ─── Group LFOs — one per panGroup, drift all panners in that group ──

  const panLfos = {};
  ["A", "B", "C", "D"].forEach((group) => {
    const lfo = new Tone.LFO({ frequency: TUNING.panLfoFreq, min: -1, max: 1 });
    lfo.amplitude.value = TUNING.panLfoAmplitude;
    lfo.start();
    Object.entries(SIGN_CHARACTER).forEach(([name, cfg]) => {
      if (cfg.panGroup === group) lfo.connect(panners[name].pan);
    });
    panLfos[group] = lfo;
  });

  return {
    synths,
    panners,
    panLfos,
    spreadTracker,
    detuneTracker,
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
        highpass,
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
        reverbPreDelay,
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
  const [activeSigns, setActiveSigns] = useState(new Set());
  const [shadow, setShadow] = useState(false);
  const [oscIndex, setOscIndex] = useState(null);
  const [listenPreset, setListenPreset] = useState("headphones");
  const shadowIntervalsRef = useRef([]);
  const visualStateRef = useRef({});
  const keyRefsRef = useRef({});
  const rootRef = useRef(null);
  const emanationRef = useRef(null);
  const shadowRef = useRef(false);
  const pendingOscTypeRef = useRef(null);
  const activeOscTypeRef = useRef(null);
  const canvasCtxRef = useRef(null);
  const rafIdRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const keyPositionsRef = useRef({});
  const startLoopRef = useRef(null);
  const lastGlowRef = useRef({});
  const lastAccentRef = useRef(null);
  const colorIndexRef = useRef({});
  const [natalMode, setNatalMode] = useState(false);
  const [natalDate, setNatalDate] = useState("1990-06-15");
  const [natalTime, setNatalTime] = useState("14:30");
  const [natalLat, setNatalLat] = useState("40.7128");
  const [natalLng, setNatalLng] = useState("-74.0060");
  const [natalActivations, setNatalActivations] = useState({});
  const initParams = () =>
    Object.fromEntries(
      Object.entries(KNOB_DEFS).map(([k, d]) => [k, d.default]),
    );
  const [params, setParams] = useState(initParams);
  const renderThrottleRef = useRef(0);
  const trailingRenderRef = useRef(null);
  const gradientsRef = useRef([]);
  const paramsRef = useRef(initParams());
  const natalChartDataRef = useRef(null);
  const natalTimeoutIdsRef = useRef([]);
  const natalPulseIdsRef = useRef([]);

  const setParam = useCallback((name, value) => {
    const p = paramsRef.current;
    p[name] = value;
    const eng = engineRef.current;
    if (eng) KNOB_MAP[name]?.apply(eng, value);

    clearTimeout(trailingRenderRef.current);
    const now = performance.now();
    if (now - renderThrottleRef.current > 50) {
      renderThrottleRef.current = now;
      setParams({ ...p });
    } else {
      trailingRenderRef.current = setTimeout(() => {
        setParams({ ...paramsRef.current });
      }, 60);
    }
  }, []);

  // Stable callbacks — one per param, never re-created
  const paramSetters = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(KNOB_DEFS).map((name) => [name, (v) => setParam(name, v)]),
      ),
    [setParam],
  );

  const randomizeParams = useCallback(() => {
    const eng = engineRef.current;
    const newParams = {};
    for (const [name, def] of Object.entries(KNOB_DEFS)) {
      const norm = Math.random();
      const props =
        def.scale === "log"
          ? logMap(def.min, def.max)
          : def.scale === "step"
            ? stepMap(def.min, def.max)
            : null;
      const value = props
        ? props.mapFromNorm(norm)
        : def.min + norm * (def.max - def.min);
      newParams[name] = value;
      if (eng) KNOB_MAP[name]?.apply(eng, value);
    }
    paramsRef.current = newParams;
    setParams(newParams);
  }, []);

  // Pre-computed format functions — stable references for React.memo
  const formatFns = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(KNOB_DEFS).map(([name, def]) => [
          name,
          (v) => formatValue(v, def),
        ]),
      ),
    [],
  );

  // Pre-computed grouped knobs with row support for side-by-side pairs
  const groupedKnobs = useMemo(() => {
    const groups = KNOB_GROUPS.map(({ key, label, row }) => ({
      key,
      label,
      row,
      knobs: Object.entries(KNOB_DEFS).filter(([_, d]) => d.group === key),
    }));
    const result = [];
    const seen = new Set();
    for (const g of groups) {
      if (seen.has(g.key)) continue;
      seen.add(g.key);
      if (g.row != null) {
        const partners = groups.filter(
          (x) => x.row === g.row && !seen.has(x.key),
        );
        partners.forEach((p) => seen.add(p.key));
        result.push({ type: "row", groups: [g, ...partners] });
      } else {
        result.push({ type: "single", ...g });
      }
    }
    return result;
  }, []);

  const knobScaleProps = useMemo(() => {
    const props = {};
    for (const [name, def] of Object.entries(KNOB_DEFS)) {
      props[name] =
        def.scale === "log"
          ? logMap(def.min, def.max)
          : def.scale === "step"
            ? stepMap(def.min, def.max)
            : {};
    }
    return props;
  }, []);

  useEffect(() => {
    return () => {
      shadowIntervalsRef.current.forEach((id) => Tone.Transport.clear(id));
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    shadowRef.current = shadow;
  }, [shadow]);

  // ─── iOS audio lifecycle recovery ─────────────────────────────
  // Handles: interrupted state (phone call, Siri, notifications),
  // tab backgrounding, screen lock, bfcache restore.
  useEffect(() => {
    const tryResume = async () => {
      try {
        if (Tone.getContext()?.rawContext?.state !== "running") {
          await Tone.start();
          const raw = Tone.getContext()?.rawContext;
          if (raw && raw.state !== "running") await raw.resume();
        }
      } catch (_) {}
    };

    // Resume on tab/app restore
    const onVisibility = () => {
      if (!document.hidden) tryResume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Resume on any touch (catches interrupted state after phone calls)
    const onTouch = () => tryResume();
    document.addEventListener("touchend", onTouch, { passive: true });

    // Handle bfcache restore (user hits back)
    const onPageShow = (e) => {
      if (e.persisted) tryResume();
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("touchend", onTouch);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // ─── Position cache (eliminates getBoundingClientRect in rAF) ──
  useEffect(() => {
    const updatePositions = () => {
      const rootEl = rootRef.current;
      if (!rootEl) return;
      const rr = rootEl.getBoundingClientRect();
      const positions = {};
      for (const sign of KEYBOARD_ORDER) {
        const el = keyRefsRef.current[sign];
        if (el) {
          const kr = el.getBoundingClientRect();
          positions[sign] = {
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
      if (now - lastFrameTimeRef.current < 33) {
        requestAnimationFrame(tick);
        return;
      }
      lastFrameTimeRef.current = now;

      let blendR = 0,
        blendG = 0,
        blendB = 0,
        totalWeight = 0;
      const gradients = gradientsRef.current;
      gradients.length = 0;
      let hasActive = false;

      for (const sign in visualStateRef.current) {
        const vs = visualStateRef.current[sign];
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
        const glowAlpha = level > 0.01 ? Math.min(level * 0.7, 0.45) : 0;
        const el = keyRefsRef.current[sign];
        if (el) {
          const prevGlow = lastGlowRef.current[sign];
          if (prevGlow !== glowAlpha) {
            el.style.setProperty(
              "--glow-hue",
              glowAlpha > 0 ? `rgb(${r},${g},${b})` : "transparent",
            );
            el.style.setProperty("--glow-opacity", String(glowAlpha));
            lastGlowRef.current[sign] = glowAlpha;
          }
        }

        // Emanation — push data for canvas draw (no strings, no getBoundingClientRect)
        const pos = keyPositionsRef.current[sign];
        if (pos && level > 0.01) {
          gradients.push({
            cx: pos.cx,
            cy: pos.cy,
            r,
            g,
            b,
            alpha: level * 0.38,
            falloff: shadowRef.current ? 95 : 78,
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
            lastGlowRef.current[sign] = 0;
          }
          visualStateRef.current[sign] = null; // preserve V8 hidden class
        }
      }

      // Canvas emanation — single GPU-composited draw
      const canvas = emanationRef.current;
      const ctx = canvasCtxRef.current;
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (gradients.length > 0) {
          for (const gd of gradients) {
            const radius = ((canvas.height * gd.falloff) / 100) | 0;
            const cx = gd.cx | 0,
              cy = gd.cy | 0;
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            grad.addColorStop(0, `rgba(${gd.r},${gd.g},${gd.b},${gd.alpha})`);
            grad.addColorStop(1, `rgba(${gd.r},${gd.g},${gd.b},0)`);
            ctx.fillStyle = grad;
            ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
          }
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
    if (engineRef.current) return engineRef.current;
    // Serialize creation — all concurrent callers share one promise
    if (!_enginePromise) {
      _enginePromise = createEngine().then((eng) => {
        for (const [name, def] of Object.entries(KNOB_DEFS)) {
          KNOB_MAP[name]?.apply(eng, def.default);
        }
        engineRef.current = eng;
        setStatus("ready");
        return eng;
      });
    }
    return _enginePromise;
  }, []);

  // Apply pending osc type from breathe — used in toggleSign + playNatalChart
  function applyPendingOscType(eng) {
    const t = pendingOscTypeRef.current;
    if (!t) return;
    if (t === "per-sign") {
      Object.entries(eng.synths).forEach(([name, s]) => {
        const sc = SIGN_CHARACTER[name];
        s.set({ oscillator: { type: sc.oscType } });
        if (sc.oscType.startsWith("fat")) {
          s.set({ oscillator: { count: sc.oscCount, spread: sc.oscSpread } });
          eng.spreadTracker[name] = sc.oscSpread;
        }
      });
    } else {
      const isFat = t.startsWith("fat");
      Object.entries(eng.synths).forEach(([name, s]) => {
        s.set({ oscillator: { type: t } });
        if (isFat) {
          s.set({
            oscillator: {
              count: SIGN_CHARACTER[name].oscCount,
              spread: SIGN_CHARACTER[name].oscSpread,
            },
          });
          eng.spreadTracker[name] = SIGN_CHARACTER[name].oscSpread;
        }
      });
    }
    pendingOscTypeRef.current = null;
  }

  // Restore spread + detune to per-sign defaults (Eclipse exit, Breathe shadow cleanup, toggleShadow exit)
  function restoreSpreadAndDetune(eng) {
    Object.entries(eng.synths).forEach(([name, synth]) => {
      const sc = SIGN_CHARACTER[name];
      const signType = activeOscTypeRef.current ?? sc.oscType;
      if (signType.startsWith("fat")) {
        synth.set({ oscillator: { spread: sc.oscSpread } });
        eng.spreadTracker[name] = sc.oscSpread;
      }
      synth.set({ detune: sc.detuneCents });
      eng.detuneTracker[name] = sc.detuneCents;
    });
  }

  const toggleSign = useCallback(
    async (sign) => {
      const eng = await ensureEngine();
      const cfg = SIGN_CHARACTER[sign];
      if (!cfg) return;
      const note = `${cfg.note}${cfg.octave}`;
      const p = paramsRef.current || initParams();
      const attack = p.attack;
      const decay = p.decay;
      const sustain = p.sustain;
      const release = p.release;
      setActiveSigns((prev) => {
        const next = new Set(prev);
        if (next.has(sign)) {
          eng.synths[sign].triggerRelease(note, Tone.now());
          eng.synths[sign].set({ detune: cfg.detuneCents });
          next.delete(sign);
          const vs = visualStateRef.current[sign];
          if (vs) {
            vs.releaseStartLevel = vs.envelopeLevel;
            vs.stage = "release";
            vs.startTime = performance.now();
            vs.releaseTime = release * cfg.releaseMul;
          }
          applyAdaptiveVoicing(eng, next.size);
        } else {
          applyPendingOscType(eng);
          if (natalMode && natalActivations[sign]) {
            eng.synths[sign].set({
              detune: natalActivations[sign].detuneCents,
            });
          }
          applyAdaptiveVoicing(eng, next.size + 1);
          eng.synths[sign].triggerAttack(note, Tone.now(), cfg.vel);
          next.add(sign);
          const pal = SIGN_COLORS[sign];
          const ci = colorIndexRef.current[sign] || 0;
          colorIndexRef.current[sign] = (ci + 1) % 4;
          visualStateRef.current[sign] = {
            stage: "attack",
            startTime: performance.now(),
            envelopeLevel: 0,
            attackTime: attack * cfg.attackMul * VIS_SPEED,
            decayTime: decay * cfg.decayMul * VIS_SPEED,
            sustainLevel: Math.min(1, sustain * cfg.sustainMul),
            releaseTime: release * cfg.releaseMul * VIS_SPEED,
            releaseStartLevel: 0,
            activeColor: pal ? hexToRgb(pal[ci]) : [144, 112, 204],
          };
          if (startLoopRef.current) startLoopRef.current();
        }
        setStatus(next.size > 0 ? "playing" : "ready");
        return next;
      });
    },
    [ensureEngine, natalMode, natalActivations],
  );

  const stopNatalPlayback = useCallback((eng) => {
    // Cancel pending entry timeouts
    natalTimeoutIdsRef.current.forEach(id => clearTimeout(id));
    natalTimeoutIdsRef.current = [];

    // Cancel pulse patterns
    natalPulseIdsRef.current.forEach(({ sign, eventId }) => {
      Tone.Transport.clear(eventId);
    });
    natalPulseIdsRef.current = [];

    // Release all voices
    Object.values(eng.synths).forEach(s => s.releaseAll(Tone.now()));

    // Restore reverb wet (may have been ramped for finale bloom)
    const saved = paramsRef.current || initParams();
    eng.fx.reverb.wet.rampTo(saved.reverbWet, 0.5);

    // Restore all envelopes (pulse voices had compressed/clamped ADSR)
    Object.entries(eng.synths).forEach(([name, synth]) => {
      const cfg = SIGN_CHARACTER[name];
      synth.set({
        envelope: {
          attack:  saved.attack * cfg.attackMul,
          decay:   saved.decay * cfg.decayMul,
          sustain: saved.sustain * cfg.sustainMul,
          release: saved.release * cfg.releaseMul,
        },
      });
    });
  }, []);

  const breathe = useCallback(async () => {
    const eng = await ensureEngine();
    // Stop any natal composition in progress
    if (natalPulseIdsRef.current.length > 0 || natalTimeoutIdsRef.current.length > 0) {
      stopNatalPlayback(eng);
    }
    const p = paramsRef.current || initParams();
    const release = p.release;
    if (activeSigns.size > 0) {
      Object.values(eng.synths).forEach((s) => s.releaseAll(Tone.now()));
      for (const sign of activeSigns) {
        const vs = visualStateRef.current[sign];
        if (vs) {
          vs.releaseStartLevel = vs.envelopeLevel;
          vs.stage = "release";
          vs.startTime = performance.now();
          vs.releaseTime =
            release * SIGN_CHARACTER[sign].releaseMul * VIS_SPEED;
        }
      }
      applyAdaptiveVoicing(eng, 0);
      setActiveSigns(new Set());
      setStatus("ready");
    }
    if (shadow) {
      const { reverb, echoFeedbackGain, echoCrossfade, vibrato, chebyshev } =
        eng.fx;
      const rt = SHADOW.rampTime;
      const saved = paramsRef.current;
      shadowIntervalsRef.current.forEach((id) => Tone.Transport.clear(id));
      shadowIntervalsRef.current = [];
      reverb.wet.rampTo(saved.reverbWet, rt);
      echoFeedbackGain.gain.rampTo(saved.delayFeedback, rt);
      echoCrossfade.fade.rampTo(saved.delayWet, rt);
      vibrato.depth.rampTo(saved.vibratoDepth, rt);
      vibrato.frequency.rampTo(saved.vibratoFreq, rt);
      chebyshev.wet.rampTo(saved.chebyWet, rt);
      Object.values(eng.panLfos).forEach((lfo) => {
        lfo.frequency.rampTo(saved.panLfoFreq, rt);
        lfo.amplitude.rampTo(saved.panLfoAmplitude, rt);
      });
      restoreSpreadAndDetune(eng);
      setShadow(false);
    }
    // Defer osc type change — cycles null → 0 → 1 → ... → 7 → null → ...
    const next =
      oscIndex === null
        ? 0
        : oscIndex + 1 >= OSC_TYPES.length
          ? null
          : oscIndex + 1;
    pendingOscTypeRef.current = next === null ? "per-sign" : OSC_TYPES[next];
    activeOscTypeRef.current = next === null ? null : OSC_TYPES[next];
    setOscIndex(next);
  }, [activeSigns, ensureEngine, oscIndex, shadow, stopNatalPlayback]);

  const toggleShadow = useCallback(async () => {
    const eng = await ensureEngine();
    const { reverb, echoFeedbackGain, echoCrossfade, vibrato, chebyshev } =
      eng.fx;
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

      // Slow spread ramp — per-sign fat check (AM/FM signs skip spread)
      const intervals = [];
      const spreadEventId = Tone.Transport.scheduleRepeat(() => {
        let allDone = true;
        Object.entries(eng.synths).forEach(([name, synth]) => {
          const signType =
            activeOscTypeRef.current ?? SIGN_CHARACTER[name].oscType;
          if (!signType.startsWith("fat")) return;
          const current = eng.spreadTracker[name];
          if (current < st.oscSpread) {
            allDone = false;
            const next = Math.min(current + 4, st.oscSpread);
            eng.spreadTracker[name] = next;
            synth.set({ oscillator: { spread: next } });
          }
        });
        if (allDone) Tone.Transport.clear(spreadEventId);
      }, 0.2);
      intervals.push(spreadEventId);

      // Smooth detune drift — lerp toward random targets
      const detuneId = Tone.Transport.scheduleRepeat(() => {
        Object.entries(eng.synths).forEach(([name, synth]) => {
          const base = SIGN_CHARACTER[name]?.detuneCents || 0;
          const current = eng.detuneTracker[name] ?? base;
          const target = base + (Math.random() * 2 - 1) * st.detuneRange;
          const next = current + (target - current) * 0.3;
          eng.detuneTracker[name] = next;
          synth.set({ detune: next });
        });
      }, 1.2);
      intervals.push(detuneId);

      shadowIntervalsRef.current = intervals;
    } else {
      shadowIntervalsRef.current.forEach((id) => Tone.Transport.clear(id));
      shadowIntervalsRef.current = [];

      const rt = st.rampTime;
      const saved = paramsRef.current;
      reverb.wet.rampTo(saved.reverbWet, rt);
      echoFeedbackGain.gain.rampTo(saved.delayFeedback, rt);
      echoCrossfade.fade.rampTo(saved.delayWet, rt);
      vibrato.depth.rampTo(saved.vibratoDepth, rt);
      vibrato.frequency.rampTo(saved.vibratoFreq, rt);
      chebyshev.wet.rampTo(saved.chebyWet, rt);

      Object.values(eng.panLfos).forEach((lfo) => {
        lfo.frequency.rampTo(saved.panLfoFreq, rt);
        lfo.amplitude.rampTo(saved.panLfoAmplitude, rt);
      });

      restoreSpreadAndDetune(eng);
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

    const activations = {};

    for (const [label, bodyKey] of Object.entries(bodyMap)) {
      const body = chart.CelestialBodies[bodyKey];
      if (!body) continue;
      const signName = body.Sign.label;
      const signKey = Object.keys(SIGNS).find(
        (k) => k.toLowerCase() === signName.toLowerCase(),
      );
      if (!signKey) continue;
      const degree = body.ChartPosition.Ecliptic.DecimalDegrees % 30;
      const detune = (degree - 15) * TUNING.centsPerDegree;
      if (!activations[signKey])
        activations[signKey] = { planets: [], detuneCents: detune };
      activations[signKey].planets.push(label);
    }

    let ascKey = null;
    if (natalTime && chart.Ascendant?.Sign) {
      const ascSign = chart.Ascendant.Sign.label;
      ascKey = Object.keys(SIGNS).find(
        (k) => k.toLowerCase() === ascSign.toLowerCase(),
      );
      if (ascKey) {
        const degree =
          chart.Ascendant.ChartPosition.Ecliptic.DecimalDegrees % 30;
        const detune = (degree - 15) * TUNING.centsPerDegree;
        if (!activations[ascKey])
          activations[ascKey] = { planets: [], detuneCents: detune };
        activations[ascKey].planets.push("Ascendant");
      }
    }

    // Build per-body sign/degree map for compositional scheduling
    const bodies = {};
    for (const [label, bodyKey] of Object.entries(bodyMap)) {
      const body = chart.CelestialBodies[bodyKey];
      if (!body) continue;
      const signName = body.Sign.label;
      const signKey = Object.keys(SIGNS).find(
        (k) => k.toLowerCase() === signName.toLowerCase(),
      );
      if (!signKey) continue;
      bodies[label] = {
        sign: signKey,
        degree: body.ChartPosition.Ecliptic.DecimalDegrees % 30,
      };
    }
    if (ascKey) {
      bodies["Ascendant"] = {
        sign: ascKey,
        degree: chart.Ascendant.ChartPosition.Ecliptic.DecimalDegrees % 30,
      };
    }

    // Extract major aspects for entry-timing computation
    const aspects = (chart.Aspects?.all || [])
      .filter(a => a.aspectKey in NATAL_COMP.ASPECT_GAPS)
      .map(a => ({
        body1: capitalize(a.point1Key),
        body2: capitalize(a.point2Key),
        type: a.aspectKey,
        orb: a.orb,
      }));

    natalChartDataRef.current = { activations, bodies, aspects, ascendantSign: ascKey || null };

    setNatalActivations(activations);
    setNatalMode(true);
  }, [natalDate, natalTime, natalLat, natalLng]);

  const playNatalChart = useCallback(async () => {
    if (!natalMode || !natalChartDataRef.current) return;
    const eng = await ensureEngine();
    stopNatalPlayback(eng);

    setTimeout(() => {
      applyPendingOscType(eng);
      const p = paramsRef.current || initParams();
      const schedule = composeNatalSchedule(natalChartDataRef.current);
      const timeoutIds = [];
      const pulseIds = [];
      const activatedSigns = new Set();

      schedule.events.forEach(event => {
        const id = setTimeout(() => {
          const { sign, mode, pulseRate, detuneCents } = event;
          const cfg = SIGN_CHARACTER[sign];
          const note = `${cfg.note}${cfg.octave}`;

          eng.synths[sign].set({ detune: detuneCents });
          activatedSigns.add(sign);
          applyAdaptiveVoicing(eng, activatedSigns.size);

          // Clamp pulse release to fit within off-cycle (prevents voice stealing)
          let clampedRelease = null;
          if (mode === "pulse") {
            const offTime = pulseRate * (1 - NATAL_COMP.PULSE_DUTY);
            clampedRelease = Math.min(
              NATAL_COMP.PULSE_ENVELOPE.release * cfg.releaseMul,
              Math.max(0.01, offTime - 0.02),  // 20ms safety margin
            );
            eng.synths[sign].set({
              envelope: {
                attack:  NATAL_COMP.PULSE_ENVELOPE.attack * cfg.attackMul,
                decay:   NATAL_COMP.PULSE_ENVELOPE.decay * cfg.decayMul,
                sustain: NATAL_COMP.PULSE_ENVELOPE.sustain * cfg.sustainMul,
                release: clampedRelease,
              },
            });
            const duty = NATAL_COMP.PULSE_DUTY;
            // First blip immediately
            eng.synths[sign].triggerAttackRelease(note, pulseRate * duty, Tone.now(), cfg.vel);
            // Repeating blips via Transport
            const eid = Tone.Transport.scheduleRepeat(time => {
              eng.synths[sign].triggerAttackRelease(note, pulseRate * duty, time, cfg.vel);
            }, pulseRate, Tone.now() + pulseRate);
            pulseIds.push({ sign, eventId: eid });
          } else {
            // Pad: single sustained triggerAttack
            eng.synths[sign].triggerAttack(note, Tone.now(), cfg.vel);
          }

          // Visual state
          const pal = SIGN_COLORS[sign];
          const ci = colorIndexRef.current[sign] || 0;
          colorIndexRef.current[sign] = (ci + 1) % 4;
          visualStateRef.current[sign] = {
            stage: "attack",
            startTime: performance.now(),
            envelopeLevel: 0,
            attackTime: (mode === "pulse" ? NATAL_COMP.PULSE_ENVELOPE.attack : p.attack) * cfg.attackMul * VIS_SPEED,
            decayTime: (mode === "pulse" ? NATAL_COMP.PULSE_ENVELOPE.decay : p.decay) * cfg.decayMul * VIS_SPEED,
            sustainLevel: Math.min(1, (mode === "pulse" ? NATAL_COMP.PULSE_ENVELOPE.sustain : p.sustain) * cfg.sustainMul),
            releaseTime: (mode === "pulse" ? clampedRelease : p.release * cfg.releaseMul) * VIS_SPEED,
            releaseStartLevel: 0,
            activeColor: pal ? hexToRgb(pal[ci]) : [144, 112, 204],
          };

          setActiveSigns(new Set(activatedSigns));
          setStatus("playing");
          if (startLoopRef.current) startLoopRef.current();
        }, event.time * 1000);
        timeoutIds.push(id);
      });

      // ── Finale: hold full chord, then abrupt cut + reverb wash ──
      const finaleTime = (schedule.totalDuration + NATAL_COMP.SUSTAIN_HOLD) * 1000;
      const finaleId = setTimeout(() => {
        const { FINALE } = NATAL_COMP;

        // 1. Bloom — ramp reverb wet to near-max
        eng.fx.reverb.wet.rampTo(FINALE.reverbWet, FINALE.reverbRamp);

        // 2. Kill pulse patterns
        natalPulseIdsRef.current.forEach(({ sign: s, eventId }) => {
          Tone.Transport.clear(eventId);
        });
        natalPulseIdsRef.current = [];

        // 3. Abrupt cut — ultra-short release, release all voices
        Object.entries(eng.synths).forEach(([, synth]) => {
          synth.set({ envelope: { release: FINALE.cutRelease } });
          synth.releaseAll(Tone.now());
        });

        // 4. Visual release for all active signs
        for (const sign of activatedSigns) {
          const vs = visualStateRef.current[sign];
          if (vs) {
            vs.releaseStartLevel = vs.envelopeLevel;
            vs.stage = "release";
            vs.startTime = performance.now();
            vs.releaseTime = FINALE.cutRelease * VIS_SPEED;
          }
        }
        setActiveSigns(new Set());
        setStatus("ready");

        // 5. After reverb tail decays, restore everything
        const restoreId = setTimeout(() => {
          const saved = paramsRef.current || initParams();
          eng.fx.reverb.wet.rampTo(saved.reverbWet, 1.0);
          Object.entries(eng.synths).forEach(([name, synth]) => {
            const cfg = SIGN_CHARACTER[name];
            synth.set({
              envelope: {
                attack:  saved.attack * cfg.attackMul,
                decay:   saved.decay * cfg.decayMul,
                sustain: saved.sustain * cfg.sustainMul,
                release: saved.release * cfg.releaseMul,
              },
            });
          });
        }, FINALE.tailTime * 1000);
        natalTimeoutIdsRef.current = [restoreId];
      }, finaleTime);
      timeoutIds.push(finaleId);

      natalTimeoutIdsRef.current = timeoutIds;
      natalPulseIdsRef.current = pulseIds;
    }, TUNING.retriggerGap);
  }, [natalMode, ensureEngine, stopNatalPlayback]);

  return (
    <>
      <style>{CSS}</style>
      <div
        className={`cel-root${shadow ? " cel-eclipse-active" : ""}`}
        ref={rootRef}
      >
        <canvas className="cel-emanation" ref={emanationRef} />
        <div className="cel-keyboard">
          {KEYBOARD_ORDER.filter((_, i) => !SHARP_INDICES.has(i)).map(
            (sign) => {
              const cfg = SIGNS[sign];
              const active = activeSigns.has(sign);
              return (
                <button
                  key={sign}
                  type="button"
                  ref={(el) => {
                    keyRefsRef.current[sign] = el;
                  }}
                  className={`cel-key cel-key-natural${active ? " cel-key-active" : ""}`}
                  onClick={() => toggleSign(sign)}
                >
                  <span className="cel-key-glyph">{cfg.glyph}</span>
                  <span className="cel-key-name">{sign}</span>
                  <span className="cel-key-note">{cfg.note}</span>
                </button>
              );
            },
          )}
          {KEYBOARD_ORDER.filter((_, i) => SHARP_INDICES.has(i)).map(
            (sign, i) => {
              const cfg = SIGNS[sign];
              const active = activeSigns.has(sign);
              return (
                <button
                  key={sign}
                  type="button"
                  ref={(el) => {
                    keyRefsRef.current[sign] = el;
                  }}
                  className={`cel-key cel-key-sharp${active ? " cel-key-active" : ""}`}
                  style={{ left: SHARP_POSITIONS[i] }}
                  onClick={() => toggleSign(sign)}
                >
                  <span className="cel-key-glyph">{cfg.glyph}</span>
                  <span className="cel-key-name">{sign}</span>
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

        <details className="cel-veil">
          <summary className="cel-oracle">
            <span className="cel-oracle-line">.</span>
            <span className="cel-oracle-line">. .</span>
            <span className="cel-oracle-line">. . .</span>
            <span className="cel-oracle-line">. .&nbsp; l o o k &nbsp;. .</span>
            <span className="cel-oracle-line">
              . . . &nbsp;w i t h i n&nbsp; . . .
            </span>
            <span className="cel-oracle-line">. . . . . . . .</span>
            <span className="cel-oracle-line">. . . . . .</span>
            <span className="cel-oracle-line">. . . . </span>
            <span className="cel-oracle-line">. . </span>
            <span className="cel-oracle-line">.</span>
          </summary>
          <span className="cel-osc-indicator">
            {oscIndex === null ? "per-sign" : OSC_TYPES[oscIndex]}
          </span>
          <div className="cel-macros">
            {groupedKnobs.map((item) =>
              item.type === "row" ? (
                <div
                  key={item.groups.map((g) => g.key).join("-")}
                  className="cel-group-row"
                >
                  {item.groups.map((g) => (
                    <div key={g.key} className="cel-group">
                      <span className="cel-group-label">{g.label}</span>
                      <div className="cel-group-knobs">
                        {g.knobs.map(([name, def]) => (
                          <Knob
                            key={name}
                            label={def.label}
                            value={params[name]}
                            defaultValue={def.default}
                            min={def.min}
                            max={def.max}
                            {...knobScaleProps[name]}
                            format={formatFns[name]}
                            onChange={paramSetters[name]}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div key={item.key} className="cel-group">
                  <span className="cel-group-label">{item.label}</span>
                  <div className="cel-group-knobs">
                    {item.knobs.map(([name, def]) => (
                      <Knob
                        key={name}
                        label={def.label}
                        value={params[name]}
                        defaultValue={def.default}
                        min={def.min}
                        max={def.max}
                        {...knobScaleProps[name]}
                        format={formatFns[name]}
                        onChange={paramSetters[name]}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
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
          <button
            type="button"
            className="cel-btn cel-randomize-btn"
            onClick={randomizeParams}
          >
            Randomize
          </button>
        </details>

        <div className="cel-natal">
          <div className="cel-natal-body">
            <div className="cel-natal-inputs">
              <label className="cel-natal-label">
                <span>Birth date</span>
                <input
                  type="date"
                  className="cel-natal-input"
                  value={natalDate}
                  onChange={(e) => setNatalDate(e.target.value)}
                  placeholder="Birth date"
                />
              </label>
              <label className="cel-natal-label">
                <span>Birth time (optional)</span>
                <input
                  type="time"
                  className="cel-natal-input"
                  value={natalTime}
                  onChange={(e) => setNatalTime(e.target.value)}
                  placeholder="Birth time"
                />
              </label>
              <label className="cel-natal-label">
                <span>Latitude</span>
                <input
                  type="number"
                  className="cel-natal-input"
                  value={natalLat}
                  onChange={(e) => setNatalLat(e.target.value)}
                  placeholder="Latitude"
                  step="0.01"
                />
              </label>
              <label className="cel-natal-label">
                <span>Longitude</span>
                <input
                  type="number"
                  className="cel-natal-input"
                  value={natalLng}
                  onChange={(e) => setNatalLng(e.target.value)}
                  placeholder="Longitude"
                  step="0.01"
                />
              </label>
            </div>
            <div className="cel-natal-actions">
              <button
                type="button"
                className="cel-btn cel-natal-compute"
                onClick={computeNatalChart}
                disabled={!natalDate}
              >
                Compute
              </button>
              <button
                type="button"
                className="cel-btn cel-natal-play"
                onClick={playNatalChart}
                disabled={!natalMode}
              >
                Play
              </button>
            </div>
            {natalActivations && Object.keys(natalActivations).length > 0 && (
              <div className="cel-natal-grid">
                {Object.entries(natalActivations).map(([sign, { planets }]) => (
                  <span key={sign} className="cel-natal-item">
                    {SIGNS[sign].glyph} {sign}: {planets.join(", ")}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="cel-footer">
          <p>
            v12 &middot; 12&times;2 voices &middot; 44.1kHz &middot; 35 knobs
          </p>
          <h1 className="cel-title">celezdial selekta</h1>
        </div>
      </div>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const CSS = `
  @font-face {
    font-family: 'Spiral ST';
    src: url('${process.env.PUBLIC_URL}/fonts/spiral-st/SpiralST.ttf') format('truetype');
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
    contain: layout;
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
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    font-weight: 400;
    letter-spacing: 0.15em;
    color: #f0e8ff;
    text-shadow: 0 0 30px rgba(180, 140, 255, 0.3);
    animation: cel-glow 4s ease-in-out infinite;
    margin-bottom: 0.4rem;
    text-align: center;
  }

  @keyframes cel-glow {
    0%, 100% { text-shadow: 0 0 30px rgba(180, 140, 255, 0.2); }
    50% { text-shadow: 0 0 50px rgba(180, 140, 255, 0.5), 0 0 80px rgba(140, 100, 220, 0.2); }
  }

  .cel-oracle {
    text-align: center;
    color: #a098b8;
    font-size: 0.75rem;
    letter-spacing: 0.35em;
    line-height: 1.3;
    cursor: pointer;
    list-style: none;
    padding: 8px;
    margin-bottom: 0.5rem;
    opacity: 0.5;
    transition: opacity 0.3s ease;
  }

  .cel-oracle::-webkit-details-marker { display: none; }

  .cel-oracle:hover { opacity: 0.7; }

  .cel-veil[open] > .cel-oracle { opacity: 0.2; margin-bottom: 8px; }

  .cel-oracle-line {
    display: block;
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
    contain: layout;
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
    transition: background 0.15s ease, border-color 0.15s ease;
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

  .cel-key-glyph-sm {
    font-size: 0.9rem;
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
    contain: layout;
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
    transition: all 0.2s ease;
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
    animation: cel-shadow-pulse 2s ease-in-out infinite;
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
    flex-direction: row;
    gap: 0.4rem;
    justify-content: center;
  }

  .cel-breathe-btn:hover:not(:disabled) {
    background: rgba(255, 180, 140, 0.1);
    border-color: rgba(255, 180, 140, 0.35);
    box-shadow: none;
  }

  .cel-osc-indicator {
    display: block;
    text-align: center;
    font-size: 0.6rem;
    font-family: ${FONTS.mono};
    color: rgba(180, 140, 255, 0.35);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 0.5rem;
  }

  /* ── Listen preset pills ─────────────────────────────── */

  .cel-listen {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
    margin-bottom: 1.5rem;
    contain: layout;
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

  .cel-randomize-btn {
    margin: 0.8rem auto 0;
    font-size: 0.75rem;
    padding: 0.4rem 1.2rem;
    opacity: 0.6;
  }

  /* ── Macro Knobs ───────────────────────────────────── */

  .cel-macros {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    max-width: 600px;
    width: 100%;
    margin-bottom: 1.5rem;
    contain: layout;
  }

  .cel-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 8px 4px;
    border: 1px solid rgba(180, 140, 255, 0.08);
    border-radius: 8px;
    background: rgba(180, 140, 255, 0.02);
    contain: layout style;
  }

  .cel-group-label {
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: rgba(180, 140, 255, 0.35);
    text-transform: uppercase;
    margin-bottom: 1px;
  }

  .cel-group-knobs {
    display: flex;
    gap: 2px;
  }

  .cel-group-row {
    display: flex;
    gap: 4px;
    justify-content: center;
  }

  .cel-knob {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    flex: 1;
    max-width: 80px;
    contain: layout style;
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
    transition: stroke 0.25s ease-out;
  }

  .cel-knob-pointer {
    fill: var(--knob-accent, #b490e8);
    transition: fill 0.25s ease-out;
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

  .cel-natal-label { display: flex; flex-direction: column; gap: 2px; }
  .cel-natal-label span { font-size: 0.65rem; color: #706888; letter-spacing: 0.05em; }

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

  .cel-natal-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 0;
  }
  .cel-natal-item {
    font-size: 11px;
    opacity: 0.7;
  }

  @media (max-width: 600px) {
    .cel-root { padding: 8px; }
    .cel-keyboard { gap: 2px; }
    .cel-key-natural { min-width: 36px; padding: 8px 2px; }
    .cel-key-sharp { width: 28px; }
    .cel-key-name { font-size: 8px; }
    .cel-key-glyph { font-size: 14px; }
    .cel-listen { flex-wrap: wrap; }
    .cel-group-row { flex-direction: column; }
  }
`;
