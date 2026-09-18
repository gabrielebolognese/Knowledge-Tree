import { describe, expect, it } from "vitest";

import { COL_W, MAIN_SCALE, R_SIDE, ROW_H, TITLE_MAX } from "./config.js";
import {
  cellToWorld,
  contentBounds,
  edgeGeometry,
  fitTitle,
  findFreeCell,
  radiusOf,
  targetCell,
  titleFontSize,
  worldToCell,
} from "./layout.js";
import type { FittedTitle, TreeNode } from "./types.js";

const R_MAIN = R_SIDE * MAIN_SCALE;

function node(partial: Partial<TreeNode> = {}): TreeNode {
  return {
    id: "n",
    title: "",
    date: "",
    description: "",
    images: [],
    col: 0,
    row: 0,
    main: false,
    ...partial,
  };
}

/**
 * Independent check that every line's glyph box stays inside the circle:
 * the far corner of each line must be within the radius.
 */
function worstCorner(fitted: FittedTitle): number {
  let worst = 0;
  fitted.lines.forEach((line, i) => {
    const baseline = fitted.firstBaseline + i * fitted.lineHeight;
    const halfWidth = (line.length * fitted.fontSize * 0.55) / 2;
    const top = baseline - fitted.fontSize * 0.74;
    const bottom = baseline + fitted.fontSize * 0.26;
    const far = Math.max(Math.abs(top), Math.abs(bottom));
    worst = Math.max(worst, Math.hypot(halfWidth, far));
  });
  return worst;
}

describe("grid coordinates", () => {
  it("maps cells to world positions and back", () => {
    expect(cellToWorld({ col: 2, row: 3 })).toEqual({ x: 2 * COL_W, y: 3 * ROW_H });
    expect(worldToCell({ x: 2 * COL_W + 10, y: 3 * ROW_H - 10 })).toEqual({ col: 2, row: 3 });
  });
});

describe("radiusOf", () => {
  it("draws main-rail nodes 20% bigger", () => {
    expect(radiusOf({ main: false })).toBe(R_SIDE);
    expect(radiusOf({ main: true })).toBeCloseTo(R_MAIN);
    expect(radiusOf({ main: true }) / radiusOf({ main: false })).toBeCloseTo(1.2);
  });
});

describe("targetCell", () => {
  it("always advances one row and shifts sideways only on a diagonal", () => {
    const parent = { col: 1, row: 4 };
    expect(targetCell(parent, "down")).toEqual({ col: 1, row: 5 });
    expect(targetCell(parent, "down-left")).toEqual({ col: 0, row: 5 });
    expect(targetCell(parent, "down-right")).toEqual({ col: 2, row: 5 });
  });
});

describe("findFreeCell", () => {
  it("keeps a free cell as-is", () => {
    expect(findFreeCell([{ col: 0, row: 0 }], { col: 0, row: 1 }, 1)).toEqual({ col: 0, row: 1 });
  });

  it("drifts sideways past occupied cells without changing row", () => {
    const taken = [
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ];
    expect(findFreeCell(taken, { col: 0, row: 1 }, 1)).toEqual({ col: 2, row: 1 });
    expect(findFreeCell(taken, { col: 1, row: 1 }, -1)).toEqual({ col: -1, row: 1 });
  });
});

describe("edgeGeometry", () => {
  it("trims the arrow so it starts and ends outside both circles", () => {
    const geom = edgeGeometry({ x: 0, y: 0 }, { x: 0, y: ROW_H }, R_MAIN, R_MAIN);
    expect(geom).not.toBeNull();
    expect(geom?.y1).toBeGreaterThan(R_MAIN);
    expect(geom?.y2).toBeLessThan(ROW_H - R_MAIN);
    expect(geom?.x1).toBe(0);
  });

  it("leaves room for a main-to-main arrow at the grid spacing", () => {
    expect(edgeGeometry({ x: 0, y: 0 }, { x: 0, y: ROW_H }, R_MAIN, R_MAIN)).not.toBeNull();
    expect(edgeGeometry({ x: 0, y: 0 }, { x: COL_W, y: ROW_H }, R_MAIN, R_SIDE)).not.toBeNull();
  });

  it("returns null when the circles are too close to fit an arrow", () => {
    expect(edgeGeometry({ x: 0, y: 0 }, { x: 0, y: 30 }, R_SIDE, R_SIDE)).toBeNull();
  });
});

describe("fitTitle", () => {
  const longest = "Coup of 18 Brumaire ends the Directory in Paris!!"; // 48 chars

  it("returns nothing for an empty title", () => {
    expect(fitTitle("   ", R_SIDE).lines).toEqual([]);
  });

  it("keeps a short title on one centred line", () => {
    const fitted = fitTitle("Napoleon", R_SIDE);
    expect(fitted.lines).toEqual(["Napoleon"]);
    expect(fitted.firstBaseline).toBeCloseTo(fitted.fontSize * 0.34);
  });

  it("keeps a full-length title inside a side-rail circle", () => {
    expect(longest.length).toBeLessThanOrEqual(TITLE_MAX);
    const fitted = fitTitle(longest, R_SIDE);
    expect(fitted.lines.join(" ")).toBe(longest);
    expect(worstCorner(fitted)).toBeLessThanOrEqual(R_SIDE);
  });

  it("keeps a full-length title inside a main-rail circle", () => {
    const fitted = fitTitle(longest, R_MAIN);
    expect(fitted.lines.join(" ")).toBe(longest);
    expect(worstCorner(fitted)).toBeLessThanOrEqual(R_MAIN);
  });

  it("fits an unbroken 50-character word by splitting it", () => {
    const fitted = fitTitle("x".repeat(TITLE_MAX), R_SIDE);
    expect(fitted.lines.join("")).toBe("x".repeat(TITLE_MAX));
    expect(worstCorner(fitted)).toBeLessThanOrEqual(R_SIDE);
  });

  it("scales the type with the circle, so main-rail titles read larger", () => {
    expect(titleFontSize(R_MAIN)).toBeGreaterThan(titleFontSize(R_SIDE));
  });

  it("marks the cut when text is longer than the circle can hold", () => {
    const fitted = fitTitle("the fall of the western roman empire ".repeat(6), R_SIDE);
    expect(fitted.lines.length).toBeLessThanOrEqual(5);
    expect(fitted.lines[fitted.lines.length - 1]?.endsWith("…")).toBe(true);
    expect(worstCorner(fitted)).toBeLessThanOrEqual(R_SIDE);
  });
});

describe("contentBounds", () => {
  it("is null for an empty tree", () => {
    expect(contentBounds([])).toBeNull();
  });

  it("covers every node with padding", () => {
    const bounds = contentBounds([node({ col: 0, row: 0 }), node({ col: 2, row: 1, main: true })]);
    expect(bounds).not.toBeNull();
    expect(bounds?.minX).toBeLessThan(0);
    expect(bounds?.maxX).toBeGreaterThan(2 * COL_W);
    expect(bounds?.maxY).toBeGreaterThan(ROW_H);
  });
});
