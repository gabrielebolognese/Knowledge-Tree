import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUBBLE_MARGIN, BUBBLE_MAX_R, BUBBLE_MIN_R } from "./config.js";
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
import { RULES_PROFILE, WORDS_PROFILE } from "./testing.js";
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
    italian: "",
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

  it("puts no limit on the length of a phrase", () => {
    const node = { main: false };
    expect(titleLimitFor(node, WORDS_PROFILE)).toBe(Number.POSITIVE_INFINITY);
    // Every other subject still has one.
    expect(Number.isFinite(titleLimitFor(node, RULES_PROFILE))).toBe(true);
  });

  it("stores a long phrase without cutting it", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("spagnolo");
    const id = store.addFreeNode({ col: 0, row: 0 });
    const phrase =
      "no hay mal que por bien no venga, aunque a veces cueste mucho verlo en el momento";

    store.updateNode(id, { title: phrase, translation: "every cloud has a silver lining" });

    expect(store.node(id)?.title).toBe(phrase);
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

  it("carries a third word: the Italian, which is stored but not drawn", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("spagnolo");
    const id = store.addFreeNode({ col: 0, row: 0 });

    store.updateNode(id, {
      title: "la mariposa",
      translation: "the butterfly",
      italian: "la farfalla",
    });

    expect(store.node(id)).toMatchObject({
      title: "la mariposa",
      translation: "the butterfly",
      italian: "la farfalla",
    });
  });

  it("keeps the Italian out of what the bubble shows", () => {
    const fitted = fitBubble("la mariposa", "the butterfly", 60);
    const drawn = [...fitted.wordLines, ...fitted.glossLines].join(" ");

    expect(drawn).toContain("mariposa");
    expect(drawn).toContain("butterfly");
    expect(drawn).not.toContain("farfalla");
  });

  it("sizes the bubble off the two words it shows, not the Italian", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("spagnolo");
    const plain = store.addFreeNode({ col: 0, row: 0 });
    const verbose = store.addFreeNode({ col: 5, row: 5 });

    store.updateNode(plain, { title: "s\u00ed", translation: "yes" });
    store.updateNode(verbose, {
      title: "s\u00ed",
      translation: "yes",
      italian: "s\u00ec, certamente, senza alcun dubbio possibile",
    });

    const a = store.node(plain);
    const b = store.node(verbose);
    if (!a || !b) throw new Error("missing node");
    // Same two visible words, so the same circle however long the Italian is.
    expect(bubbleRadius(b)).toBe(bubbleRadius(a));
  });

  it("round-trips the Italian through JSON", () => {
    const store = new Store(emptyWorkspace());
    store.setActiveTab("spagnolo");
    store.updateNode(store.addFreeNode({ col: 0, row: 0 }), {
      title: "el gato",
      translation: "the cat",
      italian: "il gatto",
    });

    const other = new Store(emptyWorkspace());
    expect(other.fromJSON(store.toJSON())).toBeNull();
    other.setActiveTab("spagnolo");

    expect(other.get().nodes[0]?.italian).toBe("il gatto");
  });

  it("defaults the Italian to empty for words saved before it existed", () => {
    const store = new Store(emptyWorkspace());
    const legacy = JSON.stringify({
      nodes: [
        {
          id: "a",
          title: "hola",
          translation: "hello",
          description: "",
          images: [],
          col: 0,
          row: 0,
          main: false,
        },
      ],
      edges: [],
    });

    expect(store.fromJSON(legacy)).toBeNull();
    expect(store.get().nodes[0]?.italian).toBe("");
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

  it("stays between the bounds, however long the phrase", () => {
    expect(bubbleRadius({ title: "", translation: "" })).toBe(BUBBLE_MIN_R);

    for (const length of [1, 30, 120, 500, 5000]) {
      const r = bubbleRadius({ title: "x".repeat(length), translation: "" });
      expect(r).toBeGreaterThanOrEqual(BUBBLE_MIN_R);
      expect(r).toBeLessThanOrEqual(BUBBLE_MAX_R);
    }
  });

  it("grows quickly at first, then hardly at all", () => {
    const at = (n: number): number => bubbleRadius({ title: "x".repeat(n), translation: "" });

    // Ten more characters early on is worth far more than ten more later.
    const early = at(15) - at(5);
    const late = at(215) - at(205);
    expect(early).toBeGreaterThan(late * 5);
  });

  it("keeps growing with length, just ever more slowly", () => {
    const at = (n: number): number => bubbleRadius({ title: "x".repeat(n), translation: "" });
    expect(at(5)).toBeLessThan(at(20));
    expect(at(20)).toBeLessThan(at(80));
    expect(at(80)).toBeLessThan(at(300));
  });

  it("never lets a long phrase dwarf a short one", () => {
    const short = bubbleRadius({ title: "sí", translation: "yes" });
    const huge = bubbleRadius({ title: "x".repeat(4000), translation: "" });
    expect(huge / short).toBeLessThan(3);
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
    const longest = "x".repeat(30);
    const radius = bubbleRadius({ title: longest, translation: "" });
    const fitted = fitBubble(longest, "", radius);

    const bottom =
      fitted.firstBaseline + (fitted.wordLines.length - 1) * fitted.wordLineHeight;
    expect(Math.abs(fitted.firstBaseline - fitted.wordFontSize)).toBeLessThan(radius);
    expect(bottom).toBeLessThan(radius);
  });

  it("shrinks the type for a phrase rather than overflowing", () => {
    const shortWord = fitBubble("casa", "house", 60);
    const phrase = "no hay mal que por bien no venga, aunque cueste verlo";
    const fitted = fitBubble(
      phrase,
      "every cloud has a silver lining",
      bubbleRadius({ title: phrase, translation: "every cloud has a silver lining" }),
    );

    expect(fitted.wordFontSize).toBeLessThan(shortWord.wordFontSize);
    expect(fitted.wordLines.length).toBeGreaterThan(1);
  });

  it("keeps every line of a phrase inside the circle", () => {
    const phrase =
      "no hay mal que por bien no venga, aunque a veces cueste mucho verlo en el momento";
    const english = "a long English rendering of the very same saying";
    const radius = bubbleRadius({ title: phrase, translation: english });
    const fitted = fitBubble(phrase, english, radius);

    const lines = [
      ...fitted.wordLines.map((text, i) => ({
        text,
        y: fitted.firstBaseline + i * fitted.wordLineHeight,
        font: fitted.wordFontSize,
      })),
      ...fitted.glossLines.map((text, i) => ({
        text,
        y: (fitted.glossBaseline ?? 0) + i * fitted.glossLineHeight,
        font: fitted.glossFontSize,
      })),
    ];

    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      const halfWidth = (line.text.length * line.font * 0.55) / 2;
      const top = line.y - line.font * 0.8;
      const bottom = line.y + line.font * 0.25;
      const far = Math.max(Math.abs(top), Math.abs(bottom));
      expect(Math.hypot(halfWidth, far)).toBeLessThanOrEqual(radius);
    }
  });

  it("only cuts text when even the smallest type will not do", () => {
    const fitted = fitBubble("palabra ".repeat(200), "", BUBBLE_MAX_R);

    expect(fitted.wordFontSize).toBe(9);
    expect(fitted.wordLines[fitted.wordLines.length - 1]?.endsWith("…")).toBe(true);
  });
});
