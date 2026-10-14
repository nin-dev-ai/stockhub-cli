import { describe, it, expect } from "vitest";
import {
  fmtPrice, fmtInt, fmtVolume, fmtPct, fmtPctFromDecimal, dirClass,
} from "./format";

// The PRD requires missing data to read as missing ("—"), never as a
// valid zero. These tests pin that distinction.
describe("missing vs zero", () => {
  it("renders null/undefined/NaN as an em dash", () => {
    for (const v of [null, undefined, NaN]) {
      expect(fmtPrice(v)).toBe("—");
      expect(fmtInt(v)).toBe("—");
      expect(fmtVolume(v)).toBe("—");
      expect(fmtPct(v)).toBe("—");
      expect(fmtPctFromDecimal(v)).toBe("—");
    }
  });
  it("renders an actual zero as a number, not a dash", () => {
    expect(fmtPrice(0)).toBe("0.00");
    expect(fmtInt(0)).toBe("0");
    expect(fmtVolume(0)).toBe("0");
    expect(fmtPct(0)).toBe("0.00%");
  });
});

describe("fmtPrice", () => {
  it("defaults to two decimals and honors the digits argument", () => {
    expect(fmtPrice(12.3)).toBe("12.30");
    expect(fmtPrice(12.345, 3)).toBe("12.345");
  });
});

describe("fmtVolume", () => {
  it("abbreviates magnitudes", () => {
    expect(fmtVolume(1_500)).toBe("1.50K");
    expect(fmtVolume(2_000_000)).toBe("2.00M");
    expect(fmtVolume(3_000_000_000)).toBe("3.00B");
    expect(fmtVolume(4_000_000_000_000)).toBe("4.00T");
  });
  it("leaves sub-thousand values unscaled", () => {
    expect(fmtVolume(999)).toBe("999");
  });
});

describe("fmtPct", () => {
  it("adds a plus sign for positive values only", () => {
    expect(fmtPct(1.5)).toBe("+1.50%");
    expect(fmtPct(-1.5)).toBe("-1.50%");
    expect(fmtPct(0)).toBe("0.00%");
  });
});

describe("fmtPctFromDecimal", () => {
  it("scales a decimal ratio into a percentage", () => {
    expect(fmtPctFromDecimal(0.1234)).toBe("+12.34%");
  });
});

describe("dirClass", () => {
  it("maps sign to a direction class, treating missing as flat", () => {
    expect(dirClass(1)).toBe("up");
    expect(dirClass(0)).toBe("up");
    expect(dirClass(-1)).toBe("down");
    expect(dirClass(null)).toBe("flat");
    expect(dirClass(NaN)).toBe("flat");
  });
});
