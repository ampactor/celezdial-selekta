// Pure utility functions — extracted from App.jsx for testability

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatValue(value, def) {
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

export const logMap = (min, max) => ({
  mapFromNorm: (n) => min * Math.pow(max / min, n),
  mapToNorm: (v) => Math.log(v / min) / Math.log(max / min),
});

export const stepMap = (min, max) => ({
  mapFromNorm: (n) => Math.round(min + n * (max - min)),
  mapToNorm: (v) => (v - min) / (max - min),
});

// ─── SVG Arc Knob Geometry ───────────────────────────────────

export const DEG_TO_RAD = Math.PI / 180;
export const KNOB_R = 22;
export const KNOB_CX = 28;
export const KNOB_CY = 28;
export const KNOB_START = -135;
export const KNOB_END = 135;
export const KNOB_SWEEP = 270;

export const arcPoint = (angle) => ({
  x: KNOB_CX + KNOB_R * Math.cos((angle - 90) * DEG_TO_RAD),
  y: KNOB_CY + KNOB_R * Math.sin((angle - 90) * DEG_TO_RAD),
});

export const describeArc = (start, end) => {
  const s = arcPoint(start);
  const e = arcPoint(end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${KNOB_R} ${KNOB_R} 0 ${large} 1 ${e.x} ${e.y}`;
};

export const KNOB_TRACK_PATH = describeArc(KNOB_START, KNOB_END);
