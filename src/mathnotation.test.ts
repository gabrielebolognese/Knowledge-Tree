import { describe, expect, it } from "vitest";

import {
  applySymbols,
  fitMathLine,
  layoutMath,
  measureMath,
  parseMath,
  type MathBox,
  type MathGlyph,
} from "./mathnotation.js";

/** Every character the layout would actually draw, in order. */
function drawnText(glyphs: readonly MathGlyph[]): string {
  return glyphs
    .filter((g): g is Extract<MathGlyph, { kind: "text" }> => g.kind === "text")
    .map((g) => g.text)
    .join("");
}

function bars(glyphs: readonly MathGlyph[]): Extract<MathGlyph, { kind: "bar" }>[] {
  return glyphs.filter((g): g is Extract<MathGlyph, { kind: "bar" }> => g.kind === "bar");
}

function render(source: string, fontSize = 12): MathGlyph[] {
  return layoutMath(parseMath(source), fontSize, 0, 0);
}

describe("symbols", () => {
  it("swaps the operators people actually type", () => {
    expect(applySymbols("a <= b")).toBe("a ≤ b");
    expect(applySymbols("a >= b")).toBe("a ≥ b");
    expect(applySymbols("a != b")).toBe("a ≠ b");
    expect(applySymbols("x +- 1")).toBe("x ± 1");
    expect(applySymbols("f -> 0")).toBe("f → 0");
    expect(applySymbols("2*3")).toBe("2·3");
  });

  it("swaps named constants", () => {
    expect(applySymbols("2pi r")).toBe("2π r");
    expect(applySymbols("theta + alpha")).toBe("θ + α");
    expect(applySymbols("x -> inf")).toBe("x → ∞");
  });

  it("leaves ordinary words alone", () => {
    expect(applySymbols("pizza")).toBe("pizza");
    expect(applySymbols("input")).toBe("input");
    expect(applySymbols("sqrt(4)")).toBe("sqrt(4)");
  });
});

describe("superscripts", () => {
  it("raises a single character", () => {
    const box = parseMath("x^2");
    expect(box).toMatchObject({ kind: "script", base: { text: "x" }, sup: { text: "2" } });
  });

  it("raises only the last symbol, not the whole run", () => {
    const glyphs = render("2ax^2");
    expect(drawnText(glyphs)).toBe("2ax2");

    // The exponent is smaller and sits above the baseline.
    const exponent = glyphs.find((g) => g.kind === "text" && g.text === "2");
    expect(exponent?.kind).toBe("text");
    if (exponent?.kind === "text") {
      expect(exponent.y).toBeLessThan(0);
      expect(exponent.fontSize).toBeLessThan(12);
    }
  });

  it("takes a bracketed exponent whole, and drops the brackets", () => {
    expect(drawnText(render("e^(n+1)"))).toBe("en+1");
    expect(drawnText(render("e^{n+1}"))).toBe("en+1");
  });

  it("handles a negative exponent", () => {
    expect(drawnText(render("x^-1"))).toBe("x-1");
  });

  it("puts a subscript below the baseline", () => {
    const glyphs = render("v_0");
    const zero = glyphs.find((g) => g.kind === "text" && g.text === "0");
    if (zero?.kind === "text") expect(zero.y).toBeGreaterThan(0);
    else throw new Error("expected a subscript glyph");
  });

  it("carries both a subscript and a superscript on one base", () => {
    const box = parseMath("x_1^2");
    expect(box).toMatchObject({ kind: "script", sup: { text: "2" }, sub: { text: "1" } });
  });

  it("leaves a stray caret as an ordinary character", () => {
    expect(drawnText(render("a^"))).toBe("a^");
  });
});

describe("roots", () => {
  it("draws a radical sign and a bar over the radicand", () => {
    const glyphs = render("sqrt(2)");

    expect(drawnText(glyphs)).toContain("√");
    expect(drawnText(glyphs)).toContain("2");
    expect(bars(glyphs)).toHaveLength(1);
  });

  it("runs the bar across everything under the root", () => {
    const narrow = bars(render("sqrt(2)"))[0];
    const wide = bars(render("sqrt(x^2 + y^2)"))[0];
    expect(narrow).toBeDefined();
    expect(wide).toBeDefined();
    expect((wide?.x2 ?? 0) - (wide?.x1 ?? 0)).toBeGreaterThan((narrow?.x2 ?? 0) - (narrow?.x1 ?? 0));
  });

  it("sits the bar above the baseline", () => {
    const bar = bars(render("sqrt(9)"))[0];
    expect(bar?.y).toBeLessThan(0);
  });

  it("nests inside another root", () => {
    const glyphs = render("sqrt(1 + sqrt(2))");
    expect(bars(glyphs)).toHaveLength(2);
  });

  it("makes room for the radicand, not just the sign", () => {
    const small = measureMath(parseMath("sqrt(2)"), 12);
    const big = measureMath(parseMath("sqrt(x^2 + y^2 + z^2)"), 12);
    expect(big.width).toBeGreaterThan(small.width);
  });

  it("is taller than plain text, because of the bar", () => {
    const plain = measureMath(parseMath("2"), 12);
    const root = measureMath(parseMath("sqrt(2)"), 12);
    expect(root.ascent).toBeGreaterThan(plain.ascent);
  });
});

describe("brackets", () => {
  it("keeps ordinary brackets visible", () => {
    expect(drawnText(render("(a + b)/2"))).toBe("(a + b)/2");
  });

  it("does not lose an unclosed bracket's contents", () => {
    expect(drawnText(render("sqrt(2"))).toContain("2");
  });
});

describe("a realistic example line", () => {
  it("renders the quadratic formula the way it is typed", () => {
    const glyphs = render("x = (-b +- sqrt(b^2 - 4ac)) / 2a");

    const text = drawnText(glyphs);
    expect(text).toContain("±"); // +-
    expect(text).toContain("√"); // sqrt
    expect(bars(glyphs)).toHaveLength(1);
    // The squared b is raised.
    const raised = glyphs.filter((g) => g.kind === "text" && g.y < 0);
    expect(raised.length).toBeGreaterThan(0);
  });

  it("measures wider as the line grows", () => {
    const short = measureMath(parseMath("x = 1"), 12);
    const long = measureMath(parseMath("x = (-b +- sqrt(b^2 - 4ac)) / 2a"), 12);
    expect(long.width).toBeGreaterThan(short.width);
  });
});

describe("fitting to a width", () => {
  it("leaves a line that already fits untouched", () => {
    const box = fitMathLine("x^2 + 1", 12, 400);
    expect(drawnText(layoutMath(box, 12, 0, 0))).toBe("x2 + 1");
  });

  it("cuts an over-long line and marks it", () => {
    const box = fitMathLine("x".repeat(400), 12, 120);
    const rendered = drawnText(layoutMath(box, 12, 0, 0));

    expect(rendered.endsWith("…")).toBe(true);
    expect(measureMath(box, 12).width).toBeLessThanOrEqual(120);
  });
});

describe("degenerate input", () => {
  const cases: ReadonlyArray<string> = ["", "   ", "^", "_", "sqrt(", ")", "((((", "^^^", "x_"];

  it("never throws, whatever is typed", () => {
    for (const source of cases) {
      expect(() => render(source)).not.toThrow();
      expect(() => measureMath(parseMath(source), 12)).not.toThrow();
    }
  });

  it("measures empty input as nothing wide", () => {
    expect(measureMath(parseMath(""), 12).width).toBe(0);
  });
});

describe("plain text is left alone", () => {
  it("passes ordinary prose straight through", () => {
    const source = "area of a circle";
    const box: MathBox = parseMath(source);
    expect(box).toEqual({ kind: "text", text: source });
  });
});
