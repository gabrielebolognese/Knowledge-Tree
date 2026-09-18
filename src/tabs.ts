import type { TabDef, TabId, Tree } from "./types.js";

/** The eight subjects, always shown side by side in the top nav. */
export const TABS: readonly TabDef[] = [
  { id: "italiano", label: "Italiano" },
  { id: "storia", label: "Storia" },
  { id: "matematica", label: "Matematica" },
  { id: "sistemi-e-reti", label: "Sistemi e reti" },
  { id: "database", label: "Database" },
  { id: "scienze-politiche", label: "Scienze politiche" },
  { id: "scacchi", label: "Scacchi" },
  { id: "economia", label: "Economia" },
];

export const DEFAULT_TAB: TabId = "storia";

export function isTabId(value: unknown): value is TabId {
  return typeof value === "string" && TABS.some((tab) => tab.id === value);
}

export function labelFor(id: TabId): string {
  return TABS.find((tab) => tab.id === id)?.label ?? id;
}

/** A fresh, empty tree for every tab. */
export function emptyTrees(): Record<TabId, Tree> {
  const trees = {} as Record<TabId, Tree>;
  for (const tab of TABS) trees[tab.id] = { nodes: [], edges: [] };
  return trees;
}
