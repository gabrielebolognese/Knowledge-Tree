import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUBBLE_MARGIN, BUBBLE_MAX_R, BUBBLE_MIN_R, TITLE_MAX_BUBBLE } from "./config.js";
import {
  anyOverlap,
  bubbleRadius,
  hash01,
  seedBubble,
  settleBubbles,
  stepBubbles,
  syncBubbles,
  type Bubble,
} from "./bubbles.js";
import { fitBubble, titleLimitFor } from "./layout.js";
import { Store } from "./store.js";
import { DEFAULT_TAB, emptyTrees, profileFor } from "./tabs.js";
import { WORDS_PROFILE } from "./testing.js";
import type { TreeNode, Workspace } from "./types.js";

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

function word(id: string, spanish: string, english = ""): TreeNode {
  return {
    id,
    title: spanish,
    date: "",
    description: "",
    examples: "",
    translation: english,
    images: [],
    col: 0,
    row: 0,
    main: false,
    corollary: false,
    important: false,
  };
}

const VOCAB = [
  word("1", "la casa", "the house"),
  word("2", "el perro", "the dog"),
  word("3", "aprender", "to learn"),
  word("4", "la biblioteca", "the library"),
  word("5", "rápidamente", "quickly"),
  word("6", "el ordenador", "the computer"),
  word("7", "la ventana", "the window"),
  word("8", "escribir", "to write"),
];

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("the Spagnolo tab", () => {
  it("is a cloud, not a tree", () => {
    expect(profileFor("spagnolo")).toEqual(WORDS_PROFILE);
    expect(profileFor("spagnolo").bubbles).toBe(true);
  });

  it("is the only subject that works that way", () => {
    for (const id of ["storia", "matematica", "italiano", "scacchi"] as const) {
      expect(profileFor(id).bubbles).toBe(false);
    }
  });

  it("caps a word at 30 characters", () => {
    const node = { main: false };
    expect(titleLimitFor(node, WORDS_PROFILE)).toBe(TITLE_MAX_BUBBLE);
    expect(titleLimitFor(node, WORDS_PROFILE)).toBe(30);
  });

  it("carries the English meaning alongside the word", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("spagnolo");
    const id = store.addFreeNode({ col: 0, row: 0 });

    store.updateNode(id, { title: "la mariposa", translation: "the butterfly" });

    expect(store.node(id)).toMatchObject({
      title: "la mariposa",
      translation: "the butterfly",
    });
  });

  it("keeps the translation through a save and reload", () => {
    const first = new Store(emptyWorkspace());
    first.setActiveTab("spagnolo");
    first.updateNode(first.addFreeNode({ col: 0, row: 0 }), {
      title: "el árbol",
      translation: "the tree",
    });

    const reopened = new Store();
    reopened.setActiveTab("spagnolo");

    expect(reopened.get().nodes[0]?.translation).toBe("the tree");
  });

  it("defaults to empty for words saved before translations existed", () => {
    const store = new Store(emptyWorkspace());
    const legacy = JSON.stringify({
      nodes: [{ id: "a", title: "hola", description: "", images: [], col: 0, row: 0, main: false }],
      edges: [],
    });

    expect(store.fromJSON(legacy)).toBeNull();
    expect(store.get().nodes[0]?.translation).toBe("");
  });
});

describe("bubble sizing", () => {
  it("grows with the longer of the two words", () => {
    const small = bubbleRadius({ title: "sí", translation: "yes" });
    const big = bubbleRadius({ title: "la biblioteca nacional", translation: "library" });
    expect(big).toBeGreaterThan(small);
  });

  it("is driven by the translation when that is longer", () => {
    const shortBoth = bubbleRadius({ title: "ir", translation: "go" });
    const longGloss = bubbleRadius({ title: "ir", translation: "to go somewhere on foot" });
    expect(longGloss).toBeGreaterThan(shortBoth);
  });

  it("stays between the bounds, even for a 30-character word", () => {
    expect(bubbleRadius({ title: "", translation: "" })).toBe(BUBBLE_MIN_R);
    const longest = bubbleRadius({ title: "x".repeat(TITLE_MAX_BUBBLE), translation: "" });
    expect(longest).toBeLessThanOrEqual(BUBBLE_MAX_R);
    expect(longest).toBeGreaterThan(BUBBLE_MIN_R);
  });
});

describe("gravity", () => {
  function cloud(): Bubble[] {
    return VOCAB.map(seedBubble);
  }

  it("pulls the words together", () => {
    const bubbles = cloud();
    const spreadBefore = Math.max(...bubbles.map((b) => Math.hypot(b.x, b.y)));

    settleBubbles(bubbles);

    const spreadAfter = Math.max(...bubbles.map((b) => Math.hypot(b.x, b.y)));
    expect(spreadAfter).toBeLessThan(spreadBefore);
  });

  it("settles, rather than drifting forever", () => {
    const bubbles = cloud();
    const steps = settleBubbles(bubbles);

    expect(steps).toBeLessThan(900);
    expect(stepBubbles(bubbles)).toBeLessThan(1);
  });

  it("leaves a margin, so none of them touch", () => {
    const bubbles = cloud();
    settleBubbles(bubbles);

    expect(anyOverlap(bubbles)).toBe(false);
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i] as Bubble;
        const b = bubbles[j] as Bubble;
        const gap = Math.hypot(b.x - a.x, b.y - a.y) - a.radius - b.radius;
        expect(gap).toBeGreaterThan(BUBBLE_MARGIN * 0.5);
      }
    }
  });

  it("pulls each word at its own strength, so the pack is uneven", () => {
    const pulls = VOCAB.map((n) => seedBubble(n).pull);
    expect(new Set(pulls).size).toBeGreaterThan(1);
    for (const pull of pulls) {
      expect(pull).toBeGreaterThan(0.5);
      expect(pull).toBeLessThan(2.1);
    }
  });

  it("does not settle into a tidy ring", () => {
    const bubbles = cloud();
    settleBubbles(bubbles);

    // A ring would put everything the same distance out; this should not.
    const distances = bubbles.map((b) => Math.hypot(b.x, b.y));
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    const spread = Math.max(...distances) - Math.min(...distances);
    expect(spread).toBeGreaterThan(mean * 0.25);
  });

  it("survives two words landing exactly on top of each other", () => {
    const stacked: Bubble[] = [
      { id: "a", x: 0, y: 0, vx: 0, vy: 0, radius: 40, pull: 1 },
      { id: "b", x: 0, y: 0, vx: 0, vy: 0, radius: 40, pull: 1 },
    ];

    settleBubbles(stacked);

    for (const b of stacked) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
    }
    expect(anyOverlap(stacked)).toBe(false);
  });

  it("copes with an empty cloud and with one lonely word", () => {
    expect(() => settleBubbles([])).not.toThrow();

    const lonely = [seedBubble(word("only", "solo", "alone"))];
    settleBubbles(lonely);
    expect(Math.hypot(lonely[0]?.x ?? 99, lonely[0]?.y ?? 99)).toBeLessThan(5);
  });
});

describe("a stable, messy arrangement", () => {
  it("puts the same word in the same place every time", () => {
    const once = seedBubble(word("stable", "la puerta", "the door"));
    const twice = seedBubble(word("stable", "la puerta", "the door"));
    expect(once).toEqual(twice);
  });

  it("gives different words different starting points", () => {
    const a = seedBubble(word("a", "uno"));
    const b = seedBubble(word("b", "dos"));
    expect(a.x).not.toBeCloseTo(b.x);
  });

  it("spreads its hash across the range", () => {
    const values = ["a", "b", "c", "d", "e", "f"].map(hash01);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("adding and retyping words", () => {
  it("leaves settled words where they are when a new one arrives", () => {
    const bubbles = VOCAB.slice(0, 4).map(seedBubble);
    settleBubbles(bubbles);
    const before = new Map(bubbles.map((b) => [b.id, { x: b.x, y: b.y }]));

    const grown = syncBubbles(bubbles, [...VOCAB.slice(0, 4), word("9", "nuevo", "new")]);

    for (const bubble of grown) {
      const previous = before.get(bubble.id);
      if (!previous) continue;
      expect(bubble.x).toBeCloseTo(previous.x);
      expect(bubble.y).toBeCloseTo(previous.y);
    }
    expect(grown).toHaveLength(5);
  });

  it("resizes a word in place when it is retyped", () => {
    const bubbles = [seedBubble(word("1", "sí", "yes"))];
    settleBubbles(bubbles);
    const moved = { x: bubbles[0]?.x ?? 0, y: bubbles[0]?.y ?? 0 };

    const grown = syncBubbles(bubbles, [word("1", "sí, por supuesto", "yes, of course")]);

    expect(grown[0]?.radius).toBeGreaterThan(bubbles[0]?.radius ?? 0);
    expect(grown[0]?.x).toBeCloseTo(moved.x);
  });

  it("drops a word that has been deleted", () => {
    const bubbles = VOCAB.map(seedBubble);
    const fewer = syncBubbles(bubbles, VOCAB.slice(0, 3));
    expect(fewer).toHaveLength(3);
  });
});

describe("what a bubble shows", () => {
  it("sets the word above its meaning", () => {
    const fitted = fitBubble("la casa", "the house", 60);

    expect(fitted.wordLines.join(" ")).toBe("la casa");
    expect(fitted.glossLines.join(" ")).toBe("the house");
    expect(fitted.glossBaseline).not.toBeNull();
    expect(fitted.glossBaseline ?? 0).toBeGreaterThan(fitted.firstBaseline);
  });

  it("makes the meaning smaller than the word", () => {
    const fitted = fitBubble("aprender", "to learn", 60);
    expect(fitted.glossFontSize).toBeLessThan(fitted.wordFontSize);
  });

  it("leaves out the meaning when there is none", () => {
    const fitted = fitBubble("hola", "", 50);
    expect(fitted.glossLines).toEqual([]);
    expect(fitted.glossBaseline).toBeNull();
  });

  it("keeps a full-length word inside its bubble", () => {
    const longest = "x".repeat(TITLE_MAX_BUBBLE);
    const radius = bubbleRadius({ title: longest, translation: "" });
    const fitted = fitBubble(longest, "", radius);

    const bottom =
      fitted.firstBaseline + (fitted.wordLines.length - 1) * fitted.wordLineHeight;
    expect(Math.abs(fitted.firstBaseline - fitted.wordFontSize)).toBeLessThan(radius);
    expect(bottom).toBeLessThan(radius);
  });

  it("marks a word too long to fit", () => {
    const fitted = fitBubble("palabra ".repeat(12), "", 40);
    expect(fitted.wordLines.length).toBeLessThanOrEqual(2);
    expect(fitted.wordLines[fitted.wordLines.length - 1]?.endsWith("…")).toBe(true);
  });
});
