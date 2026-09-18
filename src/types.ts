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
  /** Data URLs or remote URLs, shown in the sidebar. */
  images: string[];
  /** Grid coordinates. Screen position is derived in layout.ts. */
  col: number;
  row: number;
  /** True for nodes on the main rail — drawn 20% larger. */
  main: boolean;
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
  | "economia";

export interface TabDef {
  id: TabId;
  label: string;
}

/** Everything the app owns: eight independent trees and which one is open. */
export interface Workspace {
  version: 3;
  activeTab: TabId;
  trees: Record<TabId, Tree>;
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
