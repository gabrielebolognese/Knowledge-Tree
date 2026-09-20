import { describe, expect, it } from "vitest";

import { DEFAULT_TAB, TABS, emptyTrees, isTabId, labelFor } from "./tabs.js";

describe("TABS", () => {
  it("is the nine subjects, in order", () => {
    expect(TABS.map((tab) => tab.label)).toEqual([
      "Italiano",
      "Storia",
      "Matematica",
      "Sistemi e reti",
      "Database",
      "Scienze politiche",
      "Scacchi",
      "Economia",
      "Spagnolo",
    ]);
  });

  it("has a unique id per tab", () => {
    const ids = TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens on a real tab", () => {
    expect(isTabId(DEFAULT_TAB)).toBe(true);
  });
});

describe("isTabId", () => {
  it("accepts known ids and rejects anything else", () => {
    expect(isTabId("scacchi")).toBe(true);
    expect(isTabId("chemistry")).toBe(false);
    expect(isTabId(7)).toBe(false);
    expect(isTabId(null)).toBe(false);
  });
});

describe("labelFor", () => {
  it("returns the display label", () => {
    expect(labelFor("sistemi-e-reti")).toBe("Sistemi e reti");
  });
});

describe("emptyTrees", () => {
  it("gives every tab its own empty tree", () => {
    const trees = emptyTrees();

    expect(Object.keys(trees)).toHaveLength(TABS.length);
    for (const tab of TABS) {
      expect(trees[tab.id]).toEqual({ nodes: [], edges: [] });
    }

    // Separate objects, so writing to one tab cannot touch another.
    trees.storia.nodes.push({
      id: "a",
      title: "",
      date: "",
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
    });
    expect(trees.italiano.nodes).toHaveLength(0);
  });
});
