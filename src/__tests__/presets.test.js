import { describe, it, expect } from "vitest";

const presetModules = import.meta.glob("../presets/*.js", { eager: true });

const REQUIRED_EXPORTS = ["TUNING", "SHADOW", "MACROS", "LISTEN_PRESETS", "CHAINS", "ACTIVE_CHAIN"];

describe("presets", () => {
  const entries = Object.entries(presetModules);

  it("found preset files", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const [path, mod] of entries) {
    const name = path.split("/").pop();

    describe(name, () => {
      for (const key of REQUIRED_EXPORTS) {
        it(`exports ${key}`, () => {
          expect(mod, `${name} missing ${key}`).toHaveProperty(key);
        });
      }

      it("TUNING.sampleRate is numeric", () => {
        expect(typeof mod.TUNING.sampleRate).toBe("number");
      });

      it("ACTIVE_CHAIN exists in CHAINS", () => {
        expect(mod.CHAINS).toHaveProperty(mod.ACTIVE_CHAIN);
      });
    });
  }
});
