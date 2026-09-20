import { beforeEach, describe, expect, it, vi } from "vitest";

import { branchOf, planPlacement } from "./layout.js";
import { Store } from "./store.js";
import { DEFAULT_TAB, emptyTrees } from "./tabs.js";
import type { Edge, NodeId, TreeNode, Workspace } from "./types.js";

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

function node(id: string, col: number, row: number, main = false, corollary = false): TreeNode {
  return {
    id,
    title: id,
    date: "",
    description: "",
    examples: "",
    translation: "",
    italian: "",
    images: [],
    col,
    row,
    main,
    corollary,
    important: false,
  };
}

function edge(from: string, to: string): Edge {
  return { id: `${from}->${to}`, from, to };
}

/** Where a node sits after a placement plan is applied. */
function at(nodes: readonly TreeNode[], moves: Map<NodeId, { col: number; row: number }>, id: string) {
  const moved = moves.get(id);
  if (moved) return moved;
  const found = nodes.find((n) => n.id === id);
  return found ? { col: found.col, row: found.row } : null;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("planPlacement", () => {
  it("puts a child exactly where it was asked when nothing is in the way", () => {
    const nodes = [node("a", 0, 0, true)];
    const parent = nodes[0] as TreeNode;

    expect(planPlacement(parent, "down", nodes, []).cell).toEqual({ col: 0, row: 1 });
    expect(planPlacement(parent, "down-right", nodes, []).cell).toEqual({ col: 1, row: 1 });
    expect(planPlacement(parent, "down-left", nodes, []).cell).toEqual({ col: -1, row: 1 });
  });

  /**
   * Two main-rail nodes, each with a branch to the right. The upper branch then
   * grows down into the cell the lower branch is sitting in.
   */
  it("pushes the blocking branch aside instead of bending the new node sideways", () => {
    const nodes = [
      node("A", 0, 0, true),
      node("B", 0, 1, true),
      node("A2", 1, 1),
      node("B2", 1, 2),
    ];
    const edges = [edge("A", "B"), edge("A", "A2"), edge("B", "B2")];
    const a2 = nodes[2] as TreeNode;

    const plan = planPlacement(a2, "down", nodes, edges);

    // Down means down: the new node keeps A2's column.
    expect(plan.cell).toEqual({ col: 1, row: 2 });
    // B2 slid further right, so B's arrow simply got longer.
    expect(at(nodes, plan.moves, "B2")).toEqual({ col: 2, row: 2 });
  });

  it("moves a whole nested branch as one piece, keeping its shape", () => {
    const nodes = [
      node("A", 0, 0, true),
      node("B", 0, 1, true),
      node("A2", 1, 1),
      node("B2", 1, 2),
      node("B3", 1, 3),
      node("B4", 2, 4),
    ];
    const edges = [
      edge("A", "B"),
      edge("A", "A2"),
      edge("B", "B2"),
      edge("B2", "B3"),
      edge("B3", "B4"),
    ];
    const a2 = nodes[2] as TreeNode;

    const plan = planPlacement(a2, "down", nodes, edges);

    expect(plan.cell).toEqual({ col: 1, row: 2 });
    // Every descendant shifted by the same one column: the shape is preserved.
    expect(at(nodes, plan.moves, "B2")).toEqual({ col: 2, row: 2 });
    expect(at(nodes, plan.moves, "B3")).toEqual({ col: 2, row: 3 });
    expect(at(nodes, plan.moves, "B4")).toEqual({ col: 3, row: 4 });
  });

  it("shoves far enough to clear a branch it would otherwise land on", () => {
    const nodes = [
      node("A", 0, 0, true),
      node("A2", 1, 1),
      node("B2", 1, 2),
      node("C2", 2, 2), // directly in the way of a one-column shove
    ];
    const edges = [edge("A", "A2"), edge("A", "B2"), edge("A", "C2")];
    const a2 = nodes[1] as TreeNode;

    const plan = planPlacement(a2, "down", nodes, edges);

    expect(plan.cell).toEqual({ col: 1, row: 2 });
    expect(at(nodes, plan.moves, "B2")).toEqual({ col: 3, row: 2 });
    expect(at(nodes, plan.moves, "C2")).toEqual({ col: 2, row: 2 });
  });

  it("slides a left-hand branch further left, never back across the rail", () => {
    const nodes = [
      node("A", 0, 0, true),
      node("B", 0, 1, true),
      node("A2", -1, 1),
      node("B2", -1, 2),
    ];
    const edges = [edge("A", "B"), edge("A", "A2"), edge("B", "B2")];
    const a2 = nodes[2] as TreeNode;

    const plan = planPlacement(a2, "down", nodes, edges);

    expect(plan.cell).toEqual({ col: -1, row: 2 });
    expect(at(nodes, plan.moves, "B2")).toEqual({ col: -2, row: 2 });
  });

  it("never shoves the main rail, stepping the new node aside instead", () => {
    const nodes = [node("A", 0, 0, true), node("B", 0, 1, true), node("S", 1, 0)];
    const edges = [edge("A", "B")];
    const s = nodes[2] as TreeNode;

    // S wants to go down-left into (0, 1), which the rail occupies.
    const plan = planPlacement(s, "down-left", nodes, edges);

    expect(plan.moves.size).toBe(0);
    expect(at(nodes, plan.moves, "B")).toEqual({ col: 0, row: 1 });
    expect(plan.cell).not.toEqual({ col: 0, row: 1 });
    expect(plan.cell.row).toBe(1);
  });
});

describe("branchOf", () => {
  it("collects a node and everything hanging off it", () => {
    const nodes = [node("A", 0, 0, true), node("X", 1, 1), node("Y", 1, 2), node("Z", 2, 3)];
    const edges = [edge("A", "X"), edge("X", "Y"), edge("Y", "Z")];

    expect([...branchOf("X", nodes, edges)].sort()).toEqual(["X", "Y", "Z"]);
  });

  it("stops at the main rail so the spine is never dragged along", () => {
    const nodes = [node("X", 1, 1), node("M", 0, 2, true), node("N", 0, 3, true)];
    const edges = [edge("X", "M"), edge("M", "N")];

    expect([...branchOf("X", nodes, edges)]).toEqual(["X"]);
  });

  it("terminates on a cycle", () => {
    const nodes = [node("X", 1, 1), node("Y", 1, 2)];
    const edges = [edge("X", "Y"), edge("Y", "X")];

    expect([...branchOf("X", nodes, edges)].sort()).toEqual(["X", "Y"]);
  });
});

describe("growing a tree through the store", () => {
  it("keeps a straight-down child in its parent's column", () => {
    const store = new Store(emptyWorkspace());
    const a = store.addMainNode();
    const b = store.addMainNode();
    const a2 = store.addChild(a, "down-right");
    const b2 = store.addChild(b, "down-right");
    expect(a2).not.toBeNull();
    expect(b2).not.toBeNull();

    const a3 = store.addChild(a2 as string, "down");

    const parent = store.node(a2 as string);
    const child = store.node(a3);
    expect(child?.col).toBe(parent?.col);
    expect(child?.row).toBe((parent?.row ?? 0) + 1);

    // The displaced branch moved out of the way rather than overlapping.
    const cells = store.get().nodes.map((n) => `${n.col},${n.row}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(store.node(b2 as string)?.col).toBe(2);
  });

  it("leaves the main rail perfectly straight however much branches grow", () => {
    const store = new Store(emptyWorkspace());
    const a = store.addMainNode();
    const b = store.addMainNode();
    store.addMainNode();

    const branch = store.addChild(a, "down-right");
    expect(branch).not.toBeNull();
    store.addChild(branch as string, "down");
    store.addChild(b, "down-right");

    const rail = store.get().nodes.filter((n) => n.main);
    expect(rail).toHaveLength(3);
    for (const n of rail) expect(n.col).toBe(0);
  });
});
