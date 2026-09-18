import { ARROW_GAP, COL_W, MAIN_SCALE, R_SIDE, ROW_H } from "./config.js";
import type { Cell, Direction, FittedTitle, Point, TreeNode } from "./types.js";

/** Grid cell -> world coordinates (centre of the circle). */
export function cellToWorld(cell: Cell): Point {
  return { x: cell.col * COL_W, y: cell.row * ROW_H };
}

/** World coordinates -> nearest grid cell. */
export function worldToCell(p: Point): Cell {
  return { col: Math.round(p.x / COL_W), row: Math.round(p.y / ROW_H) };
}

export function radiusOf(node: Pick<TreeNode, "main">): number {
  return node.main ? R_SIDE * MAIN_SCALE : R_SIDE;
}

/** The cell a child would occupy if nothing were in the way. */
export function targetCell(parent: Cell, dir: Direction): Cell {
  const dcol = dir === "down-left" ? -1 : dir === "down-right" ? 1 : 0;
  return { col: parent.col + dcol, row: parent.row + 1 };
}

/**
 * First free cell at or beside `cell`, stepping sideways so a new node never
 * lands on top of an existing one. `step` sets which way it drifts.
 */
export function findFreeCell(occupied: Iterable<Cell>, cell: Cell, step: number): Cell {
  const taken = new Set<string>();
  for (const c of occupied) taken.add(`${c.col},${c.row}`);

  const dir = step === 0 ? 1 : Math.sign(step);
  let { col, row } = cell;
  for (let i = 0; i < 1000 && taken.has(`${col},${row}`); i++) {
    col += dir;
  }
  return { col, row };
}

/** A straight arrow, trimmed so it starts and ends outside both circles. */
export function edgeGeometry(
  from: Point,
  to: Point,
  rFrom: number,
  rTo: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const head = rFrom + rTo + ARROW_GAP;
  if (dist <= head) return null;

  const ux = dx / dist;
  const uy = dy / dist;
  return {
    x1: from.x + ux * (rFrom + 4),
    y1: from.y + uy * (rFrom + 4),
    x2: to.x - ux * (rTo + ARROW_GAP),
    y2: to.y - uy * (rTo + ARROW_GAP),
  };
}

// --- fitting a title inside a circle ---------------------------------------

/** Keeps text clear of the stroke. */
const INSET = 0.86;
/** Average glyph width as a fraction of the font size, for our UI sans stack. */
const CHAR_RATIO = 0.55;
const LINE_RATIO = 1.2;
const MAX_LINES = 5;

/** Font size for a title inside a circle of this radius. */
export function titleFontSize(radius: number): number {
  return Math.max(9, Math.round(radius * 0.19));
}

/**
 * Characters that fit on each of `count` lines stacked in the middle of the
 * circle. Lines near the centre are wider than lines near the top and bottom,
 * which is what makes the block read as circular rather than rectangular.
 */
function lineBudgets(count: number, radius: number, fontSize: number): number[] {
  const lineHeight = fontSize * LINE_RATIO;
  const charWidth = fontSize * CHAR_RATIO;
  const budgets: number[] = [];

  for (let i = 0; i < count; i++) {
    const centre = (i - (count - 1) / 2) * lineHeight;
    // Measure at the far edge of the glyph box, not its centre.
    const edge = Math.abs(centre) + lineHeight * 0.38;
    const half = Math.sqrt(Math.max(0, radius * radius - edge * edge)) * INSET;
    budgets.push(Math.max(0, Math.floor((half * 2) / charWidth)));
  }
  return budgets;
}

/** Greedy wrap against per-line budgets, hard-splitting over-long words. */
function wrapToBudgets(
  words: readonly string[],
  budgets: readonly number[],
): { lines: string[]; leftover: boolean } {
  const queue = [...words];
  const lines: string[] = [];

  for (const budget of budgets) {
    if (queue.length === 0) break;
    if (budget < 2) return { lines, leftover: true };

    let line = "";
    while (queue.length > 0) {
      const word = queue[0] ?? "";
      const next = line ? `${line} ${word}` : word;
      if (next.length <= budget) {
        line = next;
        queue.shift();
        continue;
      }
      if (!line) {
        queue[0] = word.slice(budget);
        line = word.slice(0, budget);
      }
      break;
    }
    lines.push(line);
  }
  return { lines, leftover: queue.length > 0 };
}

/**
 * Wraps a title so it sits inside a circle, using as few lines as possible.
 * Fewer lines sit nearer the centre where the circle is widest, so a result
 * that fits at `n` lines always still fits when centred on `lines.length`.
 */
export function fitTitle(title: string, radius: number): FittedTitle {
  const fontSize = titleFontSize(radius);
  const lineHeight = fontSize * LINE_RATIO;
  const words = title.trim().split(/\s+/).filter(Boolean);

  const build = (lines: string[]): FittedTitle => ({
    lines,
    fontSize,
    lineHeight,
    firstBaseline: (-(lines.length - 1) / 2) * lineHeight + fontSize * 0.34,
  });

  if (words.length === 0) return build([]);

  for (let count = 1; count <= MAX_LINES; count++) {
    const { lines, leftover } = wrapToBudgets(words, lineBudgets(count, radius, fontSize));
    if (!leftover) return build(lines);
  }

  // Longer than the circle can hold: fill it and mark the cut.
  const budgets = lineBudgets(MAX_LINES, radius, fontSize);
  const { lines } = wrapToBudgets(words, budgets);
  const last = lines.length - 1;
  const budget = budgets[last] ?? 0;
  if (last >= 0) {
    lines[last] = `${(lines[last] ?? "").slice(0, Math.max(1, budget - 1))}…`;
  }
  return build(lines);
}

/** Bounding box of all nodes in world units, padded by their radius. */
export function contentBounds(
  nodes: readonly TreeNode[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const { x, y } = cellToWorld(node);
    const r = radiusOf(node) + 70;
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  }
  return { minX, minY, maxX, maxY };
}
