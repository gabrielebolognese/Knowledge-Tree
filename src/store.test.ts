import { beforeEach, describe, expect, it, vi } from "vitest";

import { LEGACY_STORAGE_KEY, STORAGE_KEY, TITLE_LIMIT } from "./config.js";
import { Store } from "./store.js";
import { DEFAULT_TAB, TABS, emptyTrees } from "./tabs.js";
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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("the main rail", () => {
  it("starts at the origin and extends downward", () => {
    const store = new Store(emptyWorkspace());

    const first = store.addMainNode();
    const second = store.addMainNode();

    expect(store.node(first)).toMatchObject({ col: 0, row: 0, main: true });
    expect(store.node(second)).toMatchObject({ col: 0, row: 1, main: true });
    expect(store.get().edges).toHaveLength(1);
  });

  it("stays on the main rail going straight down", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();

    expect(store.node(store.addChild(root, "down"))?.main).toBe(true);
  });

  it("starts a side rail on a diagonal", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();

    const left = store.addChild(root, "down-left");
    const right = store.addChild(root, "down-right");

    expect(store.node(left)).toMatchObject({ col: -1, row: 1, main: false });
    expect(store.node(right)).toMatchObject({ col: 1, row: 1, main: false });
  });

  it("never promotes a side-rail child back onto the main rail", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();
    const side = store.addChild(root, "down-right");
    expect(side).not.toBeNull();

    expect(store.node(store.addChild(side as string, "down"))?.main).toBe(false);
  });

  it("links every new child to its parent with one arrow", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();
    const child = store.addChild(root, "down-right");

    expect(store.get().edges).toHaveLength(1);
    expect(store.get().edges[0]).toMatchObject({ from: root, to: child });
  });
});

describe("placement", () => {
  it("never drops a node on top of an existing one", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();

    store.addChild(root, "down");
    store.addChild(root, "down");
    store.addChild(root, "down");

    const cells = store.get().nodes.map((n) => `${n.col},${n.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("refuses to move a node onto an occupied cell", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();
    const child = store.addChild(root, "down");
    expect(child).not.toBeNull();

    expect(store.moveNode(child as string, { col: 0, row: 0 })).toBe(false);
    expect(store.node(child)).toMatchObject({ col: 0, row: 1 });
  });

  it("moves a node to a free cell", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();

    expect(store.moveNode(root, { col: 4, row: -2 })).toBe(true);
    expect(store.node(root)).toMatchObject({ col: 4, row: -2 });
  });
});

describe("connections", () => {
  it("refuses self-links and duplicates", () => {
    const store = new Store(emptyWorkspace());
    const a = store.addMainNode();
    const b = store.addChild(a, "down-right");
    expect(b).not.toBeNull();

    expect(store.connect(a, a)).toBe(false);
    expect(store.connect(a, b as string)).toBe(false);
    expect(store.get().edges).toHaveLength(1);
  });

  it("links two unrelated nodes", () => {
    const store = new Store(emptyWorkspace());
    const a = store.addMainNode();
    const b = store.addFreeNode({ col: 5, row: 5 });

    expect(store.connect(a, b)).toBe(true);
    expect(store.edgesOf(b)).toHaveLength(1);
  });

  it("drops the arrows of a deleted node", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();
    const child = store.addChild(root, "down");
    expect(child).not.toBeNull();

    store.removeNode(child as string);

    expect(store.get().nodes).toHaveLength(1);
    expect(store.get().edges).toHaveLength(0);
  });
});

describe("editing", () => {
  it("caps a title at the largest any shape allows", () => {
    const store = new Store(emptyWorkspace());
    const id = store.addMainNode();

    store.updateNode(id, { title: "x".repeat(500) });

    // The store holds the card limit; the narrower circle limit is enforced
    // by the input, so reshaping a node can never silently eat its title.
    expect(store.node(id)?.title).toHaveLength(TITLE_LIMIT);
    expect(TITLE_LIMIT).toBe(200);
  });

  it("notifies subscribers and persists", () => {
    const store = new Store(emptyWorkspace());
    const seen = vi.fn();
    store.subscribe(seen);

    const id = store.addMainNode();
    store.updateNode(id, { description: "Campagna d'Italia." });

    expect(seen).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(STORAGE_KEY)).toContain("Campagna");
  });

  it("restores a tree saved by a previous session", () => {
    const first = new Store(emptyWorkspace());
    first.updateNode(first.addMainNode(), { title: "Congresso di Vienna" });

    const reopened = new Store();

    expect(reopened.get().nodes).toHaveLength(1);
    expect(reopened.get().nodes[0]?.title).toBe("Congresso di Vienna");
  });
});

describe("dates", () => {
  it("starts every new node without a date", () => {
    const store = new Store(emptyWorkspace());
    expect(store.node(store.addMainNode())?.date).toBe("");
  });

  it("flags main-rail nodes with no date, and leaves side rails alone", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();
    expect(store.addChild(root, "down-right")).not.toBeNull();

    expect(store.missingDates().map((n) => n.id)).toEqual([root]);

    store.updateNode(root, { date: "1796" });
    expect(store.missingDates()).toHaveLength(0);
  });

  it("flags a side-rail node as soon as it is moved onto the main rail", () => {
    const store = new Store(emptyWorkspace());
    const root = store.addMainNode();
    store.updateNode(root, { date: "1796" });
    const side = store.addChild(root, "down-left");
    expect(side).not.toBeNull();

    store.updateNode(side as string, { main: true });

    expect(store.missingDates().map((n) => n.id)).toEqual([side]);
  });

  it("keeps a date as free text, so any era notation works", () => {
    const store = new Store(emptyWorkspace());
    const id = store.addMainNode();
    store.updateNode(id, { date: "c. 1200" });
    expect(store.node(id)?.date).toBe("c. 1200");
  });
});

describe("tabs", () => {
  it("opens on Storia with one node, every other tab empty", () => {
    const store = new Store();

    expect(store.getActiveTab()).toBe("storia");
    expect(store.get().nodes).toHaveLength(1);
    expect(store.get().nodes[0]).toMatchObject({ title: "Napoleon", date: "1796", main: true });

    for (const tab of TABS) {
      if (tab.id !== "storia") expect(store.countFor(tab.id)).toBe(0);
    }
  });

  it("keeps each tab an entirely separate tree", () => {
    const store = new Store(emptyWorkspace());
    store.updateNode(store.addMainNode(), { title: "Promessi Sposi" });

    store.setActiveTab("matematica");
    expect(store.get().nodes).toHaveLength(0);
    store.updateNode(store.addMainNode(), { title: "Derivate" });

    store.setActiveTab("storia");
    expect(store.get().nodes.map((n) => n.title)).toEqual(["Promessi Sposi"]);
    expect(store.countFor("matematica")).toBe(1);
  });

  it("scopes the missing-date count to the open tab", () => {
    const store = new Store(emptyWorkspace());
    store.addMainNode();

    store.setActiveTab("economia");
    expect(store.missingDates()).toHaveLength(0);

    store.setActiveTab("storia");
    expect(store.missingDates()).toHaveLength(1);
  });

  it("remembers the open tab across sessions", () => {
    const first = new Store(emptyWorkspace());
    first.setActiveTab("scienze-politiche");

    expect(new Store().getActiveTab()).toBe("scienze-politiche");
  });

  it("carries a pre-tabs tree into Storia", () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        nodes: [
          {
            id: "a",
            title: "Napoleon",
            date: "1796",
            description: "",
            images: [],
            col: 0,
            row: 0,
            main: true,
          },
        ],
        edges: [],
      }),
    );

    const store = new Store();

    expect(store.getActiveTab()).toBe("storia");
    expect(store.get().nodes[0]?.title).toBe("Napoleon");
    expect(store.countFor("italiano")).toBe(0);
  });
});

describe("import and export", () => {
  it("round-trips every tab through one file", () => {
    const store = new Store(emptyWorkspace());
    store.updateNode(store.addMainNode(), { title: "Congresso di Vienna", date: "1815" });
    store.setActiveTab("scacchi");
    store.updateNode(store.addMainNode(), { title: "Difesa siciliana" });
    const exported = store.toJSON();

    const other = new Store(emptyWorkspace());
    expect(other.fromJSON(exported)).toBeNull();

    expect(other.getActiveTab()).toBe("scacchi");
    expect(other.countFor("storia")).toBe(1);
    expect(other.countFor("scacchi")).toBe(1);
  });

  it("loads a single-tree file into the open tab", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("database");

    const single = JSON.stringify({
      nodes: [
        {
          id: "a",
          title: "Normalizzazione",
          description: "",
          images: [],
          col: 0,
          row: 0,
          main: true,
        },
      ],
      edges: [],
    });

    expect(store.fromJSON(single)).toBeNull();
    expect(store.countFor("database")).toBe(1);
    expect(store.countFor("storia")).toBe(0);
    // A file from before dates existed comes in with an empty one.
    expect(store.get().nodes[0]?.date).toBe("");
    // Database has no dates at all, so nothing is reported as missing.
    expect(store.missingDates()).toHaveLength(0);
  });

  it("drops edges pointing at nodes that are not in the file", () => {
    const store = new Store(emptyWorkspace());
    const broken = JSON.stringify({
      nodes: [
        {
          id: "a",
          title: "A",
          date: "1796",
          description: "",
          images: [],
          col: 0,
          row: 0,
          main: true,
        },
      ],
      edges: [{ id: "e", from: "a", to: "ghost" }],
    });

    expect(store.fromJSON(broken)).toBeNull();
    expect(store.get().edges).toHaveLength(0);
  });

  it("rejects files that are not a tree", () => {
    const store = new Store(emptyWorkspace());

    expect(store.fromJSON("not json at all")).toMatch(/not valid JSON/);
    expect(store.fromJSON('{"hello":"world"}')).toMatch(/not a knowledge tree/);
    expect(store.get().nodes).toHaveLength(0);
  });
});

describe("sync handover", () => {
  it("round-trips a workspace through snapshot and adopt", () => {
    const source = new Store(emptyWorkspace());
    source.updateNode(source.addMainNode(), { title: "Campagna d'Italia", date: "1796" });
    source.setActiveTab("economia");
    source.updateNode(source.addMainNode(), { title: "Domanda e offerta" });

    const target = new Store(emptyWorkspace());
    // Server round trip: the document arrives as plain parsed JSON.
    expect(target.adopt(JSON.parse(JSON.stringify(source.snapshot())))).toBe(true);

    expect(target.countFor("storia")).toBe(1);
    expect(target.countFor("economia")).toBe(1);
  });

  it("keeps the tab you are looking at when a server copy arrives", () => {
    const local = new Store(emptyWorkspace());
    local.setActiveTab("scacchi");

    const remote = new Store(emptyWorkspace());
    remote.setActiveTab("matematica");
    remote.updateNode(remote.addMainNode(), { title: "Integrali" });

    expect(local.adopt(JSON.parse(JSON.stringify(remote.snapshot())))).toBe(true);

    // The data is the remote one, but the open tab is still local UI state.
    expect(local.getActiveTab()).toBe("scacchi");
    expect(local.countFor("matematica")).toBe(1);
  });

  it("notifies subscribers so the canvas repaints on an incoming change", () => {
    const store = new Store(emptyWorkspace());
    const seen = vi.fn();
    store.subscribe(seen);

    store.adopt(emptyWorkspace());

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("refuses a payload that is not a workspace", () => {
    const store = new Store(emptyWorkspace());
    store.updateNode(store.addMainNode(), { title: "Keep me" });

    expect(store.adopt(null)).toBe(false);
    expect(store.adopt({ nodes: [], edges: [] })).toBe(false);
    expect(store.get().nodes[0]?.title).toBe("Keep me");
  });
});
