# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project context

"knowledge tree": a browser app (Vite + vanilla TS, no framework) for a study journey on an
endless pan/zoom canvas. Each subject is a tab with its own independent tree. Node >= 20, ESM,
strict tsconfig, vitest. `README.md` is the user-facing manual and the authority on intended
behaviour — read it before changing interaction or layout rules, and update it when they change.

## Commands

- Dev: `npm run dev`
- Build: `npm run build` (typecheck + bundle to `dist/`)
- Preview the production build: `npm run preview` — the README treats this, not `dev`, as how the
  app is checked
- Typecheck: `npm run typecheck` — run before considering a change done
- Test: `npm test` · watch: `npm run test:watch`
- One file: `npx vitest run src/layout.test.ts` · one case: `npx vitest run -t "corollary"`

## Conventions

- ESM only. Relative imports must end in `.js` (e.g. `import { x } from "./thing.js"`).
- `verbatimModuleSyntax` is on: type-only imports must use `import type`.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on — indexing an array yields
  `T | undefined`, and an optional property cannot be set to `undefined` explicitly.
- Source lives in `src/`, build output in `dist/` (gitignored). No `vite.config.ts`: Vite defaults.
- Tests live in `src/` as `*.test.ts`, but are named by feature (`placement`, `corollary`,
  `important`, `selection`, `viewmode`, `profiles`), not one per module. Put a new test where its
  feature lives rather than creating a per-file suite.
- `generate.ps1` and `activity.txt` are local-only helpers, gitignored on purpose.

## Architecture

**One-way flow.** `main.ts` boots everything and wires it: `Store` holds state, `TreeCanvas`
(SVG) and `Sidebar` render it, and both only ever write back through `Store`. Every mutation
calls `commit()`, which persists to `localStorage` and notifies subscribers; the single
subscriber in `main.ts` re-renders the canvas, refreshes the sidebar and updates the chrome.
There is no diffing layer — a render is a full rebuild of the node layer.

**Workspace, not tree.** `Store` owns a `Workspace`: one `Tree` per tab plus the active tab id.
Tabs share nothing. All node/edge methods act on whichever tab is open. `store.ts` also owns
`normalizeWorkspace`/`normalizeTree`, the coercion gate every untrusted payload passes through —
`localStorage`, file import, and a workspace pulled from Supabase all go via it, so a new field on
`TreeNode` must be added there too or it is silently dropped.

**Tab profiles are the extension point.** Subjects are not the same shape: `TabProfile` in
`types.ts` (`dates`, `cards`, `examples`, `important`, `bubbles`) is set per tab in `tabs.ts`, and
`layout.ts`, `canvas.ts` and `sidebar.ts` branch on it rather than on the tab id. To vary
behaviour by subject, add a profile flag — never a check for a specific `TabId`. New flags also
need a fixture in `testing.ts`, which holds the shared profile constants for the suite.

**Grid model.** Nodes store `col`/`row`, not pixels; `layout.ts` derives world coordinates
(`cellToWorld`) and screen position comes from the `Viewport` (`p * scale + offset`). Rows snap to
`ROW_SNAP` so a corollary's 0.8 step stays exact in floating point. `planPlacement` honours the
requested direction exactly: when the target cell is taken, the occupying branch (`branchOf`)
slides sideways as one piece. The main rail is never in a branch, so it never moves — the new node
steps aside instead.

**`layout.ts` is the tested core.** It is pure maths — geometry, placement, and text fitting
(titles wrapped into a circle, card text, bubbles). `canvas.ts` and `sidebar.ts` are DOM-only and
have no tests, and there is no jsdom environment configured, so logic that needs covering belongs
in `layout.ts`, `store.ts`, `bubbles.ts` or `mathnotation.ts`. Tests that touch storage stub it
with `vi.stubGlobal("localStorage", ...)`.

**Two rendering models.** Tree tabs draw rails, arrows and grid-snapped nodes. A `bubbles` profile
(Spagnolo) is a force simulation instead: `bubbles.ts` pulls each word toward the centre and
shoves neighbours apart. Those positions are never persisted — they are re-derived from a hash of
the node id, so the same words always settle the same way. `col`/`row` are ignored there.

**`mathnotation.ts`** turns typed shorthand (`sqrt(x^2+1)`, `pi`, `<=`) into a `MathBox` tree,
which `layout.ts` measures and `canvas.ts` draws as positioned glyphs. Deliberately not LaTeX.

**Sync is optional and additive.** With no `VITE_SUPABASE_*` values, `isConfigured()` is false and
the app is local-only with the sync UI hidden. When configured, `sync.ts` pushes the whole
workspace as one JSON row 1.5s after edits stop and pulls on focus; images go to a storage bucket
instead of into the document. Read-only viewing of another account is enforced by row-level
security in `supabase/schema.sql`, not by the client — `Store` keeps a visited workspace in a
separate field so your own can never be written over while you read theirs.

**`config.ts` holds every tuned constant** (spacing, radii, growth curves, storage keys). Change
sizes and limits there, not at the call site.

### Gotchas

- `VITE_*` values are baked in at build time — `.env` must exist *before* `npm run build`, and a
  change to it needs a rebuild.
- `STORAGE_KEY` is `knowledge-tree:v3`, with a one-time read of the pre-tabs `:v2` key. A
  breaking change to the `Workspace` shape means bumping `version`, the key, and `normalizeWorkspace`.
- The README and several comments say "eight tabs"; `TABS` actually holds nine (Spagnolo was added
  later). Trust `src/tabs.ts`, which is the only place the list is defined.
