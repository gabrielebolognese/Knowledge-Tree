import { LEGACY_STORAGE_KEY, STORAGE_KEY, TITLE_MAX } from "./config.js";
import { findFreeCell, targetCell } from "./layout.js";
import { seedWorkspace } from "./seed.js";
import { DEFAULT_TAB, TABS, emptyTrees, isTabId } from "./tabs.js";
import type { Cell, Direction, Edge, NodeId, TabId, Tree, TreeNode, Workspace } from "./types.js";

type Listener = () => void;

function newId(): string {
  return crypto.randomUUID();
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Coerces anything parsed from storage or an import into one usable tree. */
function normalizeTree(value: unknown): Tree | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;

  const nodes: TreeNode[] = [];
  for (const item of raw.nodes) {
    if (typeof item !== "object" || item === null) continue;
    const n = item as Record<string, unknown>;
    const id = str(n["id"]);
    if (!id) continue;
    nodes.push({
      id,
      title: str(n["title"]).slice(0, TITLE_MAX),
      date: str(n["date"]),
      description: str(n["description"]),
      images: Array.isArray(n["images"])
        ? n["images"].filter((i): i is string => typeof i === "string")
        : [],
      col: num(n["col"]),
      row: num(n["row"]),
      main: n["main"] === true,
    });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = [];
  for (const item of raw.edges) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const from = str(e["from"]);
    const to = str(e["to"]);
    if (!ids.has(from) || !ids.has(to)) continue;
    edges.push({ id: str(e["id"]) || newId(), from, to });
  }

  return { nodes, edges };
}

/** Coerces a parsed value into a full eight-tab workspace. */
function normalizeWorkspace(value: unknown): Workspace | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { trees?: unknown; activeTab?: unknown };
  if (typeof raw.trees !== "object" || raw.trees === null) return null;

  const source = raw.trees as Record<string, unknown>;
  const trees = emptyTrees();
  for (const tab of TABS) {
    const tree = normalizeTree(source[tab.id]);
    if (tree) trees[tab.id] = tree;
  }

  return {
    version: 3,
    activeTab: isTabId(raw.activeTab) ? raw.activeTab : DEFAULT_TAB,
    trees,
  };
}

/**
 * Single source of truth. Holds every tab's tree; all the node and edge methods
 * act on whichever tab is open. Mutations notify listeners and persist.
 */
export class Store {
  private workspace: Workspace;
  private readonly listeners = new Set<Listener>();
  /** Set when the last write to localStorage failed (quota, private mode...). */
  private saveError: string | null = null;

  constructor(initial?: Workspace) {
    this.workspace = initial ?? Store.load() ?? seedWorkspace();
  }

  private static load(): Workspace | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = normalizeWorkspace(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch {
      // Unreadable storage falls through to the legacy key, then to the seed.
    }

    // One-time carry-over from the single-tree layout that predates tabs.
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const tree = normalizeTree(JSON.parse(legacy));
        if (tree && tree.nodes.length > 0) {
          const trees = emptyTrees();
          trees[DEFAULT_TAB] = tree;
          return { version: 3, activeTab: DEFAULT_TAB, trees };
        }
      }
    } catch {
      // Ignore and start fresh.
    }

    return null;
  }

  /** The open tab's tree. Every mutation below works on this. */
  private get tree(): Tree {
    return this.workspace.trees[this.workspace.activeTab];
  }

  get(): Readonly<Tree> {
    return this.tree;
  }

  getActiveTab(): TabId {
    return this.workspace.activeTab;
  }

  setActiveTab(id: TabId): void {
    if (id === this.workspace.activeTab) return;
    this.workspace.activeTab = id;
    this.commit();
  }

  /** How many nodes a tab holds, open or not. */
  countFor(id: TabId): number {
    return this.workspace.trees[id].nodes.length;
  }

  getSaveError(): string | null {
    return this.saveError;
  }

  node(id: NodeId | null): TreeNode | undefined {
    if (!id) return undefined;
    return this.tree.nodes.find((n) => n.id === id);
  }

  /** Main-rail nodes in the open tab still missing their mandatory date. */
  missingDates(): TreeNode[] {
    return this.tree.nodes.filter((n) => n.main && n.date.trim() === "");
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.workspace));
      this.saveError = null;
    } catch {
      this.saveError =
        "Could not save — browser storage is full. Remove a few images to free space.";
    }
    for (const fn of this.listeners) fn();
  }

  private cells(exclude?: NodeId): Cell[] {
    return this.tree.nodes.filter((n) => n.id !== exclude).map((n) => ({ col: n.col, row: n.row }));
  }

  private blank(cell: Cell, main: boolean): TreeNode {
    return {
      id: newId(),
      title: "",
      date: "",
      description: "",
      images: [],
      col: cell.col,
      row: cell.row,
      main,
    };
  }

  /** The lowest main-rail node, which is where the rail continues from. */
  private lastMainNode(): TreeNode | undefined {
    return this.tree.nodes.filter((n) => n.main).sort((a, b) => b.row - a.row)[0];
  }

  /** Starts a new main rail, or continues the existing one from its last node. */
  addMainNode(): NodeId {
    const last = this.lastMainNode();
    if (last) {
      const extended = this.addChild(last.id, "down");
      if (extended) return extended;
    }

    const node = this.blank(findFreeCell(this.cells(), { col: 0, row: 0 }, 1), true);
    this.tree.nodes.push(node);
    this.commit();
    return node.id;
  }

  /**
   * Adds a node below `parentId` and links them with an arrow.
   * Straight down from a main-rail node stays on the main rail; a diagonal
   * always starts (or continues) a side rail.
   */
  addChild(parentId: NodeId, dir: Direction): NodeId | null {
    const parent = this.node(parentId);
    if (!parent) return null;

    const drift = dir === "down-left" ? -1 : 1;
    const cell = findFreeCell(this.cells(), targetCell(parent, dir), drift);

    const child = this.blank(cell, parent.main && dir === "down");
    this.tree.nodes.push(child);
    this.tree.edges.push({ id: newId(), from: parent.id, to: child.id });
    this.commit();
    return child.id;
  }

  /** Drops an unconnected node on the grid, e.g. to start a second rail. */
  addFreeNode(cell: Cell): NodeId {
    const node = this.blank(findFreeCell(this.cells(), cell, 1), false);
    this.tree.nodes.push(node);
    this.commit();
    return node.id;
  }

  /** Draws an arrow between two existing nodes. Returns false if it already exists. */
  connect(from: NodeId, to: NodeId): boolean {
    if (from === to) return false;
    const exists = this.tree.edges.some(
      (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
    );
    if (exists) return false;
    if (!this.node(from) || !this.node(to)) return false;

    this.tree.edges.push({ id: newId(), from, to });
    this.commit();
    return true;
  }

  edgesOf(id: NodeId): Edge[] {
    return this.tree.edges.filter((e) => e.from === id || e.to === id);
  }

  removeEdge(edgeId: string): void {
    this.tree.edges = this.tree.edges.filter((e) => e.id !== edgeId);
    this.commit();
  }

  removeNode(id: NodeId): void {
    this.tree.nodes = this.tree.nodes.filter((n) => n.id !== id);
    this.tree.edges = this.tree.edges.filter((e) => e.from !== id && e.to !== id);
    this.commit();
  }

  updateNode(
    id: NodeId,
    patch: Partial<Pick<TreeNode, "title" | "date" | "description" | "images" | "main">>,
  ): void {
    const node = this.node(id);
    if (!node) return;

    if (patch.title !== undefined) node.title = patch.title.slice(0, TITLE_MAX);
    if (patch.date !== undefined) node.date = patch.date;
    if (patch.description !== undefined) node.description = patch.description;
    if (patch.images !== undefined) node.images = patch.images;
    if (patch.main !== undefined) node.main = patch.main;
    this.commit();
  }

  /** Moves a node to a grid cell. No-op if another node already sits there. */
  moveNode(id: NodeId, cell: Cell): boolean {
    const node = this.node(id);
    if (!node) return false;
    if (node.col === cell.col && node.row === cell.row) return false;

    const blocked = this.tree.nodes.some(
      (n) => n.id !== id && n.col === cell.col && n.row === cell.row,
    );
    if (blocked) return false;

    node.col = cell.col;
    node.row = cell.row;
    this.commit();
    return true;
  }

  /** The whole workspace, as the sync layer sends it to the server. */
  snapshot(): Readonly<Workspace> {
    return this.workspace;
  }

  /**
   * Takes a server copy of the workspace. Which tab is open is local UI state,
   * so it is kept rather than yanked by whatever another device was viewing.
   */
  adopt(raw: unknown): boolean {
    const incoming = normalizeWorkspace(raw);
    if (!incoming) return false;

    incoming.activeTab = this.workspace.activeTab;
    this.workspace = incoming;
    this.commit();
    return true;
  }

  replace(workspace: Workspace): void {
    this.workspace = workspace;
    this.commit();
  }

  /** Exports every tab, so one file is a full backup. */
  toJSON(): string {
    return JSON.stringify(this.workspace, null, 2);
  }

  /**
   * Restores from exported JSON. A whole-workspace file replaces everything;
   * a single-tree file (an export from before tabs) loads into the open tab.
   * Returns an error message on failure.
   */
  fromJSON(raw: string): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return "That file is not valid JSON.";
    }

    const workspace = normalizeWorkspace(parsed);
    if (workspace) {
      this.replace(workspace);
      return null;
    }

    const tree = normalizeTree(parsed);
    if (tree) {
      this.workspace.trees[this.workspace.activeTab] = tree;
      this.commit();
      return null;
    }

    return "That file is not a knowledge tree export.";
  }
}
