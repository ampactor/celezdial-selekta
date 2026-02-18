// ═══════════════════════════════════════════════════════════════
// TUNING — All sound-shaping numbers in one place.
// Open this file, change numbers, save, hot-reload hears the diff.
//
// Exports:
//   TUNING         FX parameter defaults (what m=0.5 produces)
//   SHADOW         Eclipse mode chaos targets
//   MACROS         Macro knob definitions: labels, defaults, curves
//   LISTEN_PRESETS Monitor EQ presets for different playback devices
//   CHAINS         FX chain orderings (declarative node arrays)
//   ACTIVE_CHAIN   Which chain config to wire on engine init
//
// ─── HOW MACROS WORK ──────────────────────────────────────────
//
// Each macro knob is 0–1. At m=0.5, every param equals its TUNING
// default. Curves map m → param value using these formats:
//
//   Array format (resolved to functions at import time):
//     ["splitLog",    min, mid, max]  — log interpolation, 3-point anchor
//     ["splitLinear", min, mid, max]  — linear interpolation, 3-point anchor
//     ["dormantLinear", base, max]    — holds base for m<=0.5, ramps m>0.5
//     ["dormantLog",   base, max]     — holds base for m<=0.5, log ramp m>0.5
//
//   Inline functions for custom curves:
//     (m) => ...  — piecewise, step, or any JS expression
//
// ─── HOW CHAINS WORK ─────────────────────────────────────────
//
// order: Array of node names in signal flow order.
//   "ECHO" is a sentinel — wireChain expands it to:
//     prev → echoCrossfade.a (dry)
//     prev → echoInputGain → echoDelay → echoCrossfade.b (wet)
//   All other names are .connect()'d in sequence.
//
// bypass: Nodes that start disconnected (wet=0) for CPU savings.
//   { nodeName: { after: "prevNode", before: "nextNode" } }
//   wireChain inserts them dynamically when wet > 0.
//   Nodes listed in bypass must NOT appear in order.
//
// Available node names (must match createEngine variable names):
//   chebyshev    — polynomial waveshaper (harmonic generation)
//   distortion   — waveshaping saturator (stacks with chebyshev)
//   eq3          — 3-band "tape" EQ
//   vibrato      — slow LFO pitch mod (VHS wow/flutter)
//   ECHO         — crossfade delay loop (sentinel, not a real node)
//   reverb       — Freeverb (Schroeder comb-filter resonances)
//   chorus       — stereo chorus shimmer
//   phaser       — sweeping allpass comb filters
//   monitorEQ    — output EQ for listening environment
//   softClip     — tanh limiter (always last before destination)
//
// ═══════════════════════════════════════════════════════════════

// ─── FX Parameter Defaults ───────────────────────────────────
// These are the values each param takes when its macro knob is at 0.5.
// Changing a value here changes the "center point" of that macro.
export const TUNING = {
  sampleRate: 16000,

  // ── Envelope (Bloom macro) ──
  // ADSR shape for all PolySynth voices.
  attack: 2, // seconds — slow pad attack
  decay: 1.5, // seconds — long tail into sustain
  sustain: 0.4, // 0–1 level — quiet sustain for pad character
  release: 2.4, // seconds — long release for wash

  // ── Chebyshev saturation (Grit macro) ──
  // Polynomial waveshaper on the summed polyphonic signal.
  // Order N generates Nth harmonic. Intermodulation between
  // voices creates FM-like sum/difference tones.
  chebyOrder: 3, // harmonic order (1=clean, 11=harsh)
  chebyWet: 0.5, // 0–1 dry/wet blend (1.0 = full saturation)

  // ── Tape EQ (Tone macro) ──
  // 3-band EQ simulating tape head frequency response.
  // Shapes the saturated signal before time-domain effects.
  eqHigh: -13, // dB — high shelf (negative = tape rolloff)
  eqMid: 3, // dB — mid band
  eqLow: 3, // dB — low shelf
  eqHighFreq: 3000, // Hz — high band crossover frequency

  // ── VHS wow / vibrato (Drift macro) ──
  // Slow LFO pitch modulation on the full mix.
  // Low rate + moderate depth = seasick drift, not chorus.
  vibratoFreq: 0.25, // Hz — LFO rate (0.25 = 4 second cycle)
  vibratoDepth: 0.28, // 0–1 — pitch deviation amount
  vibratoWet: 0.4, // 0–1 — dry/wet blend

  // ── Echo / delay cascade (Echo macro) ──
  // Hand-wired delay with feedback path: delay → filter → tanh sat → gain → delay.
  // Each repeat gets progressively darker and warmer (tape delay character).
  delayTime: 0.6, // seconds — delay tap time
  delayFeedback: 0.48, // 0–1 — feedback gain (MUST stay < 1/echoSatDrive)
  delayWet: 0.3, // 0–1 — crossfade position (0=dry, 1=wet)

  // ── Algorithmic reverb (Aether macro) ──
  // Freeverb — parallel comb filters + series allpass.
  // Comb-filter resonances interact with Chebyshev harmonics
  // to produce metallic shimmer. NOT convolution.
  reverbRoom: 0.85, // 0–1 — room size (0.95 = huge hall)
  reverbDamp: 1500, // Hz — comb filter cutoff (lower = darker)
  reverbWet: 0.5, // 0–1 — dry/wet blend

  // ── Damp sweep (Aether macro) ──
  // Sinusoidal LFO modulating reverb dampening frequency.
  // Sweeps comb filter cutoffs for evolving resonance morphing.
  dampSweepRate: 0.08, // Hz — sweep speed (0 = static)
  dampSweepDepth: 0.2, // 0–1 — modulation depth (0 = off)

  // ── Per-voice panning LFOs (Aether macro) ──
  // One LFO per pan group (A/B/C/D), drifts stereo position.
  panLfoFreq: 0.05, // Hz — drift speed
  panLfoAmplitude: 0.12, // 0–1 — drift width

  // ── Monitor EQ crossover frequencies ──
  // Fixed crossover points for the output EQ (listen presets).
  monitorLowFreq: 400, // Hz — low/mid crossover
  monitorHighFreq: 2500, // Hz — mid/high crossover

  // ── Stagger / retrigger ──
  stagger: 0.45, // seconds — delay between voice triggers in a chord
  retriggerGap: 80, // ms — minimum gap before a voice can retrigger

  // ── Phaser (Grit macro, dormant below 0.5) ──
  // Sweeping allpass filters create moving comb-filter interference.
  phaserFreq: 0.3, // Hz — sweep rate
  phaserOctaves: 4, // octave range of sweep
  phaserBase: 430, // Hz — base frequency of sweep
  phaserQ: 6, // resonance / feedback amount
  phaserWet: 0.1, // 0–1 — starts bypassed

  // ── Echo feedback loop filter ──
  // Lowpass in the feedback path — darkens each repeat.
  echoFilterFreq: 4000, // Hz — filter cutoff

  // ── Distortion (Grit macro, dormant below 0.5) ──
  // Waveshaping saturator that stacks with Chebyshev.
  distortion: 0.4, // 0–1 — drive amount
  distortionWet: 0.1, // 0–1 — starts bypassed

  // ── Echo feedback safety ──
  // The echo loop has: delay → filter → tanh(v * drive) → gain(feedback) → delay
  // Loop gain = feedback * drive. MUST be < 1 or small signals amplify forever.
  // At defaults: 0.68 * 1.0 = 0.68. Safe.
  echoSatDrive: 0.6, // tanh drive factor — keep <= 1.0
  echoInputGain: 0.7, // pre-delay attenuator — safety margin for hot polyphonic sum
};

// ─── Shadow / Eclipse Mode Chaos Targets ─────────────────────
// When Eclipse activates, FX params ramp toward these values over
// rampTime seconds. When Eclipse deactivates, macro-derived values
// are restored. These are "how far into chaos" each param goes.
export const SHADOW = {
  reverbWet: 0.8, // wetter reverb
  delayFeedback: 0.87, // near-infinite echoes (still < 1.0!)
  delayWet: 0.86, // almost all wet signal
  vibratoDepth: 0.72, // heavy pitch drift
  vibratoFreq: 0.06, // very slow wobble
  chebyWet: 1.0, // full saturation
  panLfoFreq: 0.18, // faster pan drift
  panLfoAmplitude: 0.55, // wide stereo movement
  oscSpread: 120, // max oscillator detuning
  detuneRange: 15, // random detune variance (cents)
  rampTime: 16, // seconds to reach chaos targets
};

// ─── Macro Definitions ───────────────────────────────────────
// 6 macro knobs, each 0–1 normalized. m=0.5 = TUNING defaults.
//
// Curve format:
//   ["splitLog", min, mid, max]     — logarithmic 3-point: m=0→min, m=0.5→mid, m=1→max
//   ["splitLinear", min, mid, max]  — linear 3-point: same anchors, linear interp
//   ["dormantLinear", base, max]    — base for m<=0.5, linear ramp to max for m>0.5
//   ["dormantLog", base, max]       — base for m<=0.5, log ramp to max for m>0.5
//   (m) => expression               — custom: anything the above can't express
//
// To tune: change the numbers in the arrays. The curve type stays the same.
// Example: reverbMix: ["splitLinear", 0.05, 0.35, 0.5]
//          means m=0 → 5% wet, m=0.5 → 35% wet, m=1 → 50% wet.
//          Want more reverb at max? Change 0.5 to 0.7.

export const MACROS = {
  // ── Bloom — envelope shape (attack/decay/sustain/release) ──
  // Controls how voices fade in and out. Low = percussive. High = glacial.
  bloom: {
    label: "Bloom",
    default: 0.5,
    params: {
      attack: ["splitLog", 0.01, 1.5, 8.0], // 10ms → 1.5s → 8s
      decay: ["splitLog", 0.1, 3.5, 8.0], // 100ms → 3.5s → 8s
      sustain: ["splitLinear", 0.0, 0.2, 0.8], // silent → 20% → 80%
      release: ["splitLog", 0.1, 5.0, 10.0], // 100ms → 5s → 10s
    },
  },

  // ── Aether — reverb, space, stereo field ──
  // Controls room size, damping, pan drift, and chorus shimmer.
  // Low = dry/mono. Mid = cathedral. High = infinite space + shimmer.
  aether: {
    label: "Aether",
    default: 0.5,
    params: {
      reverbRoom: ["splitLinear", 0.3, 0.95, 1.0], // small → huge → infinite
      reverbDamp: ["splitLog", 8000, 1500, 600], // bright → dark → very dark
      reverbMix: ["splitLinear", 0.05, 0.35, 0.8], // 5% → 35% → 80% wet
      dampSweepRate: ["splitLog", 0.01, 0.08, 0.5], // near-static → slow → fast
      dampSweepDepth: ["splitLinear", 0.0, 0.15, 1.0], // off → subtle → full
      panDrift: ["splitLog", 0.01, 0.07, 0.5], // near-static → slow → fast
      panWidth: ["splitLinear", 0.0, 0.2, 1.0], // mono → narrow → full stereo
      aetherShimmer: ["dormantLinear", 0.0, 0.6], // off until 0.5, then chorus
    },
  },

  // ── Echo — delay time, feedback, mix, filter ──
  // Controls the tape-delay character. Low = short slapback.
  // Mid = classic delay. High = long washed-out repeats.
  echo: {
    label: "Echo",
    default: 0.5,
    params: {
      echoTime: ["splitLog", 0.1, 0.8, 2.5], // 50ms → 600ms → 1.5s
      echoFeedback: (
        m, // piecewise: ramps to 0.68, then gently past
      ) =>
        m <= 0.5 ? (m / 0.5) * 0.68 : 0.68 + 0.2 * Math.pow((m - 0.5) / 0.5, 1), // max ~0.88 (safe with echoSatDrive=1.0)
      echoMix: (m) => m, // linear identity: 0→0, 1→1
      echoFilterFreq: ["splitLog", 8000, 4000, 1800], // bright → warm → dark repeats
    },
  },

  // ── Drift — vibrato / VHS wow ──
  // Controls pitch modulation speed, depth, and mix.
  // Low = static. Mid = gentle drift. High = seasick tape warble.
  drift: {
    label: "Drift",
    default: 0.5,
    params: {
      wobbleRate: ["splitLog", 0.01, 0.25, 1.0], // near-static → 4s cycle → fast
      wobbleDepth: ["splitLinear", 0.0, 0.32, 1.0], // none → moderate → extreme
      wobbleMix: ["splitLinear", 0.0, 0.8, 1.0], // dry → mostly wet → full
    },
  },

  // ── Grit — saturation, distortion, phaser ──
  // Controls harmonic density. Low = clean. Mid = warm saturation.
  // High = stacked distortion + phaser interference.
  // Distortion and phaser are "dormant" below 0.5 (off), activate above.
  grit: {
    label: "Grit",
    default: 0.5,
    params: {
      gritDrive: (m) => (m <= 0.5 ? m / 0.5 : 1.0), // ramp 0→1 in first half, clamp at 1
      chebyOrder: (
        m, // stepped: 1 → 3 → 5 → 7 → 9 → 11
      ) =>
        m < 0.17
          ? 1
          : m < 0.5
            ? 3
            : m < 0.62
              ? 5
              : m < 0.74
                ? 7
                : m < 0.87
                  ? 9
                  : 11,
      satDrive: ["splitLinear", 0.0, 0.4, 1.0], // none → moderate → full
      satMix: ["dormantLinear", 0.0, 1.0], // off until 0.5, then ramp
      phaserFreq: (
        m, // dormant + log ramp
      ) => (m <= 0.5 ? 0.3 : 0.3 * Math.pow(8.0 / 0.3, (m - 0.5) / 0.5)),
      phaserOctaves: (
        m, // dormant + stepped
      ) => (m <= 0.5 ? 3 : Math.round(3 + 3 * ((m - 0.5) / 0.5))),
      phaserBase: (
        m, // dormant + log sweep down
      ) => (m <= 0.5 ? 350 : 350 * Math.pow(100 / 350, (m - 0.5) / 0.5)),
      phaserQ: () => 10, // constant
      phaserMix: [0.0, 0.2, 0.6], // off until 0.5, then ramp
    },
  },

  // ── Tone — 3-band EQ character ──
  // Controls the spectral tilt. Low = bright/thin. Mid = tape warmth.
  // High = dark/thick.
  tone: {
    label: "Tone",
    default: 0.5,
    params: {
      eqHigh: ["splitLinear", 12, -6, -24], // +12dB bright → -6dB tape → -24dB dark
      eqMid: ["splitLinear", -12, 3, 12], // scooped → warm → forward
      eqLow: ["splitLinear", -12, 3, 12], // thin → full → boomy
    },
  },
};

// ─── Listen Presets ──────────────────────────────────────────
// Monitor EQ compensation for different playback devices.
// Values are dB gain for low/mid/high bands.
// Crossover frequencies set in TUNING (monitorLowFreq, monitorHighFreq).
export const LISTEN_PRESETS = {
  headphones: { low: -2, mid: 0, high: 1, label: "HP" },
  laptop: { low: 6, mid: 2, high: 3, label: "Laptop" },
  phone: { low: 4, mid: 3, high: 2, label: "Phone" },
  loudspeaker: { low: 3, mid: -2, high: 0, label: "Speaker" },
};

// ─── FX Chain Configs ────────────────────────────────────────
// Each config defines a different FX ordering, which dramatically
// changes sonic character. All configs use the same FX nodes —
// only the wiring differs.
//
// order: node names in signal flow. sumBus connects to first,
//        last connects to destination. "ECHO" expands to crossfade.
//
// bypass: nodes starting at wet=0, dynamically inserted when
//         their mix knob goes above 0. Saves CPU when inactive.
//         { nodeName: { after: "prevNode", before: "nextNode" } }
//         Nodes in bypass must NOT appear in order.
//
// To switch chains: change ACTIVE_CHAIN below, save, refresh.

export const CHAINS = {
  // ── Cathedral (default) ──
  // Saturation first — Chebyshev harmonics color everything downstream.
  // Distortion + phaser start bypassed (wet=0), activate via Grit macro.
  // Signal: sum → cheby → [dist] → eq → vibrato → ECHO → reverb → [chorus] → [phaser] → monEQ → clip
  cathedral: {
    order: [
      "chebyshev",
      "eq3",
      "vibrato",
      "ECHO",
      "reverb",
      "chorus",
      "monitorEQ",
      "softClip",
    ],
    bypass: {
      distortion: { after: "chebyshev", before: "eq3" },
      phaser: { after: "chorus", before: "monitorEQ" },
    },
  },

  // ── Void ──
  // Reverb before delay — delay repeats the already-reverbed signal,
  // creating infinite receding echoes. More diffuse, less defined.
  // Signal: sum → cheby → dist → eq → vibrato → reverb → phaser → ECHO → chorus → monEQ → clip
  void: {
    order: [
      "chebyshev",
      "distortion",
      "eq3",
      "vibrato",
      "reverb",
      "phaser",
      "ECHO",
      "chorus",
      "monitorEQ",
      "softClip",
    ],
    bypass: {},
  },

  // ── Furnace ──
  // Delay before saturation — clean echoes get waveshaped together
  // with the dry signal. Progressively dirtier repeats.
  // Signal: sum → ECHO → cheby → dist → eq → vibrato → reverb → chorus → phaser → monEQ → clip
  furnace: {
    order: [
      "ECHO",
      "chebyshev",
      "distortion",
      "eq3",
      "vibrato",
      "reverb",
      "chorus",
      "phaser",
      "monitorEQ",
      "softClip",
    ],
    bypass: {},
  },

  // ── Tape ──
  // Vibrato (wow/flutter) applied first — pitch drift feeds into
  // saturation, creating time-varying harmonic content.
  // Signal: sum → vibrato → cheby → dist → eq → ECHO → reverb → chorus → phaser → monEQ → clip
  tape: {
    order: [
      "vibrato",
      "chebyshev",
      "distortion",
      "eq3",
      "ECHO",
      "reverb",
      "chorus",
      "phaser",
      "monitorEQ",
      "softClip",
    ],
    bypass: {},
  },

  // ── Evolve ──
  // Space effects BEFORE saturation — reverb/delay tails feed into
  // Chebyshev, generating new harmonics as they decay. Spectral
  // content evolves over time. Maximum harmonic density.
  // Signal: sum → vibrato → ECHO → reverb → phaser → cheby → dist → eq → chorus → monEQ → clip
  evolve: {
    order: [
      "vibrato",
      "ECHO",
      "reverb",
      "phaser",
      "chebyshev",
      "distortion",
      "eq3",
      "chorus",
      "monitorEQ",
      "softClip",
    ],
    bypass: {},
  },

  // ── Glass ──
  // No saturation — Chebyshev + Distortion skipped entirely.
  // Clean voices through EQ, vibrato, delay, reverb. Fragile, pure.
  // Signal: sum → eq → vibrato → ECHO → reverb → chorus → phaser → monEQ → clip
  glass: {
    order: [
      "eq3",
      "vibrato",
      "ECHO",
      "reverb",
      "chorus",
      "phaser",
      "monitorEQ",
      "softClip",
    ],
    bypass: {},
  },

  // ── Custom ──
  // Blank slate — all available nodes listed, all commented out.
  // Uncomment and reorder to build your own chain from scratch.
  // Rules:
  //   - "ECHO" must appear exactly once (crossfade split point)
  //   - "softClip" should be last (final limiter)
  //   - "monitorEQ" should be second-to-last (listen compensation)
  //   - Nodes in bypass{} must NOT be in order[]
  //   - Any node can be omitted entirely (it just won't be wired)
  custom: {
    order: [
      // --- modulation ---
      "chorus", // stereo chorus shimmer
      "phaser", // sweeping allpass comb filters

      // --- tone shaping ---
      "eq3", // 3-band EQ — spectral tilt
      "vibrato", // LFO pitch mod — wow/flutter

      // --- saturation stage ---
      "chebyshev", // polynomial waveshaper — harmonic generation
      "distortion", // additional waveshaping saturator

      // --- time / space ---
      "ECHO", // delay with filtered feedback (REQUIRED — exactly once)

      // --- output ---
      "monitorEQ", // listen EQ compensation
      "softClip", // tanh limiter (keep last)
      "reverb", // Freeverb — comb-filter resonances
    ],
    bypass: {
      // Uncomment to make a node bypassable (starts disconnected, inserts when wet>0):
      // distortion: { after: "chebyshev", before: "eq3" },
      // phaser: { after: "chorus", before: "monitorEQ" },
    },
  },
};

// Which chain to wire on engine init.
// Change this string, save, refresh — instant new character.
export const ACTIVE_CHAIN = "custom";
