/** Grid spacing in world units. */
export const COL_W = 300;
export const ROW_H = 320;

/**
 * Radius of a side-rail node. Main-rail nodes are 20% bigger.
 * Circles are sized to hold a 50-character title inside them.
 */
export const R_SIDE = 60;
export const MAIN_SCALE = 1.2;

/**
 * A corollary is a sub-point hanging off a side node: 20% smaller, and sitting
 * 20% closer, which is what makes its arrow 20% shorter.
 */
export const COROLLARY_SCALE = 0.8;
export const COROLLARY_ROW_STEP = 0.8;

/** Rows land on this grid, so a corollary step stays exact in floating point. */
export const ROW_SNAP = 0.2;

/** Gap left between an arrow tip and the circle it points at. */
export const ARROW_GAP = 14;

/** How far outside the circle the date sits, to its left. */
export const DATE_GAP = 12;

/** Title cap on a circle. */
export const TITLE_MAX = 50;
/** Title cap on a card, which has far more room. */
export const TITLE_MAX_CARD = 200;
/**
 * Hard cap the store enforces, so reshaping a node never truncates silently.
 * Generous rather than restrictive: a vocabulary bubble takes whole phrases,
 * and this is only a backstop against pathological data.
 */
export const TITLE_LIMIT = 500;

/** Main-rail cards, used where the rail carries rules rather than events. */
export const CARD_W = 380;
export const CARD_H = 240;
export const CARD_CORNER = 18;

/**
 * An important side node: a rounded box about the size of a circle, not the
 * size of a main-rail card. Scaled down for a corollary, like the circles are.
 */
export const IMPORTANT_W = 180;
export const IMPORTANT_H = 116;
export const IMPORTANT_CORNER = 15;

/** A cloud of unconnected words: sizes, and the gap gravity must not close. */
export const BUBBLE_MIN_R = 38;
export const BUBBLE_MAX_R = 108;
export const BUBBLE_MARGIN = 26;
/**
 * A bubble grows with the length of what is in it, but logarithmically: quick
 * at first, then flattening off, because a wall of text gains nothing from a
 * wall-sized circle. Tuned so a 30-character word lands near the old size.
 */
export const BUBBLE_GROWTH = 17;
export const BUBBLE_SOFTNESS = 5.3;
export const CARD_PADDING = 18;

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 64;

/** Average glyph width as a fraction of the font size, for our UI sans stack. */
export const GLYPH_RATIO = 0.55;

/** Longest edge of an uploaded image before it is stored. */
export const IMAGE_MAX_EDGE = 1400;

export const STORAGE_KEY = "knowledge-tree:v3";
/** The single-tree key that predates tabs; read once, then left alone. */
export const LEGACY_STORAGE_KEY = "knowledge-tree:v2";
