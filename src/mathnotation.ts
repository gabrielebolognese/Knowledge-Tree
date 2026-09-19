import { GLYPH_RATIO } from "./config.js";

/**
 * Renders the ordinary notation people actually type — `sqrt(x^2+1)`, `v_0`,
 * `pi`, `<=` — as real maths. Deliberately not LaTeX: no backslashes, no
 * braces required, nothing to learn.
 */

export type MathBox =
  | { kind: "text"; text: string }
  | { kind: "row"; items: MathBox[] }
  | { kind: "script"; base: MathBox; sup: MathBox | null; sub: MathBox | null }
  | { kind: "sqrt"; radicand: MathBox };

/** Multi-character operators, longest first so the short ones cannot win early. */
const OPERATORS: ReadonlyArray<readonly [string, string]> = [
  ["<->", "↔"],
  ["<=>", "⇔"],
  ["...", "…"],
  ["<=", "≤"],
  [">=", "≥"],
  ["!=", "≠"],
  ["~=", "≈"],
  ["+-", "±"],
  ["-+", "∓"],
  ["->", "→"],
  ["=>", "⇒"],
  ["*", "·"],
];

/** Names that stand for a symbol, matched whole so `pizza` is safe. */
const NAMED: ReadonlyArray<readonly [string, string]> = [
  ["alpha", "α"],
  ["beta", "β"],
  ["gamma", "γ"],
  ["Gamma", "Γ"],
  ["delta", "δ"],
  ["Delta", "Δ"],
  ["epsilon", "ε"],
  ["theta", "θ"],
  ["lambda", "λ"],
  ["mu", "μ"],
  ["pi", "π"],
  ["rho", "ρ"],
  ["sigma", "σ"],
  ["Sigma", "Σ"],
  ["tau", "τ"],
  ["phi", "φ"],
  ["omega", "ω"],
  ["Omega", "Ω"],
  ["infinity", "∞"],
  ["inf", "∞"],
  ["sum", "Σ"],
  ["prod", "Π"],
  ["integral", "∫"],
  ["deg", "°"],
  ["!in", "∉"],
  ["in", "∈"],
  ["subset", "⊂"],
  ["union", "∪"],
  ["inter", "∩"],
  ["empty", "∅"],
];

/** Swaps typed shorthand for the symbol it means. Runs before parsing. */
export function applySymbols(text: string): string {
  let out = text;
  for (const [from, to] of NAMED) {
    // `sqrt` must survive intact, so names are matched as whole words only.
    const pattern = new RegExp(`(^|[^A-Za-z])${from.replace("!", "\\!")}(?![A-Za-z])`, "g");
    out = out.replace(pattern, (_match, prefix: string) => `${prefix}${to}`);
  }
  for (const [from, to] of OPERATORS) out = out.split(from).join(to);
  return out;
}

function rowOf(items: MathBox[]): MathBox {
  if (items.length === 1) return items[0] as MathBox;
  return { kind: "row", items };
}

const SCRIPT_RUN = /[A-Za-z0-9.α-ωΓΔΣΠΩ∞]/;

/** The operand a `^` or `_` applies to: a bracketed group, or a short run. */
function parseOperand(src: string, start: number): { box: MathBox; next: number } {
  let i = start;
  if (src[i] === "(" || src[i] === "{") {
    const close = src[i] === "(" ? ")" : "}";
    const inner = parseSequence(src, i + 1, close);
    i = inner.next;
    if (src[i] === close) i += 1;
    return { box: rowOf(inner.items), next: i };
  }

  let run = "";
  if (src[i] === "-" || src[i] === "+") {
    run += src[i];
    i += 1;
  }
  while (i < src.length && SCRIPT_RUN.test(src[i] as string)) {
    run += src[i];
    i += 1;
  }
  if (run === "") return { box: { kind: "text", text: "" }, next: start };
  return { box: { kind: "text", text: run }, next: i };
}

function parseSequence(
  src: string,
  start: number,
  stopAt: string | null,
): { items: MathBox[]; next: number } {
  const items: MathBox[] = [];
  let buffer = "";
  let i = start;

  const flush = (): void => {
    if (buffer !== "") {
      items.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  /** Pulls off the single atom a script attaches to. */
  const takeBase = (): MathBox => {
    if (buffer !== "") {
      const last = buffer.slice(-1);
      buffer = buffer.slice(0, -1);
      flush();
      return { kind: "text", text: last };
    }
    const previous = items.pop();
    return previous ?? { kind: "text", text: "" };
  };

  while (i < src.length) {
    const ch = src[i] as string;
    if (stopAt !== null && ch === stopAt) break;

    if (src.startsWith("sqrt(", i)) {
      flush();
      const inner = parseSequence(src, i + 5, ")");
      items.push({ kind: "sqrt", radicand: rowOf(inner.items) });
      i = inner.next;
      if (src[i] === ")") i += 1;
      continue;
    }

    if (ch === "^" || ch === "_") {
      // Check there is something to raise BEFORE detaching the base, or a
      // trailing caret would swallow the character in front of it.
      const operand = parseOperand(src, i + 1);
      if (operand.next === i + 1) {
        buffer += ch;
        i += 1;
        continue;
      }

      const base = takeBase();
      const existing =
        base.kind === "script" ? base : { kind: "script" as const, base, sup: null, sub: null };
      items.push(
        ch === "^"
          ? { ...existing, sup: operand.box }
          : { ...existing, sub: operand.box },
      );
      i = operand.next;
      continue;
    }

    if (ch === "(") {
      flush();
      const inner = parseSequence(src, i + 1, ")");
      items.push({
        kind: "row",
        items: [{ kind: "text", text: "(" }, rowOf(inner.items), { kind: "text", text: ")" }],
      });
      i = inner.next;
      if (src[i] === ")") i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return { items, next: i };
}

export function parseMath(text: string): MathBox {
  const { items } = parseSequence(applySymbols(text), 0, null);
  return items.length === 0 ? { kind: "text", text: "" } : rowOf(items);
}

// --- measuring -------------------------------------------------------------

export interface MathMetrics {
  width: number;
  /** Height above the baseline. */
  ascent: number;
  /** Depth below the baseline. */
  descent: number;
}

const SCRIPT_SCALE = 0.72;
const SUP_SHIFT = 0.42;
const SUB_SHIFT = 0.22;
const RADICAL_WIDTH = 0.62;
const RADICAL_GAP = 0.18;
const RADICAL_TAIL = 0.14;

export function measureMath(box: MathBox, fontSize: number): MathMetrics {
  switch (box.kind) {
    case "text":
      return {
        width: box.text.length * fontSize * GLYPH_RATIO,
        ascent: fontSize * 0.72,
        descent: fontSize * 0.2,
      };

    case "row": {
      let width = 0;
      let ascent = 0;
      let descent = 0;
      for (const item of box.items) {
        const m = measureMath(item, fontSize);
        width += m.width;
        ascent = Math.max(ascent, m.ascent);
        descent = Math.max(descent, m.descent);
      }
      return { width, ascent, descent };
    }

    case "script": {
      const base = measureMath(box.base, fontSize);
      const small = fontSize * SCRIPT_SCALE;
      const sup = box.sup ? measureMath(box.sup, small) : null;
      const sub = box.sub ? measureMath(box.sub, small) : null;

      return {
        width: base.width + Math.max(sup?.width ?? 0, sub?.width ?? 0),
        ascent: Math.max(base.ascent, sup ? fontSize * SUP_SHIFT + sup.ascent : 0),
        descent: Math.max(base.descent, sub ? fontSize * SUB_SHIFT + sub.descent : 0),
      };
    }

    case "sqrt": {
      const rad = measureMath(box.radicand, fontSize);
      return {
        width: fontSize * (RADICAL_WIDTH + RADICAL_TAIL) + rad.width,
        ascent: rad.ascent + fontSize * RADICAL_GAP,
        descent: rad.descent,
      };
    }
  }
}

// --- drawing ---------------------------------------------------------------

export type MathGlyph =
  | { kind: "text"; text: string; x: number; y: number; fontSize: number }
  | { kind: "bar"; x1: number; x2: number; y: number; thickness: number };

/**
 * Flattens a box into positioned glyphs, ready to emit as SVG.
 * `x` is the left edge and `baseline` the baseline of the main run.
 */
export function layoutMath(
  box: MathBox,
  fontSize: number,
  x: number,
  baseline: number,
): MathGlyph[] {
  const glyphs: MathGlyph[] = [];

  switch (box.kind) {
    case "text":
      if (box.text !== "") glyphs.push({ kind: "text", text: box.text, x, y: baseline, fontSize });
      return glyphs;

    case "row": {
      let cursor = x;
      for (const item of box.items) {
        glyphs.push(...layoutMath(item, fontSize, cursor, baseline));
        cursor += measureMath(item, fontSize).width;
      }
      return glyphs;
    }

    case "script": {
      const base = measureMath(box.base, fontSize);
      const small = fontSize * SCRIPT_SCALE;
      glyphs.push(...layoutMath(box.base, fontSize, x, baseline));

      if (box.sup) {
        glyphs.push(...layoutMath(box.sup, small, x + base.width, baseline - fontSize * SUP_SHIFT));
      }
      if (box.sub) {
        glyphs.push(...layoutMath(box.sub, small, x + base.width, baseline + fontSize * SUB_SHIFT));
      }
      return glyphs;
    }

    case "sqrt": {
      const rad = measureMath(box.radicand, fontSize);
      const signWidth = fontSize * RADICAL_WIDTH;
      const barY = baseline - rad.ascent - fontSize * RADICAL_GAP * 0.55;

      // The tick itself, then the bar running over everything under the root.
      glyphs.push({
        kind: "text",
        text: "√",
        x,
        y: baseline,
        fontSize: fontSize * 1.08,
      });
      glyphs.push({
        kind: "bar",
        x1: x + signWidth * 0.93,
        x2: x + signWidth + rad.width + fontSize * RADICAL_TAIL,
        y: barY,
        thickness: Math.max(0.8, fontSize * 0.06),
      });
      glyphs.push(...layoutMath(box.radicand, fontSize, x + signWidth, baseline));
      return glyphs;
    }
  }
}

/** Renders one typed line, cut to fit the width it is given. */
export function fitMathLine(source: string, fontSize: number, maxWidth: number): MathBox {
  const box = parseMath(source);
  if (measureMath(box, fontSize).width <= maxWidth) return box;

  // Superscripts only ever shrink a line, so trimming the source is safe.
  const perChar = fontSize * GLYPH_RATIO;
  const room = Math.max(1, Math.floor(maxWidth / perChar) - 1);
  return parseMath(`${source.slice(0, room)}…`);
}
