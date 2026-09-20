import { BUBBLE_MARGIN, BUBBLE_MAX_R, BUBBLE_MIN_R } from "./config.js";
import type { NodeId, TreeNode } from "./types.js";

/**
 * A loose cloud of words rather than a tree. Each bubble is pulled toward the
 * middle at its own strength, and shoved apart by its neighbours, so the pack
 * settles uneven and a little untidy — which is the point.
 */
export interface Bubble {
  id: NodeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** How hard the middle pulls this one. Varies per word, so packing is uneven. */
  pull: number;
}

const GRAVITY = 0.0022;
const DAMPING = 0.86;
const REPULSION = 0.45;
/**
 * Below this total movement the cloud has settled and the loop can stop.
 * Low on purpose: gravity here is gentle, and a coarser threshold would call a
 * lone word "settled" on its first step, while it was still far out.
 */
export const SETTLED = 0.0015;

/** Stable 0..1 from a string, so a word lands in the same place every time. */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Big enough to hold the longer of the two words. */
export function bubbleRadius(node: Pick<TreeNode, "title" | "translation">): number {
  const longest = Math.max(node.title.trim().length, node.translation.trim().length);
  return Math.min(BUBBLE_MAX_R, Math.max(BUBBLE_MIN_R, 26 + longest * 1.7));
}

/** Where a word starts out before gravity takes hold. */
export function seedBubble(node: TreeNode): Bubble {
  const angle = hash01(`${node.id}:angle`) * Math.PI * 2;
  const distance = 140 + hash01(`${node.id}:distance`) * 460;

  return {
    id: node.id,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    vx: 0,
    vy: 0,
    radius: bubbleRadius(node),
    // Between roughly a half and double, so no two settle quite alike.
    pull: 0.55 + hash01(`${node.id}:pull`) * 1.5,
  };
}

/**
 * Rebuilds the cloud for a set of words, keeping wherever existing ones have
 * already drifted to. Only genuinely new words start from scratch.
 */
export function syncBubbles(previous: readonly Bubble[], nodes: readonly TreeNode[]): Bubble[] {
  const byId = new Map(previous.map((b) => [b.id, b]));

  return nodes.map((node) => {
    const existing = byId.get(node.id);
    if (!existing) return seedBubble(node);
    // A word can be retyped, which changes how much room it needs.
    return { ...existing, radius: bubbleRadius(node) };
  });
}

/**
 * Advances the cloud one step. Returns how much everything moved, so a caller
 * can stop animating once it has come to rest.
 */
export function stepBubbles(bubbles: Bubble[], dt = 1): number {
  for (const bubble of bubbles) {
    bubble.vx -= bubble.x * bubble.pull * GRAVITY * dt;
    bubble.vy -= bubble.y * bubble.pull * GRAVITY * dt;
  }

  // Keep a gap: touching would read as connection, and nothing here connects.
  for (let i = 0; i < bubbles.length; i++) {
    for (let j = i + 1; j < bubbles.length; j++) {
      const a = bubbles[i] as Bubble;
      const b = bubbles[j] as Bubble;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        // Exactly on top of each other: nudge along a fixed diagonal.
        dx = 0.7071;
        dy = 0.7071;
        distance = 1;
      }

      const wanted = a.radius + b.radius + BUBBLE_MARGIN;
      if (distance >= wanted) continue;

      const push = (wanted - distance) * REPULSION;
      const ux = dx / distance;
      const uy = dy / distance;
      a.vx -= ux * push;
      a.vy -= uy * push;
      b.vx += ux * push;
      b.vy += uy * push;
    }
  }

  let movement = 0;
  for (const bubble of bubbles) {
    bubble.vx *= DAMPING;
    bubble.vy *= DAMPING;
    bubble.x += bubble.vx * dt;
    bubble.y += bubble.vy * dt;
    movement += bubble.vx * bubble.vx + bubble.vy * bubble.vy;
  }
  return movement;
}

/** Runs the cloud until it stops moving, for tests and for a first paint. */
export function settleBubbles(bubbles: Bubble[], maxSteps = 900): number {
  let steps = 0;
  while (steps < maxSteps && stepBubbles(bubbles) > SETTLED) steps++;
  return steps;
}

/** True when any two bubbles are closer than the margin allows. */
export function anyOverlap(bubbles: readonly Bubble[], slack = 1): boolean {
  for (let i = 0; i < bubbles.length; i++) {
    for (let j = i + 1; j < bubbles.length; j++) {
      const a = bubbles[i] as Bubble;
      const b = bubbles[j] as Bubble;
      if (Math.hypot(b.x - a.x, b.y - a.y) < a.radius + b.radius + slack) return true;
    }
  }
  return false;
}
