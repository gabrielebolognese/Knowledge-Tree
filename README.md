# knowledge tree

A minimal, endless canvas for mapping a study journey. Each subject is a **tab** with its
own independent tree: a **main rail** carries the core flow of the subject and **side
rails** branch off it diagonally, so a detail can be followed as deep as it deserves. It
is a browser app written in vanilla TypeScript with Vite, built as a personal study tool.
It works entirely offline in one browser, and can optionally sync between devices and
publish read-only trees through a Supabase project you supply.

## Features

### Canvas

- Infinite SVG canvas with pan, zoom (2% to 6400%) and a **Fit** command that frames the whole tree.
- Nodes live on a grid (`col`/`row`); dragging a node snaps it to the grid.
- Three `+` handles on a selected node: straight down continues the rail, a diagonal starts a side rail.
- Placement honours the requested direction exactly. If the target cell is taken, the
  branch sitting there slides sideways as one piece; the main rail never moves.
- Shift-click to draw an arrow between two nodes; double-click empty space for a loose node.
- Ctrl-drag box selection, Ctrl-click to add or remove a node, and group dragging.
- Yellow outlines, orange arrows, white text on dark grey.

### Nodes

- **Main-rail nodes** are drawn 20% larger than side nodes.
- **Corollaries** are sub-points drawn 20% smaller and 20% closer to their parent. They
  only grow downward, and whatever hangs below a node follows when it becomes a corollary.
- **Important** side nodes (where the subject's profile allows it) are drawn as a rounded
  box instead of a circle.
- Titles are wrapped to fit inside the circle (50 characters on a circle, 200 on a card).
- A sidebar edits the selected node: title, date, description, examples, images and
  connections, plus the **On the main rail**, **Is a corollary** and **Important** toggles.
- Images can be uploaded or added by URL, are downscaled to a 1400px longest edge
  (WebP), and open in a lightbox.

### Subjects and tab profiles

Nine tabs, defined in one array in `src/tabs.ts`:

`Italiano · Storia · Matematica · Sistemi e reti · Database · Scienze politiche · Scacchi · Economia · Spagnolo`

Subjects are not all the same shape. Each tab has a profile that changes how it renders:

| Profile | Tab | Behaviour |
| --- | --- | --- |
| History | Storia | Main-rail nodes require a date, shown to the left of the circle. Missing dates are flagged in red and counted in the toolbar. |
| Rules | Matematica | Main-rail nodes are rounded cards showing a description excerpt, with a worked-examples field and the **Important** flag for side nodes. Examples are drawn with math notation. |
| Words | Spagnolo | Not a tree: a cloud of unconnected bubbles (word, English meaning, Italian kept for reference), laid out by a small force simulation. |
| Plain | all others | Titled circles, no dates. |

Details worth knowing:

- **Math notation** (`src/mathnotation.ts`): typed shorthand such as `sqrt(x^2+1)`, `pi`,
  `<=`, `x_1` or `alpha` is parsed into radicals, superscripts, subscripts and symbols.
  It is deliberately not LaTeX.
- **Word cloud**: each bubble is pulled toward the centre at its own strength and pushed
  apart by its neighbours. Positions are never stored; they are re-derived from a hash of
  the node id, so the same words always settle the same way. Bubble size grows
  logarithmically with text length, up to a 108px radius.
- Tabs share nothing. Switching tabs keeps each tab's pan and zoom for the session.
- A first visit opens on **Storia** with a single seed node: *Napoleon*, dated 1796.

### Storage, sync and sharing

- Every change is saved to `localStorage` (`knowledge-tree:v3`); a pre-tabs `v2` tree is read once and migrated.
- **Export** downloads every tab as `knowledge-tree.json`; **Import** reads it back. A
  single-tree file from before tabs imports into the open tab.
- **Optional Supabase sync**: passwordless email sign-in (magic link). The whole workspace
  is one JSON row per user, pushed 1.5 seconds after edits stop and pulled when the window
  regains focus or comes back online. Images go to a storage bucket instead of the document.
- **Publishing**: off by default. A signed-in user can set a display name and tick
  **Publish my trees**; anyone, signed in or not, can then open them through **Browse**.
- **Read-only viewing** of another account is enforced by row-level security in the
  database, not by the client. While viewing, you can pan, zoom, switch tabs, open nodes
  and export, but not add, edit, move or delete.

## Getting started

### Prerequisites

- Node.js 20 or newer (`engines.node` is `>=20`) and npm.
- Optional: a Supabase project, only if you want sync and sharing.

### Download and install

```sh
git clone https://github.com/gabrielebolognese/Knowledge-Tree.git
cd Knowledge-Tree
npm install
```

### Configuration (optional)

With no configuration the app runs local-only and the sync and Browse controls stay hidden.
To enable sync:

1. Create a project at [supabase.com](https://supabase.com).
2. In its SQL editor, paste and run [`supabase/schema.sql`](supabase/schema.sql). It
   creates the `trees` and `profiles` tables, the `tree-images` storage bucket and their
   row-level security policies, and is safe to re-run.
3. Copy `.env.example` to `.env` and fill in both values from **Settings -> API**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. In **Authentication -> URL Configuration**, add the address you open the app on to the
   redirect allow-list, so the sign-in link can return to it.

Vite bakes `VITE_*` values into the bundle at build time, so `.env` must exist before
`npm run build`, and any change to it needs a rebuild. `.env` is gitignored.

### Run in development

```sh
npm run dev
```

Vite prints the local URL. Note that the project is normally checked against the
production build (`npm run build` then `npm run preview`) rather than the dev server.

## Build and deploy

```sh
npm run build     # typecheck, then production bundle into dist/
npm run preview   # serve the production build locally
```

The output in `dist/` is a static site (HTML, JS, CSS) and can be served by any static
host. The repository contains no deployment configuration or CI workflow, so hosting is up
to you. If you use sync, remember to add the hosted address to the Supabase redirect
allow-list.

## Usage

### npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server |
| `npm run build` | Runs `tsc` then `vite build`, writing to `dist/` |
| `npm run preview` | Serves the production build |
| `npm run typecheck` | Type-checks without emitting |
| `npm test` | Runs the Vitest suite once |
| `npm run test:watch` | Runs Vitest in watch mode |

### Controls

| Action | How |
| --- | --- |
| Switch subject | Click a tab |
| Pan | Drag empty space, or middle-drag; Shift + scroll pans sideways |
| Zoom | Scroll; `+` / `-` keys; the toolbar buttons |
| Frame everything | **Fit**, or press `0` |
| Open a node | Click it |
| Add to the main rail | **+ Main node** in the toolbar (**+ Word** in Spagnolo) |
| Grow the tree | Select a node, then click one of its `+` handles |
| Split out detail | Tick **Is a corollary** in the sidebar |
| Connect two nodes | Select one, Shift-click the other |
| Move a node | Drag it; it snaps to the grid |
| Select several | Hold Ctrl and drag a box; Ctrl-click adds or removes one |
| Move a group | Drag any selected node |
| Loose node | Double-click empty space |
| Delete | `Delete` or `Backspace` with nodes selected, or **Delete node** in the sidebar |
| Close the sidebar / lightbox | `Esc` |
| Back up / restore | **Export** / **Import** in the toolbar |

Straight down from a main-rail node stays on the main rail. Any diagonal starts a side
rail, and everything grown from a side rail stays on it. The **On the main rail** toggle
overrides this. A node is on the main rail, or a corollary, or neither, never both.

Dates are free text, so `1796`, `476 CE` and `c. 1200` all work.

### Sync and sharing

- Click **Sign in to sync**, enter your email and follow the link you receive. Signing in
  with the same address on another device shares one workspace.
- Conflicts resolve last-write-wins, with one guard: a device holding unpushed edits
  pushes them rather than being overwritten. Two devices edited while both were offline is
  not handled; the later one wins. Export is the backstop.
- Click **Browse** to list published accounts and open one read-only. A bar names whose
  trees you are reading, and **Back to mine** returns you.
- Publishing is all-or-nothing across every tab, so do not publish if one tab holds
  something private.

## Project structure

```
index.html           page shell, loads src/main.ts
supabase/schema.sql  tables, storage bucket and row-level security policies
src/
  main.ts            bootstrap: top nav, toolbar, shortcuts, wiring
  tabs.ts            the nine subjects and their profiles
  types.ts           node, tree, workspace and profile types
  config.ts          every tuned constant: spacing, sizes, limits, storage keys
  store.ts           all trees, mutations, persistence, import normalising
  layout.ts          pure grid/geometry maths, placement, text fitting
  canvas.ts          SVG rendering, pan/zoom, pointer interaction
  sidebar.ts         detail panel for the selected node
  bubbles.ts         force simulation for the word cloud
  mathnotation.ts    shorthand maths parser and layout
  media.ts           image downscaling
  supabase.ts        client setup from env; absent env means local-only
  sync.ts            auth, pull/push, image upload, publishing
  syncbar.ts         the sync control in the top nav
  browsebar.ts       the Browse control and publish switch
  seed.ts            the single node shown on a first visit
  styles.css         all styling
  *.test.ts          Vitest suites, named by feature
```

## Tech stack

- TypeScript 5 (strict, ESM), no UI framework; rendering is plain DOM and SVG
- Vite 6 for dev server and bundling
- Vitest 2 for tests
- `@supabase/supabase-js` 2 for optional auth, database sync and image storage
- Node.js 20+

## Further documentation

- [`CLAUDE.md`](CLAUDE.md) - architecture notes, conventions and gotchas for contributors
- [`supabase/schema.sql`](supabase/schema.sql) - the commented database schema and security policies
- [`.env.example`](.env.example) - the two environment variables and when they are read

## Status

A personal study tool in active development. The subject list is hard-coded to the
author's own subjects (with Italian labels) in `src/tabs.ts`. There is no hosted instance
referenced in the repository and no license file, so no license is granted by default.
