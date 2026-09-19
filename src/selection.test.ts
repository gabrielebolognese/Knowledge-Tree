import { beforeEach, describe, expect, it, vi } from "vitest";

import { COL_W, R_SIDE, ROW_H } from "./config.js";
import { boundsIntersect, nodeBounds, nodesWithin } from "./layout.js";
import { Store } from "./store.js";
import { DEFAULT_TAB, emptyTrees } from "./tabs.js";
import { PLAIN_PROFILE, RULES_PROFILE } from "./testing.js";
import type { Cell, NodeId, TreeNode, Workspace } from "./types.js";

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

function node(id: string, col: number, row: number, main = false): TreeNode {
  return {
    id,
    title: id,
    date: "",
    description: "",
    examples: "",
    images: [],
    col,
    row,
    main,
    corollary: false,
    important: false,
  };
}

/** A box drawn around whole grid cells, the way a drag across them would be. */
function boxOverCells(from: Cell, to: Cell) {
  return {
    minX: Math.min(from.col, to.col) * COL_W - 1,
    minY: Math.min(from.row, to.row) * ROW_H - 1,
    maxX: Math.max(from.col, to.col) * COL_W + 1,
    maxY: Math.max(from.row, to.row) * ROW_H + 1,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("what a selection box catches", () => {
  const nodes = [
    node("A", 0, 0, true),
    node("B", 0, 1, true),
    node("C", 1, 1),
    node("D", 3, 3),
  ];

  it("catches every node the box touches", () => {
    const caught = nodesWithin(nodes, PLAIN_PROFILE, boxOverCells({ col: 0, row: 0 }, { col: 1, row: 1 }));
    expect(caught.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("leaves out anything the box misses", () => {
    const caught = nodesWithin(nodes, PLAIN_PROFILE, boxOverCells({ col: 0, row: 0 }, { col: 0, row: 0 }));
    expect(caught.map((n) => n.id)).toEqual(["A"]);
  });

  it("catches a node the box merely clips, not just ones it swallows", () => {
    const centre = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const justTouching = {
      minX: R_SIDE - 1,
      minY: -1,
      maxX: R_SIDE + 40,
      maxY: 1,
    };

    expect(nodesWithin([node("A", 0, 0)], PLAIN_PROFILE, centre)).toHaveLength(1);
    expect(nodesWithin([node("A", 0, 0)], PLAIN_PROFILE, justTouching)).toHaveLength(1);
  });

  it("finds nothing in empty space", () => {
    const far = { minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 };
    expect(nodesWithin(nodes, PLAIN_PROFILE, far)).toEqual([]);
  });

  it("measures a card's real footprint, not a circle's", () => {
    const card = nodeBounds(node("R", 0, 0, true), RULES_PROFILE);
    const circle = nodeBounds(node("S", 0, 0), RULES_PROFILE);

    expect(card.maxX - card.minX).toBeGreaterThan(circle.maxX - circle.minX);
    expect(card.maxY - card.minY).toBeGreaterThan(circle.maxY - circle.minY);
  });
});

describe("boundsIntersect", () => {
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it("is true when they overlap", () => {
    expect(boundsIntersect(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
  });

  it("is true when they only share an edge", () => {
    expect(boundsIntersect(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true);
  });

  it("is false when they are apart", () => {
    expect(boundsIntersect(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
    expect(boundsIntersect(a, { minX: 0, minY: 11, maxX: 10, maxY: 20 })).toBe(false);
  });
});

describe("moving a group", () => {
  /** Three nodes in a row, none of them touching. */
  function spread(store: Store): NodeId[] {
    const a = store.addFreeNode({ col: 0, row: 0 });
    const b = store.addFreeNode({ col: 1, row: 0 });
    const c = store.addFreeNode({ col: 2, row: 0 });
    return [a, b, c];
  }

  it("shifts every node by the same amount", () => {
    const store = new Store(emptyWorkspace());
    const [a, b, c] = spread(store);

    const moved = store.moveNodesTo(
      new Map([
        [a as string, { col: 0, row: 2 }],
        [b as string, { col: 1, row: 2 }],
        [c as string, { col: 2, row: 2 }],
      ]),
    );

    expect(moved).toBe(true);
    expect(store.node(a as string)).toMatchObject({ col: 0, row: 2 });
    expect(store.node(b as string)).toMatchObject({ col: 1, row: 2 });
    expect(store.node(c as string)).toMatchObject({ col: 2, row: 2 });
  });

  it("keeps the shape of the group intact", () => {
    const store = new Store(emptyWorkspace());
    const [a, b] = spread(store);
    const before =
      (store.node(b as string)?.col ?? 0) - (store.node(a as string)?.col ?? 0);

    store.moveNodesTo(
      new Map([
        [a as string, { col: 4, row: 1 }],
        [b as string, { col: 5, row: 1 }],
      ]),
    );

    const after = (store.node(b as string)?.col ?? 0) - (store.node(a as string)?.col ?? 0);
    expect(after).toBe(before);
  });

  it("moves nothing at all if any one of them would clash", () => {
    const store = new Store(emptyWorkspace());
    const [a, b] = spread(store);
    const blocker = store.addFreeNode({ col: 7, row: 7 });
    expect(blocker).toBeTruthy();

    const moved = store.moveNodesTo(
      new Map([
        [a as string, { col: 6, row: 7 }],
        [b as string, { col: 7, row: 7 }], // straight onto the blocker
      ]),
    );

    expect(moved).toBe(false);
    expect(store.node(a as string)).toMatchObject({ col: 0, row: 0 });
    expect(store.node(b as string)).toMatchObject({ col: 1, row: 0 });
  });

  it("lets a group slide through where it came from", () => {
    const store = new Store(emptyWorkspace());
    const [a, b] = spread(store);

    // B takes A's old cell as the pair shifts left; that must be allowed.
    const moved = store.moveNodesTo(
      new Map([
        [a as string, { col: -1, row: 0 }],
        [b as string, { col: 0, row: 0 }],
      ]),
    );

    expect(moved).toBe(true);
    expect(store.node(b as string)).toMatchObject({ col: 0, row: 0 });
  });

  it("reports nothing changed when the group stays put", () => {
    const store = new Store(emptyWorkspace());
    const [a] = spread(store);

    expect(store.moveNodesTo(new Map([[a as string, { col: 0, row: 0 }]]))).toBe(false);
  });

  it("does nothing with an empty group", () => {
    const store = new Store(emptyWorkspace());
    expect(store.moveNodesTo(new Map())).toBe(false);
  });

  it("notifies subscribers once for the whole group", () => {
    const store = new Store(emptyWorkspace());
    const [a, b] = spread(store);
    const seen = vi.fn();
    store.subscribe(seen);

    store.moveNodesTo(
      new Map([
        [a as string, { col: 0, row: 3 }],
        [b as string, { col: 1, row: 3 }],
      ]),
    );

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("respects the minimum gap, so a group cannot be stacked too tightly", () => {
    const store = new Store(emptyWorkspace());
    const a = store.addFreeNode({ col: 0, row: 0 });
    const blocker = store.addFreeNode({ col: 5, row: 5 });
    expect(blocker).toBeTruthy();

    // 0.2 rows from the blocker is closer than a corollary step.
    expect(store.moveNodesTo(new Map([[a, { col: 5, row: 5.2 }]]))).toBe(false);
    // A full row away is fine.
    expect(store.moveNodesTo(new Map([[a, { col: 5, row: 6 }]]))).toBe(true);
  });
});
