# knowledge tree

A minimal, endless canvas for a study journey. Each subject is a **tab** with its own
tree. Inside a tree, a **main rail** carries the timeline and **side rails** branch off
it diagonally so a corollary can be followed as deep as it deserves.

- Eight tabs across the top nav, all visible at once; the open one sits in a yellow box.
- The **title sits inside the circle**, wrapped to the circle's shape, 50 characters max.
- The **date sits outside**, to the left. Required on the main rail, optional on side rails.
- Main-rail circles are 20% larger — the main flow of knowledge reads at a glance.
- Corollaries are 20% smaller and sit 20% closer, for detail that would clutter a description.
- Yellow outlines, orange arrows, white text on dark grey.
- Click a node to open its description and images in the sidebar.
- The canvas has no edges: pan, zoom and grow each tree as far as you like.

It opens on **Storia**, holding a single main-rail node: **Napoleon**, dated 1796.
The other seven tabs start empty.

## Running it

```sh
npm install
npm run build    # typecheck + production bundle into dist/
npm run preview  # serves the production build, prints the local URL
npm test
```

`npm run dev` exists but this project is checked against the production build.

## Tabs

`Italiano · Storia · Matematica · Sistemi e reti · Database · Scienze politiche · Scacchi · Economia · Spagnolo`

**Spagnolo is not a tree.** It is a cloud of unconnected entries: type the Spanish
word or phrase and what it means in English, and that is the whole node. No
rails, no arrows, no grid. Each bubble is pulled toward the middle at its own
strength and shoved apart by its neighbours, so the pack settles uneven and a
little untidy on purpose. Positions are not stored — they are recomputed from the
word id, so the same words always land the same way.

There is no length limit, so whole phrases work. A bubble grows with what is in
it, but logarithmically: ten more characters is worth ~15px on a two-character
word and ~0.6px on a 250-character one, flattening out at a 108px radius. Past
that the type shrinks instead, down to 9px, and only then is anything cut.

Tabs share nothing: separate nodes, separate arrows, separate main rail. Switching
keeps each tab's pan and zoom for the session, so you come back where you left off.
The tab list lives in `src/tabs.ts` — that one array is the only place to change it.

## Using it

| Action | How |
| --- | --- |
| Switch subject | Click a tab |
| Pan | Drag empty space (or middle-drag) |
| Zoom | Scroll; `+` / `-`; the toolbar buttons |
| Frame everything | `Fit`, or press `0` |
| Open a node | Click it |
| Grow the tree | Select a node, then click one of its three `+` handles: straight down continues the rail, a diagonal starts a side rail |
| Split out detail | Tick **Is a corollary** in the sidebar |
| Connect two nodes | Select one, shift-click the other |
| Move a node | Drag it — it snaps to the grid |
| Select several | Hold **Ctrl** and drag a box over them; Ctrl-click adds or removes one |
| Move them together | Drag any selected node — the whole group follows |
| Loose node | Double-click empty space |
| Delete | `Delete` with a node selected, or the sidebar button |
| Close the sidebar | `Esc` |

Straight down from a main-rail node stays on the main rail. Any diagonal starts a side
rail, and everything grown from a side rail stays on that side rail. The sidebar's
**On the main rail** toggle overrides this if you reshape the timeline later.

### Corollaries

When a description is getting messy, split the detail out into a corollary: tick
**Is a corollary** in the sidebar. The circle shrinks by 20% and moves 20% closer to
its parent, which is what makes its arrow shorter — so a run of corollaries reads as a
tight sub-list rather than more of the timeline.

A corollary only grows downward, so it shows a single `+` handle, and anything grown
from it is a corollary too. Ticking the box also brings whatever already hangs below
along, keeping that sub-tree's spacing. A node is on the main rail, or a corollary, or
neither — never both, and the two checkboxes disable each other accordingly.

### Making room

The direction you pick is honoured exactly — down always means down. If the cell is
already taken, the branch sitting there slides sideways as one piece, far enough to
clear everything, so the arrow feeding it simply gets longer. Nested children move
with it and keep their shape.

The main rail never moves: it is the spine, so branches give way to it rather than the
other way round. In the rare case where the rail itself is holding the cell, the new
node steps aside instead. Nothing is pulled back in automatically when space frees up —
drag a node if you want to tidy up.

### Dates

Free text, so `1796`, `476 CE` and `c. 1200` all work. A main-rail node with no date
shows *date needed* in red where the date belongs, and the toolbar keeps a running
count for the open tab — click it to jump to the first one. Side-rail dates are
optional and show in grey.

## Sync across devices

Sync is optional. With no credentials the app runs exactly as before, entirely in
one browser, and the sync control stays hidden.

Setup, once:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from **Settings → API**.
4. In **Authentication → URL Configuration**, add the address you open the app on
   (e.g. `http://localhost:4173`) to the redirect allow-list.
5. `npm run build` — Vite bakes `VITE_*` values in at build time, so this must come
   after step 3, and again after any change to `.env`.

Then click **Sign in to sync** in the top nav and enter your email. You get a
sign-in link by email, no password. Sign in on each device with the same address
and they share one workspace.

### How it syncs

The whole workspace is one JSON document in one row (`public.trees`, keyed by your
user id, guarded by row-level security). It pushes 1.5s after you stop editing and
pulls whenever the tab regains focus — exactly when another device may have moved
ahead. Images go to a `tree-images` storage bucket rather than into the document,
so the JSON stays small.

Conflicts resolve last-write-wins, with one guard: a device holding unpushed edits
pushes them rather than being overwritten. Two devices edited while **both** were
offline is the case this does not handle — the later one wins. Export is the backstop.

The anon key is designed to ship in the browser; row-level security is what actually
protects the data. `.env` is gitignored regardless.

## Viewing other people

Click **Browse** in the top nav to see who has published, and open their trees
read-only. This needs no account at all: a signed-out guest sees exactly what a
signed-in visitor sees. A yellow bar names whose trees you are reading, and
**Back to mine** returns you.

You can still pan, zoom, switch subjects, open nodes and Export a copy. You cannot
add, edit, move or delete anything.

### Publishing your own

Off by default. In **Browse**, give yourself a display name and tick **Publish my
trees**. Until you do, nothing of yours is visible to anyone.

Read-only is enforced by the database, not by hiding buttons: the write policy on
`trees` stays `auth.uid() = owner`, so a visitor physically cannot change your
nodes whatever they do to the client. Publishing only adds a *read* policy.

Publishing is all-or-nothing across all eight subjects, so do not publish if one of
your tabs holds something private.

## Data and durability

Three layers, deliberately:

| Layer | Role |
| --- | --- |
| Supabase | sync between devices |
| `localStorage` (`knowledge-tree:v3`) | offline cache, instant startup |
| **Export** | the copy you own |

Use Export. A free hosted tier is not an archive: Supabase pauses free projects
after about a week of inactivity, and long-dormant ones can be removed. The export
writes every tab to `knowledge-tree.json`, which Import reads back; a single-tree
file (an export from before tabs) imports into whichever tab is open. Keep one in a
folder that is itself backed up.

## Layout

```
src/
  main.ts      bootstrap: top nav, toolbar, shortcuts, wiring
  tabs.ts      the eight subjects and their ids
  canvas.ts    SVG rendering, pan/zoom, pointer interaction
  sidebar.ts   detail panel (date, title, description, images, connections)
  store.ts     every tab's tree, mutations, persistence, import normalising
  layout.ts    pure grid/geometry maths, incl. fitting a title inside a circle (tested)
  sync.ts      Supabase auth, pull/push, image upload, publishing
  browsebar.ts the Browse control: published accounts and your publish switch
  supabase.ts  client setup from env; absent env means local-only
  syncbar.ts   the sync control in the top nav
  media.ts     image downscaling to a blob
  seed.ts      the single node shown on a first visit
  config.ts    spacing, sizes, limits
```
