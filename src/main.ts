import "./styles.css";

import { TreeCanvas } from "./canvas.js";
import { Sidebar } from "./sidebar.js";
import { blobToDataUrl } from "./media.js";
import { BrowseBar } from "./browsebar.js";
import { Store } from "./store.js";
import { Sync } from "./sync.js";
import { SyncBar } from "./syncbar.js";
import { TABS, labelFor } from "./tabs.js";
import type { NodeId, TabId, Viewport } from "./types.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = el("button", "kt-btn", label);
  btn.type = "button";
  btn.title = title;
  btn.addEventListener("click", onClick);
  return btn;
}

function boot(): void {
  const app = document.getElementById("app");
  if (!app) throw new Error("#app is missing from the page");

  const store = new Store();

  const topbar = el("header", "kt-topbar");
  const workspace = el("main", "kt-workspace");
  app.append(topbar, workspace);

  const stage = el("div", "kt-canvas");
  workspace.append(stage);

  let statusTimer: number | null = null;
  const status = el("div", "kt-status");
  status.hidden = true;

  function say(message: string): void {
    status.textContent = message;
    status.hidden = false;
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      status.hidden = true;
    }, 2800);
  }

  const zoomReadout = el("span", "kt-zoom-readout", "100%");

  // Only shown while several nodes are picked; clicking it lets them go.
  const selectionChip = el("button", "kt-chip");
  selectionChip.type = "button";
  selectionChip.title = "Clear the selection";
  selectionChip.hidden = true;
  selectionChip.addEventListener("click", () => canvas.setSelection([]));

  const canvas = new TreeCanvas(stage, store, {
    onSelect: (id) => {
      sidebar.setNode(id);
      // A node with no title yet is one you just made, so put the caret in it.
      const node = store.node(id);
      if (node && !node.title) sidebar.focusTitle();
    },
    onSelectionChange: (ids) => {
      selectionChip.hidden = ids.length < 2;
      selectionChip.textContent = `${ids.length} selected`;
    },
    onStatus: say,
    onViewport: (viewport) => {
      zoomReadout.textContent = `${Math.round(viewport.scale * 100)}%`;
    },
  });

  const sync = new Sync(store, (state) => syncBar.update(state));

  /** Signed in: the image goes to storage. Otherwise it stays in this browser. */
  async function storeImage(blob: Blob): Promise<string> {
    const uploaded = await sync.uploadImage(blob);
    return uploaded ?? (await blobToDataUrl(blob));
  }

  const sidebar = new Sidebar(workspace, store, {
    uploadImage: storeImage,
    onFocusNode: (id: NodeId) => {
      canvas.setSelected(id);
      canvas.focus(id);
    },
    onStatus: say,
    onDismiss: () => canvas.setSelected(null),
  });

  // --- tabs -----------------------------------------------------------------

  /** Where each tab was left, so switching back does not lose your place. */
  const viewports = new Map<TabId, Viewport>();
  const tabButtons = new Map<TabId, HTMLButtonElement>();

  function switchTab(id: TabId): void {
    const current = store.getActiveTab();
    if (id === current) return;

    viewports.set(current, { ...canvas.getViewport() });
    canvas.setSelected(null);
    store.setActiveTab(id);

    const saved = viewports.get(id);
    if (saved) canvas.setViewport(saved);
    else canvas.fit();
  }

  const tabNav = el("nav", "kt-tabs");
  tabNav.setAttribute("aria-label", "Subjects");
  for (const tab of TABS) {
    const btn = el("button", "kt-tab", tab.label);
    btn.type = "button";
    btn.addEventListener("click", () => switchTab(tab.id));
    tabButtons.set(tab.id, btn);
    tabNav.append(btn);
  }

  const brand = el("div", "kt-brand");
  brand.append(el("h1", undefined, "knowledge tree"));
  topbar.append(brand, tabNav);

  // Sits across the top of the canvas so there is no doubt whose trees these are.
  const viewBar = el("div", "kt-viewbar");
  viewBar.hidden = true;
  const viewLabel = el("span");
  const exitView = button("Back to mine", "Return to your own trees", () => {
    store.stopViewing();
    canvas.setSelection([]);
    canvas.fit();
    say("Back to your own trees.");
  });
  viewBar.append(viewLabel, exitView);
  workspace.append(viewBar);

  const browseBar = new BrowseBar(topbar, sync, {
    onOpen: (account) => {
      void (async () => {
        say(`Loading ${account.name}\u2026`);
        const raw = await sync.fetchWorkspace(account.owner);
        if (raw === null) {
          say("Those trees are not available \u2014 they may have been unpublished.");
          return;
        }
        if (!store.viewAccount({ owner: account.owner, name: account.name }, raw)) {
          say("Could not read those trees.");
          return;
        }
        canvas.setSelection([]);
        canvas.fit();
      })();
    },
    onStatus: say,
  });

  const syncBar = new SyncBar(topbar, sync);

  // --- toolbar --------------------------------------------------------------

  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = "application/json";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    void file.text().then((raw) => {
      const error = store.fromJSON(raw);
      if (error) {
        say(error);
        return;
      }
      viewports.clear();
      canvas.setSelected(null);
      canvas.fit();
      say("Imported.");
    });
  });

  function exportTrees(): void {
    const blob = new Blob([store.toJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = "knowledge-tree.json";
    link.click();
    URL.revokeObjectURL(url);
    say("Exported every tab to knowledge-tree.json");
  }

  function addMainNode(): void {
    const id = store.addMainNode();
    canvas.setSelected(id);
    canvas.focus(id);
    sidebar.focusTitle();
  }

  const emptyState = el("div", "kt-empty-state");
  const emptyText = el("p");
  const startBtn = button("Plant the first node", "Start the main rail", addMainNode);
  startBtn.classList.add("is-primary");
  emptyState.append(emptyText, startBtn);

  // The date is mandatory on the main rail, so keep the outstanding count visible.
  const dateWarning = el("button", "kt-warning");
  dateWarning.type = "button";
  dateWarning.title = "Main-rail nodes need a date — jump to the first one missing it";
  dateWarning.hidden = true;
  dateWarning.addEventListener("click", () => {
    const first = store.missingDates()[0];
    if (!first) return;
    canvas.setSelected(first.id);
    canvas.focus(first.id);
  });

  const addNodeBtn = button("+ Main node", "Extend the main rail", addMainNode);
  const importBtn = button("Import", "Load trees from JSON", () => fileInput.click());
  const editControls: HTMLButtonElement[] = [addNodeBtn, importBtn, startBtn];

  const tools = el("div", "kt-tools");
  tools.append(
    button("−", "Zoom out", () => canvas.zoomBy(1 / 1.25)),
    zoomReadout,
    button("+", "Zoom in", () => canvas.zoomBy(1.25)),
    el("span", "kt-divider"),
    selectionChip,
    dateWarning,
    button("Fit", "Frame the whole tree (0)", () => canvas.fit()),
    addNodeBtn,
    el("span", "kt-divider"),
    button("Export", "Download every tab as JSON", exportTrees),
    importBtn,
    fileInput,
  );

  const hints = el("div", "kt-hints");
  hints.append(
    el("span", undefined, "drag to pan"),
    el("span", undefined, "scroll to zoom"),
    el("span", undefined, "click a node to open it"),
    el("span", undefined, "+ handles to grow"),
    el("span", undefined, "shift-click to connect"),
    el("span", undefined, "ctrl-drag to select several"),
    el("span", undefined, "double-click empty space for a loose node"),
  );



  workspace.append(tools, hints, status, emptyState);

  // --- wiring ---------------------------------------------------------------

  function syncChrome(): void {
    const viewing = store.viewing();
    const readOnly = store.isReadOnly();

    viewBar.hidden = viewing === null;
    if (viewing) viewLabel.replaceChildren(document.createTextNode(`Viewing ${viewing.name} \u2014 read only`));

    // Everything that writes is out of reach while reading someone else's.
    for (const control of editControls) control.disabled = readOnly;
    emptyState.classList.toggle("is-readonly", readOnly);

    const active = store.getActiveTab();
    for (const [id, btn] of tabButtons) {
      const isActive = id === active;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-current", isActive ? "page" : "false");
    }

    emptyState.hidden = store.get().nodes.length > 0;
    emptyText.textContent = viewing
      ? `${viewing.name} has nothing in ${labelFor(active)}.`
      : `Nothing in ${labelFor(active)} yet.`;
    startBtn.hidden = readOnly;

    const missing = store.missingDates().length;
    dateWarning.hidden = missing === 0;
    dateWarning.textContent = missing === 1 ? "1 date missing" : `${missing} dates missing`;

    const error = store.getSaveError();
    if (error) say(error);
  }

  store.subscribe(() => {
    canvas.render();
    sidebar.refresh();
    syncChrome();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (sidebar.isLightboxOpen()) {
        sidebar.closeLightbox();
        return;
      }
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      canvas.setSelected(null);
      return;
    }

    // Everything below is a bare shortcut, so it must not fire while typing.
    if (sidebar.hasFocus()) return;

    const selected = canvas.getSelection();
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selected.length > 0 &&
      !store.isReadOnly()
    ) {
      event.preventDefault();
      for (const id of selected) store.removeNode(id);
      canvas.setSelection([]);
      say(selected.length === 1 ? "Node deleted." : `${selected.length} nodes deleted.`);
      return;
    }

    if (event.key === "+" || event.key === "=") {
      canvas.zoomBy(1.25);
    } else if (event.key === "-" || event.key === "_") {
      canvas.zoomBy(1 / 1.25);
    } else if (event.key === "0") {
      canvas.fit();
    }
  });

  canvas.render();
  canvas.fit();
  syncChrome();
  sync.start();
  void browseBar.refresh();
}

boot();
