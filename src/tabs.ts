import type { TabDef, TabId, TabProfile, Tree } from "./types.js";

/** Dates anchor a timeline. Only history has one. */
const HISTORY: TabProfile = {
  dates: true,
  cards: false,
  examples: false,
  important: false,
  bubbles: false,
};

/**
 * The maths rail carries rules, not events: big cards with room for a
 * statement and a glimpse of the explanation, plus worked examples. The side
 * rails off it are the different kinds of exercise.
 */
const RULES: TabProfile = {
  dates: false,
  cards: true,
  examples: true,
  important: true,
  bubbles: false,
};

/** Vocabulary: single words, each with its English meaning, none connected. */
const WORDS: TabProfile = {
  dates: false,
  cards: false,
  examples: false,
  important: false,
  bubbles: true,
};

/** Plain subjects: titled circles, no dates. */
const PLAIN: TabProfile = {
  dates: false,
  cards: false,
  examples: false,
  important: false,
  bubbles: false,
};

/** The subjects, always shown side by side in the top nav. */
export const TABS: readonly TabDef[] = [
  { id: "italiano", label: "Italiano", profile: PLAIN },
  { id: "storia", label: "Storia", profile: HISTORY },
  { id: "matematica", label: "Matematica", profile: RULES },
  { id: "sistemi-e-reti", label: "Sistemi e reti", profile: PLAIN },
  { id: "database", label: "Database", profile: PLAIN },
  { id: "scienze-politiche", label: "Scienze politiche", profile: PLAIN },
  { id: "scacchi", label: "Scacchi", profile: PLAIN },
  { id: "economia", label: "Economia", profile: PLAIN },
  { id: "spagnolo", label: "Spagnolo", profile: WORDS },
];

export const DEFAULT_TAB: TabId = "storia";

export function isTabId(value: unknown): value is TabId {
  return typeof value === "string" && TABS.some((tab) => tab.id === value);
}

export function labelFor(id: TabId): string {
  return TABS.find((tab) => tab.id === id)?.label ?? id;
}

export function profileFor(id: TabId): TabProfile {
  return TABS.find((tab) => tab.id === id)?.profile ?? PLAIN;
}

/** A fresh, empty tree for every tab. */
export function emptyTrees(): Record<TabId, Tree> {
  const trees = {} as Record<TabId, Tree>;
  for (const tab of TABS) trees[tab.id] = { nodes: [], edges: [] };
  return trees;
}
