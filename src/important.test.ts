import { beforeEach, describe, expect, it, vi } from "vitest";

import { COL_W, IMPORTANT_H, IMPORTANT_W, R_SIDE, ROW_H } from "./config.js";
import { cellToWorld, edgeGeometry, fitBoxTitle, isImportant, shapeOf } from "./layout.js";
import { Store } from "./store.js";
import { DEFAULT_TAB, emptyTrees } from "./tabs.js";
import { HISTORY_PROFILE, PLAIN_PROFILE, RULES_PROFILE } from "./testing.js";
import type { NodeId, Workspace } from "./types.js";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function emptyWorkspace(): Workspace {
  return { version: 3, activeTab: DEFAULT_TAB, trees: emptyTrees() };
}

/** A maths tree with one rule on the rail and one exercise beside it. */
function mathsTree(store: Store): { rule: NodeId; side: NodeId } {
  store.setActiveTab("matematica");
  const rule = store.addMainNode();
  const side = store.addChild(rule, "down-right");
  if (!side) throw new Error("expected a side node");
  return { rule, side };
}

const side = { main: false, corollary: false, important: true };
const sideCorollary = { main: false, corollary: true, important: true };
const rail = { main: true, corollary: false, important: true };

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("who can be important", () => {
  it("applies to side nodes in maths", () => {
    expect(isImportant(side, RULES_PROFILE)).toBe(true);
  });

  it("never applies to the main rail, which has its own emphasis", () => {
    expect(isImportant(rail, RULES_PROFILE)).toBe(false);
    expect(shapeOf(rail, RULES_PROFILE)).toMatchObject({ halfWidth: 190 });
  });

  it("is offered only by subjects whose profile allows it", () => {
    expect(isImportant(side, PLAIN_PROFILE)).toBe(false);
    expect(isImportant(side, HISTORY_PROFILE)).toBe(false);
    expect(shapeOf(side, PLAIN_PROFILE).kind).toBe("circle");
  });

  it("leaves an unflagged side node as a circle", () => {
    expect(shapeOf({ main: false, corollary: false, important: false }, RULES_PROFILE)).toEqual({
      kind: "circle",
      radius: R_SIDE,
    });
  });
});

describe("the shape it takes", () => {
  it("is a rounded box about the size of a circle", () => {
    const shape = shapeOf(side, RULES_PROFILE);
    expect(shape).toEqual({
      kind: "rect",
      halfWidth: IMPORTANT_W / 2,
      halfHeight: IMPORTANT_H / 2,
    });

    // Its height is close to the circle it replaces, not a card's.
    if (shape.kind !== "rect") throw new Error("expected a rect");
    expect(shape.halfHeight).toBeGreaterThan(R_SIDE * 0.8);
    expect(shape.halfHeight).toBeLessThan(R_SIDE * 1.2);
  });

  it("is far smaller than a main-rail card", () => {
    const box = shapeOf(side, RULES_PROFILE);
    const card = shapeOf(rail, RULES_PROFILE);
    if (box.kind !== "rect" || card.kind !== "rect") throw new Error("expected rects");

    expect(box.halfWidth).toBeLessThan(card.halfWidth);
    expect(box.halfHeight).toBeLessThan(card.halfHeight);
  });

  it("shrinks with a corollary, like the circles do", () => {
    const full = shapeOf(side, RULES_PROFILE);
    const small = shapeOf(sideCorollary, RULES_PROFILE);
    if (full.kind !== "rect" || small.kind !== "rect") throw new Error("expected rects");

    expect(small.halfWidth).toBeCloseTo(full.halfWidth * 0.8);
    expect(small.halfHeight).toBeCloseTo(full.halfHeight * 0.8);
  });

  it("stays clear of its neighbours on the grid", () => {
    const shape = shapeOf(side, RULES_PROFILE);
    if (shape.kind !== "rect") throw new Error("expected a rect");

    // Two boxes side by side in adjacent columns.
    expect(COL_W).toBeGreaterThan(shape.halfWidth * 2);
    // A box under a card, at the row spacing.
    expect(ROW_H).toBeGreaterThan(shape.halfHeight + 120);
  });

  it("takes an arrow to its edge like any other shape", () => {
    const card = shapeOf(rail, RULES_PROFILE);
    const box = shapeOf(side, RULES_PROFILE);

    const geom = edgeGeometry(
      cellToWorld({ col: 0, row: 0 }),
      cellToWorld({ col: 1, row: 1 }),
      card,
      box,
    );
    expect(geom).not.toBeNull();
  });
});

describe("the title inside the box", () => {
  it("fits a full-length title", () => {
    const fitted = fitBoxTitle(
      "Equazioni di secondo grado con delta negativo!!",
      IMPORTANT_W / 2,
      IMPORTANT_H / 2,
    );

    expect(fitted.lines.join(" ")).toBe("Equazioni di secondo grado con delta negativo!!");
    expect(fitted.lines.length).toBeLessThanOrEqual(4);
  });

  it("centres the block, so one line sits on the middle", () => {
    const fitted = fitBoxTitle("Delta", IMPORTANT_W / 2, IMPORTANT_H / 2);
    expect(fitted.lines).toEqual(["Delta"]);
    expect(fitted.firstBaseline).toBeCloseTo(fitted.fontSize * 0.34);
  });

  it("keeps every line inside the box", () => {
    const fitted = fitBoxTitle(
      "Equazioni di secondo grado con delta negativo!!",
      IMPORTANT_W / 2,
      IMPORTANT_H / 2,
    );

    const top = fitted.firstBaseline - fitted.fontSize;
    const bottom = fitted.firstBaseline + (fitted.lines.length - 1) * fitted.lineHeight;
    expect(top).toBeGreaterThan(-IMPORTANT_H / 2);
    expect(bottom).toBeLessThan(IMPORTANT_H / 2);

    for (const line of fitted.lines) {
      const width = line.length * fitted.fontSize * 0.55;
      expect(width).toBeLessThan(IMPORTANT_W);
    }
  });

  it("marks a title too long for the box", () => {
    const fitted = fitBoxTitle("parola ".repeat(40), IMPORTANT_W / 2, IMPORTANT_H / 2);
    expect(fitted.lines[fitted.lines.length - 1]?.endsWith("…")).toBe(true);
  });

  it("uses smaller type in a corollary-sized box", () => {
    const full = fitBoxTitle("Delta", IMPORTANT_W / 2, IMPORTANT_H / 2);
    const small = fitBoxTitle("Delta", (IMPORTANT_W / 2) * 0.8, (IMPORTANT_H / 2) * 0.8);
    expect(small.fontSize).toBeLessThan(full.fontSize);
  });
});

describe("the toggle", () => {
  it("starts off on a new node", () => {
    const store = new Store(emptyWorkspace());
    const { side: exercise } = mathsTree(store);
    expect(store.node(exercise)?.important).toBe(false);
  });

  it("turns a side node important and back", () => {
    const store = new Store(emptyWorkspace());
    const { side: exercise } = mathsTree(store);

    store.updateNode(exercise, { important: true });
    expect(store.node(exercise)?.important).toBe(true);

    store.updateNode(exercise, { important: false });
    expect(store.node(exercise)?.important).toBe(false);
  });

  it("does not move the node, only reshapes it", () => {
    const store = new Store(emptyWorkspace());
    const { side: exercise } = mathsTree(store);
    const before = store.node(exercise);
    const cell = { col: before?.col ?? 0, row: before?.row ?? 0 };

    store.updateNode(exercise, { important: true });

    expect(store.node(exercise)).toMatchObject(cell);
  });

  it("clears itself when the node joins the main rail", () => {
    const store = new Store(emptyWorkspace());
    const { side: exercise } = mathsTree(store);
    store.updateNode(exercise, { important: true });

    store.updateNode(exercise, { main: true });

    expect(store.node(exercise)).toMatchObject({ main: true, important: false });
  });

  it("drops the node off the rail when ticked", () => {
    const store = new Store(emptyWorkspace());
    const { rule } = mathsTree(store);

    store.updateNode(rule, { important: true });

    expect(store.node(rule)).toMatchObject({ main: false, important: true });
  });

  it("sits happily alongside corollary", () => {
    const store = new Store(emptyWorkspace());
    const { side: exercise } = mathsTree(store);

    store.updateNode(exercise, { corollary: true, important: true });

    expect(store.node(exercise)).toMatchObject({ corollary: true, important: true, main: false });
  });
});

describe("stored importance", () => {
  it("round-trips through JSON", () => {
    const store = new Store(emptyWorkspace());
    const { side: exercise } = mathsTree(store);
    store.updateNode(exercise, { important: true, title: "Caso limite" });

    const other = new Store(emptyWorkspace());
    expect(other.fromJSON(store.toJSON())).toBeNull();
    other.setActiveTab("matematica");

    const restored = other.get().nodes.find((n) => n.title === "Caso limite");
    expect(restored?.important).toBe(true);
  });

  it("defaults to false for a tree saved before the flag existed", () => {
    const store = new Store(emptyWorkspace());
    const legacy = JSON.stringify({
      nodes: [
        { id: "a", title: "Regola", date: "", description: "", images: [], col: 0, row: 0, main: false },
      ],
      edges: [],
    });

    expect(store.fromJSON(legacy)).toBeNull();
    expect(store.get().nodes[0]?.important).toBe(false);
  });

  it("never restores a main-rail node as important", () => {
    const store = new Store(emptyWorkspace());
    const contradictory = JSON.stringify({
      nodes: [
        {
          id: "a",
          title: "A",
          date: "",
          description: "",
          images: [],
          col: 0,
          row: 0,
          main: true,
          important: true,
        },
      ],
      edges: [],
    });

    expect(store.fromJSON(contradictory)).toBeNull();
    expect(store.get().nodes[0]).toMatchObject({ main: true, important: false });
  });
});
