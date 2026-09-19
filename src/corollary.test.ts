import { beforeEach, describe, expect, it, vi } from "vitest";

import { COROLLARY_ROW_STEP, COROLLARY_SCALE, R_SIDE, ROW_H } from "./config.js";
import { cellToWorld, edgeGeometry, fitTitle, overlaps, radiusOf, targetCell } from "./layout.js";
import { circle } from "./testing.js";
import { Store } from "./store.js";
import { DEFAULT_TAB, emptyTrees } from "./tabs.js";
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

/** A side node hanging off the main rail, which is where corollaries live. */
function sideNode(store: Store): NodeId {
  const root = store.addMainNode();
  const side = store.addChild(root, "down-right");
  if (!side) throw new Error("expected a side node");
  return side;
}

/** Straight-line distance between two nodes, in world units. */
function gap(store: Store, a: NodeId, b: NodeId): number {
  const from = store.node(a);
  const to = store.node(b);
  if (!from || !to) throw new Error("missing node");
  const p = cellToWorld(from);
  const q = cellToWorld(to);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("corollary size", () => {
  it("is 20% smaller than a side node", () => {
    const side = radiusOf({ main: false, corollary: false });
    const corollary = radiusOf({ main: false, corollary: true });

    expect(corollary).toBeCloseTo(side * 0.8);
    expect(corollary / side).toBeCloseTo(COROLLARY_SCALE);
  });

  it("stays smaller than a side node even against the main rail", () => {
    const main = radiusOf({ main: true, corollary: false });
    const corollary = radiusOf({ main: false, corollary: true });
    expect(corollary).toBeLessThan(main);
  });

  it("still fits a full-length title inside the smaller circle", () => {
    const radius = radiusOf({ main: false, corollary: true });
    const fitted = fitTitle("Il Direttorio cade e nasce il Consolato nel 1799", radius);

    expect(fitted.lines.join(" ")).toBe("Il Direttorio cade e nasce il Consolato nel 1799");
    expect(fitted.lines.length).toBeLessThanOrEqual(5);
  });
});

describe("corollary spacing", () => {
  it("sits 20% closer than a normal step", () => {
    const parent = { col: 1, row: 2, corollary: true };
    expect(targetCell(parent, "down").row).toBeCloseTo(2 + COROLLARY_ROW_STEP);

    const normal = { col: 1, row: 2, corollary: false };
    expect(targetCell(normal, "down").row).toBe(3);
  });

  it("gives the arrow 20% less to span", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);

    const normalChild = store.addChild(side, "down");
    expect(normalChild).not.toBeNull();
    const normalGap = gap(store, side, normalChild as string);

    store.updateNode(normalChild as string, { corollary: true });
    const corollaryGap = gap(store, side, normalChild as string);

    expect(corollaryGap).toBeCloseTo(normalGap * 0.8);
    expect(corollaryGap).toBeCloseTo(ROW_H * COROLLARY_ROW_STEP);
  });

  it("draws a shorter arrow into a corollary than into a side node", () => {
    const parent = cellToWorld({ col: 0, row: 0 });
    const sideR = radiusOf({ main: false, corollary: false });
    const corollaryR = radiusOf({ main: false, corollary: true });

    const toSide = edgeGeometry(
      parent,
      cellToWorld({ col: 0, row: 1 }),
      circle(sideR),
      circle(sideR),
    );
    const toCorollary = edgeGeometry(
      parent,
      cellToWorld({ col: 0, row: COROLLARY_ROW_STEP }),
      circle(sideR),
      circle(corollaryR),
    );

    expect(toSide).not.toBeNull();
    expect(toCorollary).not.toBeNull();
    const sideLen = (toSide?.y2 ?? 0) - (toSide?.y1 ?? 0);
    const corollaryLen = (toCorollary?.y2 ?? 0) - (toCorollary?.y1 ?? 0);

    expect(corollaryLen).toBeGreaterThan(0);
    expect(corollaryLen).toBeLessThan(sideLen);
  });

  it("keeps circles clear of each other at the tighter spacing", () => {
    const sideR = radiusOf({ main: false, corollary: false });
    const corollaryR = radiusOf({ main: false, corollary: true });
    const distance = ROW_H * COROLLARY_ROW_STEP;

    expect(distance).toBeGreaterThan(sideR + corollaryR);
    expect(distance).toBeGreaterThan(corollaryR * 2);
  });
});

describe("the corollary toggle", () => {
  it("pulls the node closer to its parent, and pushes it back when unticked", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);
    const child = store.addChild(side, "down");
    expect(child).not.toBeNull();

    const parentRow = store.node(side)?.row ?? 0;
    expect(store.node(child)?.row).toBeCloseTo(parentRow + 1);

    store.updateNode(child as string, { corollary: true });
    expect(store.node(child)?.row).toBeCloseTo(parentRow + COROLLARY_ROW_STEP);

    store.updateNode(child as string, { corollary: false });
    expect(store.node(child)?.row).toBeCloseTo(parentRow + 1);
  });

  it("brings everything underneath along, so the sub-tree keeps its spacing", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);
    const first = store.addChild(side, "down");
    expect(first).not.toBeNull();
    const second = store.addChild(first as string, "down");
    expect(second).not.toBeNull();

    const before = (store.node(second)?.row ?? 0) - (store.node(first as string)?.row ?? 0);
    store.updateNode(first as string, { corollary: true });
    const after = (store.node(second)?.row ?? 0) - (store.node(first as string)?.row ?? 0);

    expect(after).toBeCloseTo(before);
  });

  it("is mutually exclusive with the main rail", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);
    const child = store.addChild(side, "down");
    expect(child).not.toBeNull();

    store.updateNode(child as string, { corollary: true });
    expect(store.node(child)).toMatchObject({ corollary: true, main: false });

    store.updateNode(child as string, { main: true });
    expect(store.node(child)).toMatchObject({ corollary: false, main: true });

    store.updateNode(child as string, { corollary: true });
    expect(store.node(child)).toMatchObject({ corollary: true, main: false });
  });

  it("does not move a loose node, which has no parent to close in on", () => {
    const store = new Store(emptyWorkspace());
    const loose = store.addFreeNode({ col: 3, row: 3 });

    store.updateNode(loose, { corollary: true });

    expect(store.node(loose)).toMatchObject({ corollary: true, col: 3, row: 3 });
  });
});

describe("growing from a corollary", () => {
  it("passes corollary status down the chain", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);
    const first = store.addChild(side, "down");
    expect(first).not.toBeNull();
    store.updateNode(first as string, { corollary: true });

    const second = store.addChild(first as string, "down");

    expect(store.node(second)?.corollary).toBe(true);
    expect(store.node(second)?.row).toBeCloseTo(
      (store.node(first as string)?.row ?? 0) + COROLLARY_ROW_STEP,
    );
  });

  it("does not make a diagonal child a corollary", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);
    const first = store.addChild(side, "down");
    expect(first).not.toBeNull();
    store.updateNode(first as string, { corollary: true });

    const diagonal = store.addChild(first as string, "down-right");

    expect(store.node(diagonal)?.corollary).toBe(false);
    expect(store.node(diagonal)?.row).toBeCloseTo(
      (store.node(first as string)?.row ?? 0) + 1,
    );
  });

  it("never lets a corollary sit on the main rail", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();

    const child = store.addChild(root, "down");

    expect(store.node(child)?.main).toBe(true);
    expect(store.node(child)?.corollary).toBe(false);
  });
});

describe("occupancy at sub-row spacing", () => {
  it("treats anything closer than a corollary step as a clash", () => {
    expect(overlaps({ col: 0, row: 1 }, { col: 0, row: 1.2 })).toBe(true);
    expect(overlaps({ col: 0, row: 1 }, { col: 0, row: 1.8 })).toBe(false);
    expect(overlaps({ col: 0, row: 1 }, { col: 1, row: 1 })).toBe(false);
  });

  it("refuses to drag a node on top of a corollary", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);
    const corollary = store.addChild(side, "down");
    expect(corollary).not.toBeNull();
    store.updateNode(corollary as string, { corollary: true });

    const target = store.node(corollary as string);
    const loose = store.addFreeNode({ col: 8, row: 8 });

    const onTop = { col: target?.col ?? 0, row: (target?.row ?? 0) + 0.2 };
    expect(store.moveNode(loose, onTop)).toBe(false);
  });

  it("keeps a corollary chain free of overlaps", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);

    let current = store.addChild(side, "down") as string;
    store.updateNode(current, { corollary: true });
    for (let i = 0; i < 4; i++) {
      current = store.addChild(current, "down") as string;
    }

    const nodes = store.get().nodes;
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id === b.id) continue;
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});

describe("stored corollaries", () => {
  it("survives a round trip through JSON", () => {
    const store = new Store(emptyWorkspace());
    const side = sideNode(store);
    const child = store.addChild(side, "down");
    expect(child).not.toBeNull();
    store.updateNode(child as string, { corollary: true, title: "Alcuino di York" });

    const other = new Store(emptyWorkspace());
    expect(other.fromJSON(store.toJSON())).toBeNull();

    const restored = other.get().nodes.find((n) => n.title === "Alcuino di York");
    expect(restored?.corollary).toBe(true);
    expect(restored?.row).toBeCloseTo((store.node(side)?.row ?? 0) + COROLLARY_ROW_STEP);
  });

  it("reads a tree from before corollaries existed", () => {
    const store = new Store(emptyWorkspace());
    const legacy = JSON.stringify({
      nodes: [
        { id: "a", title: "Napoleon", date: "1796", description: "", images: [], col: 0, row: 0, main: true },
      ],
      edges: [],
    });

    expect(store.fromJSON(legacy)).toBeNull();
    expect(store.get().nodes[0]?.corollary).toBe(false);
  });

  it("never restores a node as both main and corollary", () => {
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
          corollary: true,
        },
      ],
      edges: [],
    });

    expect(store.fromJSON(contradictory)).toBeNull();
    expect(store.get().nodes[0]).toMatchObject({ main: true, corollary: false });
  });
});

describe("corollary radius against the constant", () => {
  it("matches R_SIDE scaled down", () => {
    expect(radiusOf({ main: false, corollary: true })).toBeCloseTo(R_SIDE * COROLLARY_SCALE);
  });
});
