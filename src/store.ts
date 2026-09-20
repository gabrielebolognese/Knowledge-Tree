import {
  COROLLARY_ROW_STEP,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  TITLE_LIMIT,
} from "./config.js";
import {
  branchOf,
  childIsCorollary,
  findFreeCell,
  overlaps,
  planPlacement,
  snapRow,
} from "./layout.js";
import { seedWorkspace } from "./seed.js";
import { DEFAULT_TAB, TABS, emptyTrees, isTabId, profileFor } from "./tabs.js";
import type {
  Cell,
  Direction,
  Edge,
  NodeId,
  TabId,
  TabProfile,
  Tree,
  TreeNode,
  Viewing,
  Workspace,
} from "./types.js";

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
      title: str(n["title"]).slice(0, TITLE_LIMIT),
      date: str(n["date"]),
      description: str(n["description"]),
      examples: str(n["examples"]),
      translation: str(n["translation"]),
      italian: str(n["italian"]),
      images: Array.isArray(n["images"])
        ? n["images"].filter((i): i is string => typeof i === "string")
        : [],
      col: num(n["col"]),
      row: snapRow(num(n["row"])),
      main: n["main"] === true,
      corollary: n["main"] !== true && n["corollary"] === true,
      important: n["main"] !== true && n["important"] === true,
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
  /**
   * Someone else's trees, held separately so your own can never be written
   * over while you are reading theirs.
   */
  private viewed: { who: Viewing; workspace: Workspace } | null = null;
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

  /** Whichever workspace is on screen: yours, or the one you are visiting. */
  private get active(): Workspace {
    return this.viewed?.workspace ?? this.workspace;
  }

  /** The open tab's tree. Every mutation below works on this. */
  private get tree(): Tree {
    return this.active.trees[this.active.activeTab];
  }

  /** True while visiting someone else's trees, when nothing may be changed. */
  isReadOnly(): boolean {
    return this.viewed !== null;
  }

  viewing(): Viewing | null {
    return this.viewed?.who ?? null;
  }

  /**
   * Shows another account's workspace. Returns false if the payload is not a
   * tree. Your own stays exactly as it was, untouched, underneath.
   */
  viewAccount(who: Viewing, raw: unknown): boolean {
    const workspace = normalizeWorkspace(raw);
    if (!workspace) return false;

    // Keep the tab you were on, so switching accounts does not jump subjects.
    workspace.activeTab = this.active.activeTab;
    this.viewed = { who, workspace };
    this.commit();
    return true;
  }

  /** Returns to your own trees. */
  stopViewing(): void {
    if (!this.viewed) return;
    this.viewed = null;
    this.commit();
  }

  get(): Readonly<Tree> {
    return this.tree;
  }

  getActiveTab(): TabId {
    return this.active.activeTab;
  }

  /** How the open subject presents its nodes. */
  profile(): TabProfile {
    return profileFor(this.active.activeTab);
  }

  setActiveTab(id: TabId): void {
    if (id === this.active.activeTab) return;
    // Switching subjects is navigation, not editing, so it works while viewing.
    this.active.activeTab = id;
    this.commit();
  }

  /** How many nodes a tab holds, open or not. */
  countFor(id: TabId): number {
    return this.active.trees[id].nodes.length;
  }

  getSaveError(): string | null {
    return this.saveError;
  }

  node(id: NodeId | null): TreeNode | undefined {
    if (!id) return undefined;
    return this.tree.nodes.find((n) => n.id === id);
  }

  /**
   * Main-rail nodes in the open tab still missing their mandatory date.
   * Empty for every subject but history, which is the only one that has dates.
   */
  missingDates(): TreeNode[] {
    if (!this.profile().dates) return [];
    return this.tree.nodes.filter((n) => n.main && n.date.trim() === "");
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(): void {
    // Someone else's trees are never written to your storage, or pushed up.
    if (this.viewed) {
      for (const fn of this.listeners) fn();
      return;
    }

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

  private blank(cell: Cell, main: boolean, corollary = false): TreeNode {
    return {
      id: newId(),
      title: "",
      date: "",
      description: "",
      examples: "",
      translation: "",
      italian: "",
      images: [],
      col: cell.col,
      row: cell.row,
      main,
      corollary,
      important: false,
    };
  }

  /** The lowest main-rail node, which is where the rail continues from. */
  private lastMainNode(): TreeNode | undefined {
    return this.tree.nodes.filter((n) => n.main).sort((a, b) => b.row - a.row)[0];
  }

  /** Starts a new main rail, or continues the existing one from its last node. */
  addMainNode(): NodeId {
    if (this.viewed) return "";
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
    if (this.viewed) return null;
    const parent = this.node(parentId);
    if (!parent) return null;

    const plan = planPlacement(parent, dir, this.tree.nodes, this.tree.edges);

    // Anything in the way slides aside first, keeping its own shape.
    for (const [id, cell] of plan.moves) {
      const node = this.node(id);
      if (!node) continue;
      node.col = cell.col;
      node.row = cell.row;
    }

    const child = this.blank(
      plan.cell,
      parent.main && dir === "down",
      childIsCorollary(parent, dir),
    );
    this.tree.nodes.push(child);
    this.tree.edges.push({ id: newId(), from: parent.id, to: child.id });
    this.commit();
    return child.id;
  }

  /** Drops an unconnected node on the grid, e.g. to start a second rail. */
  addFreeNode(cell: Cell): NodeId {
    if (this.viewed) return "";
    const node = this.blank(findFreeCell(this.cells(), cell, 1), false);
    this.tree.nodes.push(node);
    this.commit();
    return node.id;
  }

  /** Draws an arrow between two existing nodes. Returns false if it already exists. */
  connect(from: NodeId, to: NodeId): boolean {
    if (this.viewed) return false;
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
    if (this.viewed) return;
    this.tree.edges = this.tree.edges.filter((e) => e.id !== edgeId);
    this.commit();
  }

  removeNode(id: NodeId): void {
    if (this.viewed) return;
    this.tree.nodes = this.tree.nodes.filter((n) => n.id !== id);
    this.tree.edges = this.tree.edges.filter((e) => e.from !== id && e.to !== id);
    this.commit();
  }

  updateNode(
    id: NodeId,
    patch: Partial<
      Pick<
        TreeNode,
        | "title"
        | "date"
        | "description"
        | "examples"
        | "translation"
        | "italian"
        | "images"
        | "main"
        | "corollary"
        | "important"
      >
    >,
  ): void {
    if (this.viewed) return;
    const node = this.node(id);
    if (!node) return;

    if (patch.title !== undefined) node.title = patch.title.slice(0, TITLE_LIMIT);
    if (patch.date !== undefined) node.date = patch.date;
    if (patch.description !== undefined) node.description = patch.description;
    if (patch.examples !== undefined) node.examples = patch.examples;
    if (patch.translation !== undefined) node.translation = patch.translation;
    if (patch.italian !== undefined) node.italian = patch.italian;
    if (patch.images !== undefined) node.images = patch.images;

    // A node is on the main rail, or a corollary, or neither — never both.
    if (patch.main === true) this.setCorollary(node, false);
    if (patch.main !== undefined) node.main = patch.main;
    if (patch.corollary !== undefined) {
      if (patch.corollary) node.main = false;
      this.setCorollary(node, patch.corollary);
    }

    // Important is an emphasis for side nodes; the rail has its own.
    if (patch.important !== undefined) {
      if (patch.important) node.main = false;
      node.important = patch.important;
    }
    if (node.main) node.important = false;

    this.commit();
  }

  /**
   * Turning a node into a corollary pulls it 20% closer to its parent, which
   * is what shortens the arrow. Anything hanging below it comes along, so the
   * sub-tree keeps its spacing.
   */
  private setCorollary(node: TreeNode, value: boolean): void {
    if (node.corollary === value) return;

    const hasParent = this.tree.edges.some((e) => e.to === node.id);
    node.corollary = value;
    if (!hasParent) return;

    const delta = (value ? -1 : 1) * (1 - COROLLARY_ROW_STEP);
    for (const id of branchOf(node.id, this.tree.nodes, this.tree.edges)) {
      const member = this.node(id);
      if (member) member.row = snapRow(member.row + delta);
    }
  }

  /** Moves a node to a grid cell. No-op if another node already sits there. */
  moveNode(id: NodeId, cell: Cell): boolean {
    if (this.viewed) return false;
    const node = this.node(id);
    if (!node) return false;
    if (node.col === cell.col && node.row === cell.row) return false;

    const blocked = this.tree.nodes.some((n) => n.id !== id && overlaps(n, cell));
    if (blocked) return false;

    node.col = cell.col;
    node.row = cell.row;
    this.commit();
    return true;
  }

  /** Your own workspace, as the sync layer sends it up. Never the visited one. */
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

  /**
   * Moves a group in one step. Either every node lands clear, or nothing moves
   * at all — a partial shift would tear the shape apart.
   */
  moveNodesTo(placements: ReadonlyMap<NodeId, Cell>): boolean {
    if (this.viewed) return false;
    if (placements.size === 0) return false;

    const moving = new Set(placements.keys());
    const taken: Cell[] = this.tree.nodes
      .filter((n) => !moving.has(n.id))
      .map((n) => ({ col: n.col, row: n.row }));

    for (const cell of placements.values()) {
      if (taken.some((c) => overlaps(c, cell))) return false;
      taken.push(cell);
    }

    let changed = false;
    for (const [id, cell] of placements) {
      const node = this.node(id);
      if (!node) continue;
      if (node.col !== cell.col || node.row !== cell.row) changed = true;
      node.col = cell.col;
      node.row = cell.row;
    }

    if (changed) this.commit();
    return changed;
  }

  replace(workspace: Workspace): void {
    if (this.viewed) return;
    this.workspace = workspace;
    this.commit();
  }

  /** Exports every tab of whatever is on screen, so one file is a full backup. */
  toJSON(): string {
    return JSON.stringify(this.active, null, 2);
  }

  /**
   * Restores from exported JSON. A whole-workspace file replaces everything;
   * a single-tree file (an export from before tabs) loads into the open tab.
   * Returns an error message on failure.
   */
  fromJSON(raw: string): string | null {
    if (this.viewed) return "Stop viewing before importing into your own trees.";
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
