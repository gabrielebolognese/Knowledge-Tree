import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CARD_H,
  CARD_W,
  COL_W,
  R_SIDE,
  ROW_H,
  TITLE_LIMIT,
  TITLE_MAX,
  TITLE_MAX_CARD,
} from "./config.js";
import {
  cellToWorld,
  edgeGeometry,
  exitDistance,
  fitCardText,
  isCard,
  shapeOf,
  titleLimitFor,
} from "./layout.js";
import { Store } from "./store.js";
import { DEFAULT_TAB, TABS, emptyTrees, profileFor } from "./tabs.js";
import { HISTORY_PROFILE, PLAIN_PROFILE, RULES_PROFILE } from "./testing.js";
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

describe("subject profiles", () => {
  it("gives dates to history and nothing else", () => {
    expect(profileFor("storia").dates).toBe(true);

    for (const tab of TABS) {
      if (tab.id === "storia") continue;
      expect(profileFor(tab.id).dates).toBe(false);
    }
  });

  it("gives cards and examples to maths and nothing else", () => {
    expect(profileFor("matematica")).toMatchObject({ cards: true, examples: true, dates: false });

    for (const tab of TABS) {
      if (tab.id === "matematica") continue;
      expect(profileFor(tab.id).cards).toBe(false);
      expect(profileFor(tab.id).examples).toBe(false);
    }
  });

  it("leaves the other six subjects as plain titled circles", () => {
    for (const id of ["italiano", "sistemi-e-reti", "database", "scienze-politiche", "scacchi", "economia"] as const) {
      expect(profileFor(id)).toEqual(PLAIN_PROFILE);
    }
  });
});

describe("dates outside history", () => {
  it("never reports a missing date in a subject that has none", () => {
    const store = new Store(emptyWorkspace());

    store.setActiveTab("matematica");
    store.addMainNode();
    expect(store.missingDates()).toHaveLength(0);

    store.setActiveTab("scacchi");
    store.addMainNode();
    expect(store.missingDates()).toHaveLength(0);
  });

  it("still requires them on the history rail", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("storia");
    store.addMainNode();

    expect(store.missingDates()).toHaveLength(1);
  });

  it("reports against whichever tab is open", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("storia");
    store.addMainNode();
    expect(store.missingDates()).toHaveLength(1);

    store.setActiveTab("economia");
    expect(store.missingDates()).toHaveLength(0);
  });
});

describe("maths cards", () => {
  const mainNode = { main: true, corollary: false, important: false };
  const sideNode = { main: false, corollary: false, important: false };

  it("draws the main rail as cards, and side rails as circles", () => {
    expect(isCard(mainNode, RULES_PROFILE)).toBe(true);
    expect(isCard(sideNode, RULES_PROFILE)).toBe(false);

    expect(shapeOf(mainNode, RULES_PROFILE)).toEqual({
      kind: "rect",
      halfWidth: CARD_W / 2,
      halfHeight: CARD_H / 2,
    });
    expect(shapeOf(sideNode, RULES_PROFILE).kind).toBe("circle");
  });

  it("leaves the history rail as circles", () => {
    expect(isCard(mainNode, HISTORY_PROFILE)).toBe(false);
    expect(shapeOf(mainNode, HISTORY_PROFILE).kind).toBe("circle");
  });

  it("allows 200 characters on a card and 50 on a circle", () => {
    expect(titleLimitFor(mainNode, RULES_PROFILE)).toBe(TITLE_MAX_CARD);
    expect(titleLimitFor(mainNode, RULES_PROFILE)).toBe(200);
    expect(titleLimitFor(sideNode, RULES_PROFILE)).toBe(TITLE_MAX);
    expect(titleLimitFor(mainNode, HISTORY_PROFILE)).toBe(TITLE_MAX);
  });

  it("keeps a 200-character rule and a description excerpt inside the card", () => {
    const rule =
      "Per derivare un prodotto di due funzioni si deriva la prima e si moltiplica per la seconda, poi si somma la prima moltiplicata per la derivata della seconda, ottenendo la regola di Leibniz completa.";
    expect(rule.length).toBeGreaterThan(150);
    expect(rule.length).toBeLessThanOrEqual(TITLE_MAX_CARD);

    const fitted = fitCardText(rule, "Vale per ogni coppia di funzioni derivabili nello stesso punto.");

    expect(fitted.titleLines.length).toBeLessThanOrEqual(6);
    expect(fitted.descriptionLines.length).toBeGreaterThan(0);
    expect(fitted.descriptionLines.length).toBeLessThanOrEqual(2);

    // The whole block has to sit within the card's height.
    const blockTop = fitted.firstBaseline - fitted.titleFontSize;
    const blockBottom =
      fitted.firstBaseline +
      fitted.titleLines.length * fitted.titleLineHeight +
      9 +
      fitted.descriptionLines.length * fitted.descriptionLineHeight;
    expect(blockTop).toBeGreaterThan(-CARD_H / 2);
    expect(blockBottom).toBeLessThan(CARD_H / 2);
  });

  it("shows only a glimpse of a long description, marked with an ellipsis", () => {
    const fitted = fitCardText("Regola", "parola ".repeat(200));

    // Two lines now: the examples block takes the third.
    expect(fitted.descriptionLines).toHaveLength(2);
    expect(fitted.descriptionLines[1]?.endsWith("…")).toBe(true);
  });

  it("omits the description block entirely when there is none", () => {
    const fitted = fitCardText("Regola di Leibniz", "");
    expect(fitted.descriptionLines).toEqual([]);
  });
});

describe("arrows against a card", () => {
  const card = shapeOf({ main: true, corollary: false, important: false }, RULES_PROFILE);
  const circle = shapeOf({ main: false, corollary: false, important: false }, PLAIN_PROFILE);

  it("leaves the card through its edge, not a circumscribed circle", () => {
    // Straight down exits through the flat bottom.
    expect(exitDistance(card, 0, 1)).toBeCloseTo(CARD_H / 2);
    // Straight sideways exits through the side.
    expect(exitDistance(card, 1, 0)).toBeCloseTo(CARD_W / 2);
    // A circle is the same distance whichever way you leave it.
    expect(exitDistance(circle, 0, 1)).toBeCloseTo(R_SIDE);
    expect(exitDistance(circle, 0.6, 0.8)).toBeCloseTo(R_SIDE);
  });

  it("starts the arrow clear of a card below it", () => {
    const geom = edgeGeometry(
      cellToWorld({ col: 0, row: 0 }),
      cellToWorld({ col: 0, row: 1 }),
      card,
      card,
    );

    expect(geom).not.toBeNull();
    expect(geom?.y1).toBeGreaterThan(CARD_H / 2);
    expect(geom?.y2).toBeLessThan(ROW_H - CARD_H / 2);
  });

  it("still fits between two stacked cards at the row spacing", () => {
    expect(ROW_H).toBeGreaterThan(CARD_H);
    expect(
      edgeGeometry(cellToWorld({ col: 0, row: 0 }), cellToWorld({ col: 0, row: 1 }), card, card),
    ).not.toBeNull();
  });

  it("keeps a card clear of a side circle in the next column", () => {
    expect(COL_W).toBeGreaterThan(CARD_W / 2 + R_SIDE);
    expect(
      edgeGeometry(cellToWorld({ col: 0, row: 0 }), cellToWorld({ col: 1, row: 1 }), card, circle),
    ).not.toBeNull();
  });
});

describe("examples", () => {
  it("starts empty and round-trips through JSON", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("matematica");
    const id = store.addMainNode();
    expect(store.node(id)?.examples).toBe("");

    store.updateNode(id, { examples: "2x + 3 = 7\nx = 2" });

    const other = new Store(emptyWorkspace());
    expect(other.fromJSON(store.toJSON())).toBeNull();
    other.setActiveTab("matematica");
    expect(other.get().nodes[0]?.examples).toBe("2x + 3 = 7\nx = 2");
  });

  it("defaults to empty for a tree saved before examples existed", () => {
    const store = new Store(emptyWorkspace());
    const legacy = JSON.stringify({
      nodes: [
        { id: "a", title: "Regola", date: "", description: "", images: [], col: 0, row: 0, main: true },
      ],
      edges: [],
    });

    expect(store.fromJSON(legacy)).toBeNull();
    expect(store.get().nodes[0]?.examples).toBe("");
  });
});

describe("title capacity across shapes", () => {
  it("stores up to the card limit, so reshaping a node never truncates it", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("matematica");
    const id = store.addMainNode();

    const long = "x".repeat(TITLE_MAX_CARD);
    store.updateNode(id, { title: long });
    expect(store.node(id)?.title).toHaveLength(TITLE_MAX_CARD);

    // Taking it off the rail must not silently eat 150 characters.
    store.updateNode(id, { main: false });
    expect(store.node(id)?.title).toHaveLength(TITLE_MAX_CARD);
  });

  it("still has a backstop against pathological input", () => {
    const store = new Store(emptyWorkspace());
    const id = store.addMainNode();
    store.updateNode(id, { title: "y".repeat(9000) });
    // A card's own 200 limit is enforced by the input, not the store.
    expect(store.node(id)?.title).toHaveLength(TITLE_LIMIT);
  });
});
