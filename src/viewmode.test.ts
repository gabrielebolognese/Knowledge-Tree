import { beforeEach, describe, expect, it, vi } from "vitest";

import { Store } from "./store.js";
import { DEFAULT_TAB, emptyTrees } from "./tabs.js";
import type { Workspace } from "./types.js";

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

const VISITOR = { owner: "other-person", name: "Giulia" };

function remoteNode(id: string, title: string, date: string) {
  return {
    id,
    title,
    date,
    description: "",
    examples: "",
    translation: "",
    italian: "",
    images: [],
    col: 0,
    row: 0,
    main: true,
    corollary: false,
    important: false,
  };
}

/**
 * Somebody else's published trees, as they arrive off the wire. Built as a
 * plain object on purpose: routing it through a Store would persist it to the
 * same stubbed localStorage and mask the very thing these tests check.
 */
function theirTrees(): unknown {
  const trees = emptyTrees();
  trees.storia = { nodes: [remoteNode("t1", "Rivoluzione francese", "1789")], edges: [] };
  trees.matematica = { nodes: [remoteNode("t2", "Regola di Leibniz", "")], edges: [] };
  return { version: 3, activeTab: "storia", trees };
}

/** A store holding one node of your own. */
function mine(): Store {
  const store = new Store(emptyWorkspace());
  store.updateNode(store.addMainNode(), { title: "Mio nodo", date: "1796" });
  return store;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("entering and leaving view mode", () => {
  it("starts out editable", () => {
    const store = mine();
    expect(store.isReadOnly()).toBe(false);
    expect(store.viewing()).toBeNull();
  });

  it("shows the other account's trees", () => {
    const store = mine();

    expect(store.viewAccount(VISITOR, theirTrees())).toBe(true);

    expect(store.isReadOnly()).toBe(true);
    expect(store.viewing()).toEqual(VISITOR);
    expect(store.get().nodes[0]?.title).toBe("Rivoluzione francese");
  });

  it("gives you your own back, untouched", () => {
    const store = mine();
    store.viewAccount(VISITOR, theirTrees());

    store.stopViewing();

    expect(store.isReadOnly()).toBe(false);
    expect(store.viewing()).toBeNull();
    expect(store.get().nodes[0]?.title).toBe("Mio nodo");
  });

  it("keeps the tab you were on when you arrive", () => {
    const store = mine();
    store.setActiveTab("scacchi");

    store.viewAccount(VISITOR, theirTrees());

    expect(store.getActiveTab()).toBe("scacchi");
  });

  it("lets you move between their subjects", () => {
    const store = mine();
    store.viewAccount(VISITOR, theirTrees());

    store.setActiveTab("matematica");

    expect(store.get().nodes[0]?.title).toBe("Regola di Leibniz");
    expect(store.countFor("storia")).toBe(1);
  });

  it("refuses a payload that is not a workspace", () => {
    const store = mine();

    expect(store.viewAccount(VISITOR, { nonsense: true })).toBe(false);
    expect(store.isReadOnly()).toBe(false);
    expect(store.get().nodes[0]?.title).toBe("Mio nodo");
  });
});

describe("nothing can be changed while viewing", () => {
  function viewing(): Store {
    const store = mine();
    store.viewAccount(VISITOR, theirTrees());
    return store;
  }

  it("refuses to add nodes", () => {
    const store = viewing();
    const before = store.get().nodes.length;

    store.addMainNode();
    store.addFreeNode({ col: 9, row: 9 });
    const child = store.addChild(store.get().nodes[0]?.id ?? "", "down");

    expect(child).toBeNull();
    expect(store.get().nodes).toHaveLength(before);
  });

  it("refuses to edit a node", () => {
    const store = viewing();
    const id = store.get().nodes[0]?.id ?? "";

    store.updateNode(id, { title: "Vandalised", description: "nope" });

    expect(store.node(id)?.title).toBe("Rivoluzione francese");
  });

  it("refuses to move a node, alone or in a group", () => {
    const store = viewing();
    const id = store.get().nodes[0]?.id ?? "";

    expect(store.moveNode(id, { col: 5, row: 5 })).toBe(false);
    expect(store.moveNodesTo(new Map([[id, { col: 5, row: 5 }]]))).toBe(false);
    expect(store.node(id)).toMatchObject({ col: 0, row: 0 });
  });

  it("refuses to delete anything", () => {
    const store = viewing();
    const id = store.get().nodes[0]?.id ?? "";

    store.removeNode(id);

    expect(store.node(id)).toBeDefined();
  });

  it("refuses to connect nodes", () => {
    const store = viewing();
    const id = store.get().nodes[0]?.id ?? "";
    expect(store.connect(id, id)).toBe(false);
  });

  it("refuses to import over what you are reading", () => {
    const store = viewing();
    const error = store.fromJSON(JSON.stringify({ nodes: [], edges: [] }));

    expect(error).toMatch(/Stop viewing/);
    expect(store.get().nodes).toHaveLength(1);
  });
});

describe("your own data stays yours", () => {
  it("never writes a visited workspace to your storage", () => {
    const store = mine();
    store.viewAccount(VISITOR, theirTrees());
    // Switching subjects is the one thing that still commits while viewing.
    store.setActiveTab("matematica");

    const saved = localStorage.getItem("knowledge-tree:v3") ?? "";
    expect(saved).toContain("Mio nodo");
    expect(saved).not.toContain("Rivoluzione francese");
  });

  it("reopens on your own trees after a reload", () => {
    const first = mine();
    first.viewAccount(VISITOR, theirTrees());

    const reopened = new Store();

    expect(reopened.isReadOnly()).toBe(false);
    expect(reopened.get().nodes[0]?.title).toBe("Mio nodo");
  });

  it("keeps handing the sync layer your own trees, never theirs", () => {
    const store = mine();
    store.viewAccount(VISITOR, theirTrees());

    const pushed = JSON.stringify(store.snapshot());

    expect(pushed).toContain("Mio nodo");
    expect(pushed).not.toContain("Rivoluzione francese");
  });

  it("exports whatever is on screen, so a visitor can take a copy", () => {
    const store = mine();
    store.viewAccount(VISITOR, theirTrees());

    expect(store.toJSON()).toContain("Rivoluzione francese");

    store.stopViewing();
    expect(store.toJSON()).toContain("Mio nodo");
  });

  it("still repaints, so the canvas follows what you are reading", () => {
    const store = mine();
    const seen = vi.fn();
    store.subscribe(seen);

    store.viewAccount(VISITOR, theirTrees());
    store.stopViewing();

    expect(seen).toHaveBeenCalledTimes(2);
  });
});
