import { DEFAULT_TAB, emptyTrees } from "./tabs.js";
import type { Workspace } from "./types.js";

/**
 * A first visit: every tab empty except Storia, which holds one main-rail node.
 * "Napoleon 1796" splits into the title inside the circle and the date beside it.
 */
export function seedWorkspace(): Workspace {
  const trees = emptyTrees();
  trees.storia = {
    nodes: [
      {
        id: "root",
        title: "Napoleon",
        date: "1796",
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
      },
    ],
    edges: [],
  };

  return { version: 3, activeTab: DEFAULT_TAB, trees };
}
