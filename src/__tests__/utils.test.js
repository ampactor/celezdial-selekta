import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  capitalize,
  formatValue,
  logMap,
  stepMap,
  arcPoint,
  describeArc,
  KNOB_TRACK_PATH,
  KNOB_R,
  KNOB_CX,
  KNOB_CY,
  KNOB_START,
  KNOB_END,
  KNOB_SWEEP,
  DEG_TO_RAD,
} from "../utils";

describe("hexToRgb", () => {
  it("converts black", () => expect(hexToRgb("#000000")).toEqual([0, 0, 0]));
  it("converts white", () =>
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]));
  it("converts primary red", () =>
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]));
  it("converts arbitrary color", () =>
    expect(hexToRgb("#3f575a")).toEqual([63, 87, 90]));
});

describe("rgbToHex", () => {
  it("converts black", () => expect(rgbToHex(0, 0, 0)).toBe("#000000"));
  it("converts white", () =>
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff"));
  it("converts primary green", () =>
    expect(rgbToHex(0, 255, 0)).toBe("#00ff00"));
  it("round-trips with hexToRgb", () => {
    const hex = "#8c5c4a";
    const [r, g, b] = hexToRgb(hex);
    expect(rgbToHex(r, g, b)).toBe(hex);
  });
});

describe("capitalize", () => {
  it("capitalizes lowercase", () => expect(capitalize("aries")).toBe("Aries"));
  it("leaves already capitalized", () =>
    expect(capitalize("Leo")).toBe("Leo"));
  it("handles single char", () => expect(capitalize("a")).toBe("A"));
});

describe("formatValue", () => {
  it("step scale rounds to integer", () =>
    expect(formatValue(3.7, { scale: "step" })).toBe("4"));

  it("dB positive with +", () =>
    expect(formatValue(5, { unit: "dB" })).toBe("+5"));
  it("dB zero without +", () =>
    expect(formatValue(0, { unit: "dB" })).toBe("0"));
  it("dB negative", () =>
    expect(formatValue(-12, { unit: "dB" })).toBe("-12"));

  it("Hz below 1k", () =>
    expect(formatValue(440, { unit: "Hz" })).toBe("440"));
  it("Hz above 1k uses k suffix", () =>
    expect(formatValue(2500, { unit: "Hz" })).toBe("2.5k"));

  it("seconds < 1 shows ms", () =>
    expect(formatValue(0.25, { unit: "s" })).toBe("250ms"));
  it("seconds >= 1 shows s", () =>
    expect(formatValue(1.5, { unit: "s" })).toBe("1.5s"));

  it("ms unit", () =>
    expect(formatValue(42, { unit: "ms" })).toBe("42ms"));

  it("percent scales ×100", () =>
    expect(formatValue(0.75, { unit: "%" })).toBe("75%"));

  it("no unit falls back to 2 decimal places", () =>
    expect(formatValue(3.14159, {})).toBe("3.14"));
});

describe("logMap", () => {
  const { mapFromNorm, mapToNorm } = logMap(20, 20000);

  it("maps 0 to min", () => expect(mapFromNorm(0)).toBeCloseTo(20));
  it("maps 1 to max", () => expect(mapFromNorm(1)).toBeCloseTo(20000));
  it("round-trips midpoint", () => {
    const mid = mapFromNorm(0.5);
    expect(mapToNorm(mid)).toBeCloseTo(0.5);
  });
  it("is logarithmic — midpoint is geometric mean", () => {
    const mid = mapFromNorm(0.5);
    expect(mid).toBeCloseTo(Math.sqrt(20 * 20000));
  });
});

describe("stepMap", () => {
  const { mapFromNorm, mapToNorm } = stepMap(1, 10);

  it("maps 0 to min", () => expect(mapFromNorm(0)).toBe(1));
  it("maps 1 to max", () => expect(mapFromNorm(1)).toBe(10));
  it("rounds to integers", () => expect(mapFromNorm(0.33)).toBe(4));
  it("inverse maps back (with quantization)", () => {
    // stepMap rounds, so round-trip only exact at integer boundaries
    const v = mapFromNorm(0.5); // round(1 + 4.5) = 6
    expect(v).toBe(6);
    expect(mapToNorm(v)).toBeCloseTo(5 / 9); // (6-1)/(10-1)
  });
});

describe("arc geometry", () => {
  it("constants are correct", () => {
    expect(DEG_TO_RAD).toBeCloseTo(Math.PI / 180);
    expect(KNOB_R).toBe(22);
    expect(KNOB_CX).toBe(28);
    expect(KNOB_CY).toBe(28);
    expect(KNOB_START).toBe(-135);
    expect(KNOB_END).toBe(135);
    expect(KNOB_SWEEP).toBe(270);
  });

  it("arcPoint at 0° is top-center", () => {
    const p = arcPoint(0);
    expect(p.x).toBeCloseTo(KNOB_CX);
    expect(p.y).toBeCloseTo(KNOB_CY - KNOB_R);
  });

  it("arcPoint at 90° is right-center", () => {
    const p = arcPoint(90);
    expect(p.x).toBeCloseTo(KNOB_CX + KNOB_R);
    expect(p.y).toBeCloseTo(KNOB_CY);
  });

  it("describeArc returns valid SVG path", () => {
    const path = describeArc(-135, 135);
    expect(path).toMatch(/^M [\d.]+ [\d.]+ A 22 22 0 1 1 [\d.]+ [\d.]+$/);
  });

  it("KNOB_TRACK_PATH is precomputed", () => {
    expect(KNOB_TRACK_PATH).toBe(describeArc(KNOB_START, KNOB_END));
  });
});
