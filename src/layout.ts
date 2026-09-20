import {
  ARROW_GAP,
  CARD_H,
  CARD_PADDING,
  CARD_W,
  COL_W,
  COROLLARY_ROW_STEP,
  COROLLARY_SCALE,
  MAIN_SCALE,
  R_SIDE,
  ROW_H,
  GLYPH_RATIO,
  IMPORTANT_H,
  IMPORTANT_W,
  ROW_SNAP,
  TITLE_MAX,
  TITLE_MAX_BUBBLE,
  TITLE_MAX_CARD,
} from "./config.js";
import { fitMathLine, measureMath, type MathBox } from "./mathnotation.js";
import type {
  Cell,
  Direction,
  Edge,
  FittedTitle,
  NodeId,
  Point,
  TabProfile,
  TreeNode,
} from "./types.js";

/** What a node is drawn as. Subjects differ, so this is never assumed. */
export type NodeShape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; halfWidth: number; halfHeight: number };

/** A card only appears on the main rail, and only where the profile asks for one. */
export function isCard(node: Pick<TreeNode, "main">, profile: TabProfile): boolean {
  return profile.cards && node.main;
}

/** An important side node: squared off, but only where the subject allows it. */
export function isImportant(
  node: Pick<TreeNode, "main" | "important">,
  profile: TabProfile,
): boolean {
  return profile.important && !node.main && node.important;
}

export function shapeOf(
  node: Pick<TreeNode, "main" | "corollary" | "important">,
  profile: TabProfile,
): NodeShape {
  if (isCard(node, profile)) {
    return { kind: "rect", halfWidth: CARD_W / 2, halfHeight: CARD_H / 2 };
  }
  if (isImportant(node, profile)) {
    // Sized off the circle it replaces, so a corollary's box shrinks with it.
    const scale = radiusOf(node) / R_SIDE;
    return {
      kind: "rect",
      halfWidth: (IMPORTANT_W / 2) * scale,
      halfHeight: (IMPORTANT_H / 2) * scale,
    };
  }
  return { kind: "circle", radius: radiusOf(node) };
}

/** Characters a title may hold, which depends on what it is drawn on. */
export function titleLimitFor(node: Pick<TreeNode, "main">, profile: TabProfile): number {
  if (profile.bubbles) return TITLE_MAX_BUBBLE;
  return isCard(node, profile) ? TITLE_MAX_CARD : TITLE_MAX;
}

/** How far the outline sits from the centre along a unit direction. */
export function exitDistance(shape: NodeShape, ux: number, uy: number): number {
  if (shape.kind === "circle") return shape.radius;
  const toSide = ux === 0 ? Infinity : shape.halfWidth / Math.abs(ux);
  const toCap = uy === 0 ? Infinity : shape.halfHeight / Math.abs(uy);
  return Math.min(toSide, toCap);
}

/** Rows sit on a 0.2 grid, so a 0.8 corollary step never drifts in floating point. */
export function snapRow(row: number): number {
  return Math.round(row / ROW_SNAP) * ROW_SNAP;
}

/** Grid cell -> world coordinates (centre of the circle). */
export function cellToWorld(cell: Cell): Point {
  return { x: cell.col * COL_W, y: cell.row * ROW_H };
}

/** World coordinates -> nearest grid cell. */
export function worldToCell(p: Point): Cell {
  return { col: Math.round(p.x / COL_W), row: snapRow(p.y / ROW_H) };
}

export function radiusOf(node: Pick<TreeNode, "main" | "corollary">): number {
  if (node.main) return R_SIDE * MAIN_SCALE;
  if (node.corollary) return R_SIDE * COROLLARY_SCALE;
  return R_SIDE;
}

/** How far below its parent a child sits: a corollary comes in 20% closer. */
export function rowStepFor(childIsCorollary: boolean): number {
  return childIsCorollary ? COROLLARY_ROW_STEP : 1;
}

/** True when a child grown in this direction inherits corollary status. */
export function childIsCorollary(parent: Pick<TreeNode, "corollary">, dir: Direction): boolean {
  return parent.corollary && dir === "down";
}

/** The cell a child would occupy if nothing were in the way. */
export function targetCell(parent: Pick<TreeNode, "col" | "row" | "corollary">, dir: Direction): Cell {
  const dcol = dir === "down-left" ? -1 : dir === "down-right" ? 1 : 0;
  return {
    col: parent.col + dcol,
    row: snapRow(parent.row + rowStepFor(childIsCorollary(parent, dir))),
  };
}

// --- occupancy -------------------------------------------------------------

/**
 * Minimum vertical gap between two nodes in the same column. A corollary step
 * is exactly this, so a corollary tucks under its parent without crowding it,
 * while anything closer would have the circles overlap.
 */
const MIN_ROW_GAP = COROLLARY_ROW_STEP;
const EPSILON = 1e-9;

/** True when two positions are too close to both be drawn. */
export function overlaps(a: Cell, b: Cell): boolean {
  return a.col === b.col && Math.abs(a.row - b.row) < MIN_ROW_GAP - EPSILON;
}

/**
 * First free cell at or beside `cell`, stepping sideways. Only used where the
 * new node has no claim on an exact position — a loose node, or a spot the
 * main rail is holding and will not give up.
 */
export function findFreeCell(occupied: Iterable<Cell>, cell: Cell, step: number): Cell {
  const taken = [...occupied];
  const dir = step === 0 ? 1 : Math.sign(step);

  let col = cell.col;
  for (let i = 0; i < 1000; i++) {
    const candidate = { col, row: cell.row };
    if (!taken.some((c) => overlaps(c, candidate))) return candidate;
    col += dir;
  }
  return { col, row: cell.row };
}

// --- making room -----------------------------------------------------------

/** How far sideways a branch may be shoved before we give up and drift instead. */
const MAX_PUSH = 60;

/**
 * Every node hanging off `rootId`, following arrows outward.
 *
 * Main-rail nodes are neither included nor traversed through: the spine is the
 * backbone of the tree and never gets shoved aside. That also stops a
 * shift-clicked arrow back to the main rail from dragging the whole timeline.
 */
export function branchOf(
  rootId: NodeId,
  nodes: readonly TreeNode[],
  edges: readonly Edge[],
): Set<NodeId> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    const list = children.get(edge.from);
    if (list) list.push(edge.to);
    else children.set(edge.from, [edge.to]);
  }

  const branch = new Set<NodeId>();
  const queue: NodeId[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || branch.has(id)) continue;

    const node = byId.get(id);
    if (!node || node.main) continue;

    branch.add(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }
  return branch;
}

/**
 * Which way a displaced node should slide: away from its own parent, so the
 * arrow feeding it simply gets longer rather than doubling back.
 */
function pushDirection(node: TreeNode, nodes: readonly TreeNode[], edges: readonly Edge[]): number {
  const incoming = edges.find((edge) => edge.to === node.id);
  const parent = incoming ? nodes.find((n) => n.id === incoming.from) : undefined;
  if (parent && parent.col !== node.col) return Math.sign(node.col - parent.col);
  return 1;
}

export interface Placement {
  /** Where the new node goes. */
  cell: Cell;
  /** Existing nodes that have to shift to keep that cell free. */
  moves: Map<NodeId, Cell>;
}

/**
 * Works out where a new child belongs, and what has to move to let it sit
 * there. The requested direction is honoured exactly: down means down.
 *
 * When the cell is taken, the occupying branch slides sideways as one piece —
 * far enough to clear everything, keeping its own shape — rather than the new
 * node being bumped somewhere it was never asked to go.
 */
export function planPlacement(
  parent: TreeNode,
  dir: Direction,
  nodes: readonly TreeNode[],
  edges: readonly Edge[],
): Placement {
  const target = targetCell(parent, dir);
  const occupant = nodes.find((n) => overlaps(n, target));
  if (!occupant) return { cell: target, moves: new Map() };

  const drift = dir === "down-left" ? -1 : 1;
  const branch = branchOf(occupant.id, nodes, edges);

  // The main rail is holding the spot and never moves, so step the new node aside.
  if (branch.size === 0) {
    return { cell: findFreeCell(nodes, target, drift), moves: new Map() };
  }

  const movable = nodes.filter((n) => branch.has(n.id));
  const anchored = nodes.filter((n) => !branch.has(n.id));
  const push = pushDirection(occupant, nodes, edges);

  for (let distance = 1; distance <= MAX_PUSH; distance++) {
    const placed: Cell[] = anchored.map((n) => ({ col: n.col, row: n.row }));
    const moves = new Map<NodeId, Cell>();

    let fits = true;
    for (const node of movable) {
      const cell = { col: node.col + distance * push, row: node.row };
      if (placed.some((c) => overlaps(c, cell))) {
        fits = false;
        break;
      }
      placed.push(cell);
      moves.set(node.id, cell);
    }

    if (fits && !placed.some((c) => overlaps(c, target))) return { cell: target, moves };
  }

  // Nowhere to shove it; leave the tree alone and place the new node beside.
  return { cell: findFreeCell(nodes, target, drift), moves: new Map() };
}

// --- arrows ----------------------------------------------------------------

/** A straight arrow, trimmed so it starts and ends outside both outlines. */
export function edgeGeometry(
  from: Point,
  to: Point,
  fromShape: NodeShape,
  toShape: NodeShape,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;

  const ux = dx / dist;
  const uy = dy / dist;
  const start = exitDistance(fromShape, ux, uy) + 4;
  const end = exitDistance(toShape, ux, uy) + ARROW_GAP;
  if (dist <= start + end) return null;

  return {
    x1: from.x + ux * start,
    y1: from.y + uy * start,
    x2: to.x - ux * end,
    y2: to.y - uy * end,
  };
}

// --- fitting a title inside a circle ---------------------------------------

/** Keeps text clear of the stroke. */
const INSET = 0.86;
const CHAR_RATIO = GLYPH_RATIO;
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

const BOX_PADDING = 12;
const BOX_LINE_RATIO = 1.25;
const BOX_MAX_LINES = 4;

export interface FittedBox {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  firstBaseline: number;
}

/**
 * Wraps a title inside a rounded box. Simpler than a circle: the width is the
 * same on every line, so there is no arc to hug.
 */
export function fitBoxTitle(title: string, halfWidth: number, halfHeight: number): FittedBox {
  const fontSize = Math.max(9, Math.round(halfHeight * 0.21));
  const lineHeight = fontSize * BOX_LINE_RATIO;
  const padding = BOX_PADDING * Math.max(0.7, halfHeight / (IMPORTANT_H / 2));

  const budget = Math.max(
    1,
    Math.floor((halfWidth * 2 - padding * 2) / (fontSize * CHAR_RATIO)),
  );
  const maxLines = Math.max(
    1,
    Math.min(BOX_MAX_LINES, Math.floor((halfHeight * 2 - padding) / lineHeight)),
  );

  const words = title.trim().split(/\s+/).filter(Boolean);
  const { lines, leftover } = wrapToBudgets(words, Array(maxLines).fill(budget));
  if (leftover && lines.length > 0) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${last.slice(0, Math.max(1, budget - 1))}\u2026`;
  }

  return {
    lines,
    fontSize,
    lineHeight,
    firstBaseline: (-(lines.length - 1) / 2) * lineHeight + fontSize * 0.34,
  };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box a node actually occupies on screen, whatever shape it is. */
export function nodeBounds(node: TreeNode, profile: TabProfile): Bounds {
  const { x, y } = cellToWorld(node);
  const shape = shapeOf(node, profile);
  const hw = shape.kind === "circle" ? shape.radius : shape.halfWidth;
  const hh = shape.kind === "circle" ? shape.radius : shape.halfHeight;
  return { minX: x - hw, minY: y - hh, maxX: x + hw, maxY: y + hh };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Every node the given box touches, however slightly. */
export function nodesWithin(
  nodes: readonly TreeNode[],
  profile: TabProfile,
  box: Bounds,
): TreeNode[] {
  return nodes.filter((node) => boundsIntersect(nodeBounds(node, profile), box));
}

const BUBBLE_WORD_RATIO = 0.26;
const BUBBLE_GLOSS_RATIO = 0.2;

export interface FittedBubble {
  wordLines: string[];
  wordFontSize: number;
  wordLineHeight: number;
  glossLines: string[];
  glossFontSize: number;
  glossLineHeight: number;
  /** Baseline of the first word line, relative to the bubble's centre. */
  firstBaseline: number;
  /** Baseline of the first gloss line, or null when there is no translation. */
  glossBaseline: number | null;
}

/**
 * A vocabulary bubble: the word, and under it what it means. Both are wrapped
 * to the circle, and the pair is centred as one block.
 */
export function fitBubble(word: string, translation: string, radius: number): FittedBubble {
  const wordFont = Math.max(11, Math.round(radius * BUBBLE_WORD_RATIO));
  const glossFont = Math.max(9, Math.round(radius * BUBBLE_GLOSS_RATIO));
  const wordLH = wordFont * 1.15;
  const glossLH = glossFont * 1.15;

  const budget = (fontSize: number): number =>
    Math.max(1, Math.floor((radius * 1.55) / (fontSize * CHAR_RATIO)));

  const wrap = (text: string, fontSize: number, maxLines: number): string[] => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const room = budget(fontSize);
    const { lines, leftover } = wrapToBudgets(words, Array(maxLines).fill(room));
    if (leftover && lines.length > 0) {
      const last = lines[lines.length - 1] ?? "";
      lines[lines.length - 1] = `${last.slice(0, Math.max(1, room - 1))}\u2026`;
    }
    return lines;
  };

  const wordLines = wrap(word || "\u2026", wordFont, 2);
  const glossLines = wrap(translation, glossFont, 2);

  const wordHeight = wordLines.length * wordLH;
  const glossHeight = glossLines.length * glossLH;
  const gap = glossLines.length > 0 ? wordFont * 0.4 : 0;
  const total = wordHeight + gap + glossHeight;

  const top = -total / 2;
  return {
    wordLines,
    wordFontSize: wordFont,
    wordLineHeight: wordLH,
    glossLines,
    glossFontSize: glossFont,
    glossLineHeight: glossLH,
    firstBaseline: top + wordFont * 0.8,
    glossBaseline: glossLines.length > 0 ? top + wordHeight + gap + glossFont * 0.8 : null,
  };
}

/** Bounding box of all nodes in world units, padded by their radius. */
export function contentBounds(
  nodes: readonly TreeNode[],
  profile: TabProfile,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const { x, y } = cellToWorld(node);
    const shape = shapeOf(node, profile);
    const hw = (shape.kind === "circle" ? shape.radius : shape.halfWidth) + 70;
    const hh = (shape.kind === "circle" ? shape.radius : shape.halfHeight) + 70;
    minX = Math.min(minX, x - hw);
    minY = Math.min(minY, y - hh);
    maxX = Math.max(maxX, x + hw);
    maxY = Math.max(maxY, y + hh);
  }
  return { minX, minY, maxX, maxY };
}

// --- card text -------------------------------------------------------------

const CARD_TITLE_FONT = 13;
const CARD_TITLE_LH = 17;
const CARD_DESC_FONT = 11;
const CARD_DESC_LH = 14;
const CARD_EXAMPLE_FONT = 12.5;
const CARD_EXAMPLE_LH = 19;
export const CARD_BLOCK_GAP = 9;
const CARD_TITLE_LINES = 5;
const CARD_DESC_LINES = 2;
const CARD_EXAMPLE_LINES = 3;

export interface FittedCard {
  titleLines: string[];
  titleFontSize: number;
  titleLineHeight: number;
  descriptionLines: string[];
  descriptionFontSize: number;
  descriptionLineHeight: number;
  /** Typed examples, parsed into real notation. */
  exampleLines: MathBox[];
  exampleFontSize: number;
  exampleLineHeight: number;
  /** True when more examples were typed than the card can show. */
  moreExamples: boolean;
  /** Baseline of the first title line, relative to the card centre. */
  firstBaseline: number;
  /** Baseline of the first description line, or null when there is none. */
  descriptionBaseline: number | null;
  /** Baseline of the first example line, or null when there are none. */
  exampleBaseline: number | null;
  /** Where to draw the rule above the examples, or null when there are none. */
  dividerY: number | null;
}

/** Usable width inside a card, once padding is taken off. */
export const CARD_INNER_W = CARD_W - 2 * CARD_PADDING;

function charsPerLine(fontSize: number): number {
  return Math.max(1, Math.floor((CARD_W - 2 * CARD_PADDING) / (fontSize * CHAR_RATIO)));
}

/**
 * Lays out a card: the rule, a glimpse of the explanation, then the worked
 * examples in real notation. The whole stack is centred, so a sparse card does
 * not look top-heavy.
 */
export function fitCardText(title: string, description: string, examples = ""): FittedCard {
  const titleWords = title.trim().split(/\s+/).filter(Boolean);
  const titleBudget = charsPerLine(CARD_TITLE_FONT);
  const titleWrap = wrapToBudgets(titleWords, Array(CARD_TITLE_LINES).fill(titleBudget));
  const titleLines = titleWrap.lines;
  if (titleWrap.leftover && titleLines.length > 0) {
    const last = titleLines[titleLines.length - 1] ?? "";
    titleLines[titleLines.length - 1] = `${last.slice(0, Math.max(1, titleBudget - 1))}\u2026`;
  }

  // The description is a glimpse, not the whole thing: the sidebar holds that.
  const descWords = description.trim().split(/\s+/).filter(Boolean);
  const descBudget = charsPerLine(CARD_DESC_FONT);
  const descWrap = wrapToBudgets(descWords, Array(CARD_DESC_LINES).fill(descBudget));
  const descriptionLines = descWrap.lines;
  if (descWrap.leftover && descriptionLines.length > 0) {
    const last = descriptionLines[descriptionLines.length - 1] ?? "";
    descriptionLines[descriptionLines.length - 1] =
      `${last.slice(0, Math.max(1, descBudget - 1))}\u2026`;
  }

  // Each typed line becomes one line of notation, cut to the card's width.
  const typed = examples
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const shown = typed.slice(0, CARD_EXAMPLE_LINES);
  const exampleLines = shown.map((line) =>
    fitMathLine(line, CARD_EXAMPLE_FONT, CARD_INNER_W),
  );

  const titleHeight = titleLines.length * CARD_TITLE_LH;
  const descHeight = descriptionLines.length * CARD_DESC_LH;
  const exampleHeight = exampleLines.length * CARD_EXAMPLE_LH;

  let total = titleHeight;
  if (descriptionLines.length > 0) total += CARD_BLOCK_GAP + descHeight;
  if (exampleLines.length > 0) total += CARD_BLOCK_GAP + exampleHeight;

  const top = -total / 2;
  const firstBaseline = top + CARD_TITLE_FONT * 0.82;

  let cursor = top + titleHeight;
  let descriptionBaseline: number | null = null;
  if (descriptionLines.length > 0) {
    cursor += CARD_BLOCK_GAP;
    descriptionBaseline = cursor + CARD_DESC_FONT * 0.82;
    cursor += descHeight;
  }

  let dividerY: number | null = null;
  let exampleBaseline: number | null = null;
  if (exampleLines.length > 0) {
    dividerY = cursor + CARD_BLOCK_GAP * 0.5;
    cursor += CARD_BLOCK_GAP;
    exampleBaseline = cursor + CARD_EXAMPLE_FONT * 0.82;
  }

  return {
    titleLines,
    titleFontSize: CARD_TITLE_FONT,
    titleLineHeight: CARD_TITLE_LH,
    descriptionLines,
    descriptionFontSize: CARD_DESC_FONT,
    descriptionLineHeight: CARD_DESC_LH,
    exampleLines,
    exampleFontSize: CARD_EXAMPLE_FONT,
    exampleLineHeight: CARD_EXAMPLE_LH,
    moreExamples: typed.length > shown.length,
    firstBaseline,
    descriptionBaseline,
    exampleBaseline,
    dividerY,
  };
}

/** Total height of a laid-out card's content, for checking it fits. */
export function cardContentHeight(fitted: FittedCard): number {
  let total = fitted.titleLines.length * fitted.titleLineHeight;
  if (fitted.descriptionLines.length > 0) {
    total += CARD_BLOCK_GAP + fitted.descriptionLines.length * fitted.descriptionLineHeight;
  }
  if (fitted.exampleLines.length > 0) {
    total += CARD_BLOCK_GAP + fitted.exampleLines.length * fitted.exampleLineHeight;
  }
  return total;
}

/** Width of one laid-out example line. */
export function exampleWidth(fitted: FittedCard, index: number): number {
  const box = fitted.exampleLines[index];
  return box ? measureMath(box, fitted.exampleFontSize).width : 0;
}
