export type NodeId = string;
export type EdgeId = string;

/** Where a new node is placed relative to its parent. */
export type Direction = "down" | "down-left" | "down-right";

export interface TreeNode {
  id: NodeId;
  /** Shown inside the circle, capped at TITLE_MAX characters. */
  title: string;
  /**
   * Shown outside the circle, to its left. Free text so "1796", "476 CE" and
   * "c. 1200" all work. Required on the main rail, optional on side rails.
   */
  date: string;
  description: string;
  /** Worked examples. Only used by subjects whose profile asks for them. */
  examples: string;
  /**
   * What the title means in English. Used by vocabulary subjects, where the
   * title is the foreign word and this is its translation.
   */
  translation: string;
  /**
   * The same thing in Italian. Kept for reference and search only: the bubble
   * shows the word and its English meaning, not this.
   */
  italian: string;
  /** Data URLs or remote URLs, shown in the sidebar. */
  images: string[];
  /** Grid coordinates. Screen position is derived in layout.ts. */
  col: number;
  row: number;
  /** True for nodes on the main rail — drawn 20% larger. */
  main: boolean;
  /**
   * A sub-point hanging off a side node, for detail that would clutter the
   * description. Drawn 20% smaller, sits 20% closer, and only ever grows down.
   * Never true at the same time as `main`.
   */
  corollary: boolean;
  /**
   * Flags a side node as worth stopping at. Drawn as a rounded box instead of
   * a circle. Never true on the main rail, which has its own emphasis.
   */
  important: boolean;
}

export interface Edge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
}

/** One subject's tree. Tabs do not share anything. */
export interface Tree {
  nodes: TreeNode[];
  edges: Edge[];
}

export type TabId =
  | "italiano"
  | "storia"
  | "matematica"
  | "sistemi-e-reti"
  | "database"
  | "scienze-politiche"
  | "scacchi"
  | "economia"
  | "spagnolo";

/** How one subject presents its nodes. Subjects are not all the same shape. */
export interface TabProfile {
  /** Main-rail nodes carry a date. Only history works this way. */
  dates: boolean;
  /** Main-rail nodes are rounded cards showing a description excerpt. */
  cards: boolean;
  /** Nodes carry a worked-examples field. */
  examples: boolean;
  /** Side nodes can be flagged important, which squares them off. */
  important: boolean;
  /**
   * A loose cloud of unconnected words rather than a tree: no rails, no
   * arrows, positions decided by gravity instead of the grid.
   */
  bubbles: boolean;
}

export interface TabDef {
  id: TabId;
  label: string;
  profile: TabProfile;
}

/** Everything the app owns: eight independent trees and which one is open. */
export interface Workspace {
  version: 3;
  activeTab: TabId;
  trees: Record<TabId, Tree>;
}

/** Someone who has published their trees for others to read. */
export interface PublishedAccount {
  owner: string;
  name: string;
}

/** What the app is currently showing: your own trees, or somebody else's. */
export interface Viewing {
  owner: string;
  name: string;
}

export interface Cell {
  col: number;
  row: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Pan/zoom of the infinite canvas. world -> screen is `p * scale + offset`. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

/** A title wrapped to sit inside a circle of a given radius. */
export interface FittedTitle {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** Baseline of the first line, relative to the circle centre. */
  firstBaseline: number;
}
