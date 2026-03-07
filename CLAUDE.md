# Celezdial Selekta

Zodiac-themed audio synthesizer — 12 signs mapped chromatically C through B, with per-sign oscillator types, microtonal tuning, and a real-time visual engine. Built with React + Tone.js + Canvas.

## Commands

```bash
# nvm lazy-load workaround for non-interactive shells:
unset -f nvm node npm npx 2>/dev/null; NVM_DIR="/home/suds/.config/nvm" source "/home/suds/.config/nvm/nvm.sh" && nvm use --lts

npm run dev        # Vite dev server
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Vitest (85 tests)
npm run analyze    # source-map-explorer on build output
```

Morgan builds/serves himself (Tier: Manual). Don't run builds — tell him to build+check when edits are done.

## Architecture

### Signal Flow
User clicks sign glyph → `ensureEngine()` lazy-creates Tone.js AudioContext → sign's oscillator type (fat/AM/FM per planetary character) feeds through FX chain → speakers.

### FX Chain
Oscillators → Filter → Chorus → Phaser → Tremolo → Reverb → EQ3 → Compressor → Gain → Destination

### Lazy Import
`circular-natal-horoscope-js` (~780KB) is dynamically imported on first natal chart use via `getHoroscope()`. Not in the main bundle.

## Key Files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Single-file React app: audio engine, Knob component, visual engine (rAF), all JSX + CSS-in-JS |
| `src/tuning.js` | All sound-shaping numbers: TUNING, SHADOW, KNOB_DEFS, KNOB_GROUPS, LISTEN_PRESETS, CHAINS, OSC_TYPES, PLANETARY_CHARACTER, SIGN_RULERS |
| `src/utils.js` | Pure utility functions extracted from App.jsx (knob geometry, mapping) |
| `src/index.jsx` | Entry point with ErrorBoundary + StrictMode |
| `src/__tests__/` | Vitest test suite |
| `src/presets/` | Preset data |
| `public/fonts/spiral-st/` | Only active font family |

## Doc-to-Code Mapping

| Source File(s) | Documentation Target(s) | What to Update |
|---|---|---|
| `src/App.jsx` (audio engine, visual engine, JSX) | this file (Architecture, Signal Flow) | Engine init, FX chain order, component structure |
| `src/tuning.js` | this file (Key Files) | Tuning constants, knob definitions, chain config |
| `src/utils.js` | this file (Key Files) | Utility function inventory |
| `src/index.jsx` | this file (Key Files) | Entry point, ErrorBoundary |
| `package.json` | this file (Commands) | Scripts, dependencies |

## Conventions

- **Single-file app**: `App.jsx` contains the audio engine, visual engine, all components, and CSS-in-JS. This is intentional.
- **tuning.js is SSOT**: All sound-shaping numbers live in `tuning.js`. Engine code reads from these; never hardcode tuning values in `App.jsx`.
- **Tone.js dynamic import**: Tone is loaded dynamically (`let Tone = null`, assigned in `ensureEngine`). Module-level `_enginePromise` prevents duplicate AudioContexts.
- **CSS-in-JS**: Styles are template literals in `App.jsx`, not separate CSS files.
- **Oracle dot pyramid**: Hidden `<summary>` trigger for the Controls `<details>` veil.
