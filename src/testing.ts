import type { NodeShape } from "./layout.js";
import type { TabProfile } from "./types.js";

/** Shared fixtures for the test suite. */

export const PLAIN_PROFILE: TabProfile = {
  dates: false,
  cards: false,
  examples: false,
  important: false,
};
export const HISTORY_PROFILE: TabProfile = {
  dates: true,
  cards: false,
  examples: false,
  important: false,
};
export const RULES_PROFILE: TabProfile = {
  dates: false,
  cards: true,
  examples: true,
  important: true,
};

export function circle(radius: number): NodeShape {
  return { kind: "circle", radius };
}
