import {
  CARD_CORNER,
  CARD_H,
  CARD_PADDING,
  CARD_W,
  DATE_GAP,
  IMPORTANT_CORNER,
  IMPORTANT_H,
  MAX_SCALE,
  MIN_SCALE,
} from "./config.js";
import {
  cellToWorld,
  contentBounds,
  nodesWithin,
  edgeGeometry,
  exitDistance,
  fitBoxTitle,
  fitCardText,
  fitTitle,
  isCard,
  isImportant,
  shapeOf,
  snapRow,
  worldToCell,
  type FittedCard,
  type NodeShape,
} from "./layout.js";
import { layoutMath } from "./mathnotation.js";
import type { Store } from "./store.js";
import type { Cell, Direction, NodeId, Point, TabProfile, TreeNode, Viewport } from "./types.js";

const SVG_NS = "http://www.w3.org/2000/svg";

interface HandleSpec {
  dir: Direction;
  dx: number;
  dy: number;
  label: string;
}

/** The three growth handles shown around a selected node. */
const HANDLES: readonly HandleSpec[] = [
  { dir: "down-left", dx: -0.72, dy: 0.72, label: "Branch down-left" },
  { dir: "down", dx: 0, dy: 1, label: "Continue down" },
  { dir: "down-right", dx: 0.72, dy: 0.72, label: "Branch down-right" },
];

const HANDLE_DIST = 18;
const HANDLE_R = 10;
/** Below this zoom the text is just noise, so it is hidden. */
const TEXT_HIDE_SCALE = 0.3;

export interface CanvasCallbacks {
  onSelect: (id: NodeId | null) => void;
  /** Fires whenever the set of selected nodes changes. */
  onSelectionChange: (ids: readonly NodeId[]) => void;
  onStatus: (message: string) => void;
  onViewport: (viewport: Viewport) => void;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

export class TreeCanvas {
  private readonly root: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly edgeLayer: SVGGElement;
  private readonly nodeLayer: SVGGElement;
  private readonly marqueeLayer: SVGGElement;

  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private readonly selection = new Set<NodeId>();

  /** Ctrl-drag box, in world units. */
  private marquee: { id: number; fromX: number; fromY: number; toX: number; toY: number } | null =
    null;

  private pan: { id: number; startX: number; startY: number; ox: number; oy: number } | null = null;
  private drag: {
    id: number;
    node: NodeId;
    moved: boolean;
    startX: number;
    startY: number;
    grabX: number;
    grabY: number;
    /** Set when a whole group is moving: where each node started. */
    origins: Map<NodeId, Cell> | null;
  } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: Store,
    private readonly callbacks: CanvasCallbacks,
  ) {
    this.root = svg("svg");
    this.root.setAttribute("class", "kt-stage");
    this.root.append(this.buildDefs());

    this.world = svg("g");
    this.edgeLayer = svg("g");
    this.nodeLayer = svg("g");
    this.marqueeLayer = svg("g");
    this.world.append(this.edgeLayer, this.nodeLayer, this.marqueeLayer);
    this.root.append(this.world);
    this.container.append(this.root);

    this.attachEvents();
    this.applyViewport();
  }

  private buildDefs(): SVGDefsElement {
    const defs = svg("defs");
    const marker = svg("marker");
    marker.setAttribute("id", "kt-arrowhead");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "12");
    marker.setAttribute("markerHeight", "12");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    marker.setAttribute("orient", "auto");

    const head = svg("path");
    head.setAttribute("d", "M 0.5 1 L 9 5 L 0.5 9 Z");
    head.setAttribute("class", "kt-arrowhead");
    marker.append(head);
    defs.append(marker);
    return defs;
  }

  // --- viewport -------------------------------------------------------------

  private applyViewport(): void {
    const { x, y, scale } = this.viewport;
    this.world.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
    this.root.classList.toggle("zoom-far", scale < TEXT_HIDE_SCALE);

    let grid = 75 * scale;
    while (grid < 18) grid *= 4;
    while (grid > 130) grid /= 4;
    this.container.style.backgroundSize = `${grid}px ${grid}px`;
    this.container.style.backgroundPosition = `${x}px ${y}px`;

    this.callbacks.onViewport(this.viewport);
  }

  getViewport(): Readonly<Viewport> {
    return this.viewport;
  }

  private screenToWorld(clientX: number, clientY: number): Point {
    const rect = this.root.getBoundingClientRect();
    const { x, y, scale } = this.viewport;
    return { x: (clientX - rect.left - x) / scale, y: (clientY - rect.top - y) / scale };
  }

  /** Zooms about a screen point, keeping the world point under it fixed. */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = this.root.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.viewport.scale * factor));
    const ratio = next / this.viewport.scale;

    this.viewport = {
      scale: next,
      x: sx - (sx - this.viewport.x) * ratio,
      y: sy - (sy - this.viewport.y) * ratio,
    };
    this.applyViewport();
  }

  /** Zooms about the centre of the stage. */
  zoomBy(factor: number): void {
    const rect = this.root.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  setViewport(viewport: Viewport): void {
    this.viewport = { ...viewport };
    this.applyViewport();
  }

  panBy(dx: number, dy: number): void {
    this.viewport = { ...this.viewport, x: this.viewport.x + dx, y: this.viewport.y + dy };
    this.applyViewport();
  }

  /** Frames the whole tree. */
  fit(): void {
    const bounds = contentBounds(this.store.get().nodes, this.store.profile());
    const rect = this.root.getBoundingClientRect();
    if (!bounds || rect.width === 0) {
      this.viewport = { x: rect.width / 2, y: rect.height / 3, scale: 1 };
      this.applyViewport();
      return;
    }

    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(rect.width / w, rect.height / h, 1.4)),
    );
    this.viewport = {
      scale,
      x: rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      y: rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    };
    this.applyViewport();
  }

  /** Centres one node without changing the zoom level. */
  focus(id: NodeId): void {
    const node = this.store.node(id);
    if (!node) return;
    const rect = this.root.getBoundingClientRect();
    const { x, y } = cellToWorld(node);
    this.viewport = {
      ...this.viewport,
      x: rect.width / 2 - x * this.viewport.scale,
      y: rect.height / 2 - y * this.viewport.scale,
    };
    this.applyViewport();
  }

  // --- selection ------------------------------------------------------------

  /** The one selected node, or null when none or several are. */
  getSelected(): NodeId | null {
    if (this.selection.size !== 1) return null;
    for (const id of this.selection) return id;
    return null;
  }

  getSelection(): NodeId[] {
    return [...this.selection];
  }

  setSelected(id: NodeId | null): void {
    this.setSelection(id === null ? [] : [id]);
  }

  /** Replaces the selection wholesale. */
  setSelection(ids: readonly NodeId[]): void {
    const next = new Set(ids);
    if (next.size === this.selection.size && [...next].every((id) => this.selection.has(id))) {
      return;
    }

    this.selection.clear();
    for (const id of next) this.selection.add(id);
    this.render();

    // The sidebar only ever shows one node, so a group closes it.
    this.callbacks.onSelect(this.getSelected());
    this.callbacks.onSelectionChange(this.getSelection());
  }

  private toggleSelected(id: NodeId): void {
    const next = new Set(this.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.setSelection([...next]);
  }

  // --- rendering ------------------------------------------------------------

  render(): void {
    const { nodes, edges } = this.store.get();
    const profile = this.store.profile();
    const byId = new Map<NodeId, TreeNode>(nodes.map((n) => [n.id, n]));

    const edgeFrag = document.createDocumentFragment();
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;

      const geom = edgeGeometry(
        cellToWorld(from),
        cellToWorld(to),
        shapeOf(from, profile),
        shapeOf(to, profile),
      );
      if (!geom) continue;

      const line = svg("line");
      line.setAttribute("class", "kt-edge");
      line.setAttribute("x1", String(geom.x1));
      line.setAttribute("y1", String(geom.y1));
      line.setAttribute("x2", String(geom.x2));
      line.setAttribute("y2", String(geom.y2));
      line.setAttribute("marker-end", "url(#kt-arrowhead)");
      edgeFrag.append(line);
    }
    this.edgeLayer.replaceChildren(edgeFrag);

    const nodeFrag = document.createDocumentFragment();
    for (const node of nodes) nodeFrag.append(this.renderNode(node, profile));
    this.nodeLayer.replaceChildren(nodeFrag);
  }

  private renderNode(node: TreeNode, profile: TabProfile): SVGGElement {
    const group = svg("g");
    const isSelected = this.selection.has(node.id);
    const card = isCard(node, profile);

    const important = isImportant(node, profile);
    const classes = ["kt-node"];
    if (node.main) classes.push("is-main");
    if (node.corollary) classes.push("is-corollary");
    if (card) classes.push("is-card");
    if (important) classes.push("is-important");
    if (isSelected) classes.push("is-selected");
    group.setAttribute("class", classes.join(" "));
    group.dataset["id"] = node.id;

    const { x, y } = cellToWorld(node);
    group.setAttribute("transform", `translate(${x} ${y})`);

    const shape = shapeOf(node, profile);
    if (card) this.paintCard(group, node);
    else if (important) this.paintImportant(group, node, shape);
    else this.paintCircle(group, node, shape);

    this.paintMarkers(group, node, profile, shape);

    // Only a timeline needs dates; every other subject leaves them out entirely.
    if (profile.dates) {
      const date = this.renderDate(node, shape);
      if (date) group.append(date);
    }

    // Handles belong to a single node; a whole group of them would be noise.
    // They are also an editing affordance, so they go away in view mode.
    if (isSelected && this.selection.size === 1 && !this.store.isReadOnly()) {
      // A corollary is a sub-point: it only ever continues downward.
      const handles = node.corollary ? HANDLES.filter((h) => h.dir === "down") : HANDLES;
      for (const handle of handles) group.append(this.renderHandle(handle, shape));
    }
    return group;
  }

  private paintCircle(group: SVGGElement, node: TreeNode, shape: NodeShape): void {
    const radius = shape.kind === "circle" ? shape.radius : 0;

    const circle = svg("circle");
    circle.setAttribute("class", "kt-circle");
    circle.setAttribute("r", String(radius));
    group.append(circle);

    const fitted = fitTitle(node.title || "Untitled", radius);
    const text = svg("text");
    text.setAttribute("class", node.title ? "kt-title" : "kt-title is-empty");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", String(fitted.fontSize));

    fitted.lines.forEach((line, i) => {
      const tspan = svg("tspan");
      tspan.setAttribute("x", "0");
      tspan.setAttribute("y", String(fitted.firstBaseline + i * fitted.lineHeight));
      tspan.textContent = line;
      text.append(tspan);
    });
    group.append(text);
  }

  /**
   * An important side node: the same title, squared off so it stands out from
   * the circles around it. Sized like the circle it replaces, not like a card.
   */
  private paintImportant(group: SVGGElement, node: TreeNode, shape: NodeShape): void {
    if (shape.kind !== "rect") return;

    const scale = shape.halfHeight / (IMPORTANT_H / 2);
    const rect = svg("rect");
    rect.setAttribute("class", "kt-important");
    rect.setAttribute("x", String(-shape.halfWidth));
    rect.setAttribute("y", String(-shape.halfHeight));
    rect.setAttribute("width", String(shape.halfWidth * 2));
    rect.setAttribute("height", String(shape.halfHeight * 2));
    rect.setAttribute("rx", String(IMPORTANT_CORNER * scale));
    group.append(rect);

    const fitted = fitBoxTitle(node.title || "Untitled", shape.halfWidth, shape.halfHeight);
    const text = svg("text");
    text.setAttribute("class", node.title ? "kt-title" : "kt-title is-empty");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", String(fitted.fontSize));
    fitted.lines.forEach((line, i) => {
      const tspan = svg("tspan");
      tspan.setAttribute("x", "0");
      tspan.setAttribute("y", String(fitted.firstBaseline + i * fitted.lineHeight));
      tspan.textContent = line;
      text.append(tspan);
    });
    group.append(text);
  }

  /**
   * A main-rail card: the rule itself, with as much of the explanation as fits
   * beneath it. Used where the rail carries rules rather than dated events.
   */
  private paintCard(group: SVGGElement, node: TreeNode): void {
    const rect = svg("rect");
    rect.setAttribute("class", "kt-card");
    rect.setAttribute("x", String(-CARD_W / 2));
    rect.setAttribute("y", String(-CARD_H / 2));
    rect.setAttribute("width", String(CARD_W));
    rect.setAttribute("height", String(CARD_H));
    rect.setAttribute("rx", String(CARD_CORNER));
    group.append(rect);

    const fitted = fitCardText(node.title || "Untitled rule", node.description, node.examples);
    const left = -CARD_W / 2 + CARD_PADDING;

    const title = svg("text");
    title.setAttribute("class", node.title ? "kt-card-title" : "kt-card-title is-empty");
    title.setAttribute("text-anchor", "start");
    title.setAttribute("font-size", String(fitted.titleFontSize));
    fitted.titleLines.forEach((line, i) => {
      const tspan = svg("tspan");
      tspan.setAttribute("x", String(left));
      tspan.setAttribute("y", String(fitted.firstBaseline + i * fitted.titleLineHeight));
      tspan.textContent = line;
      title.append(tspan);
    });
    group.append(title);

    if (fitted.descriptionLines.length > 0 && fitted.descriptionBaseline !== null) {
      const base = fitted.descriptionBaseline;
      const desc = svg("text");
      desc.setAttribute("class", "kt-card-desc");
      desc.setAttribute("text-anchor", "start");
      desc.setAttribute("font-size", String(fitted.descriptionFontSize));
      fitted.descriptionLines.forEach((line, i) => {
        const tspan = svg("tspan");
        tspan.setAttribute("x", String(left));
        tspan.setAttribute("y", String(base + i * fitted.descriptionLineHeight));
        tspan.textContent = line;
        desc.append(tspan);
      });
      group.append(desc);
    }

    this.paintExamples(group, fitted, left);
  }

  /**
   * Worked examples, set as real notation: `sqrt(x^2+1)` comes out as a root
   * with the square properly raised. Parsing happens in mathnotation.ts; this
   * only places what it produced.
   */
  private paintExamples(group: SVGGElement, fitted: FittedCard, left: number): void {
    if (fitted.exampleLines.length === 0 || fitted.exampleBaseline === null) return;

    if (fitted.dividerY !== null) {
      const rule = svg("line");
      rule.setAttribute("class", "kt-card-rule");
      rule.setAttribute("x1", String(left));
      rule.setAttribute("x2", String(-left));
      rule.setAttribute("y1", String(fitted.dividerY));
      rule.setAttribute("y2", String(fitted.dividerY));
      group.append(rule);
    }

    fitted.exampleLines.forEach((box, i) => {
      const baseline = (fitted.exampleBaseline ?? 0) + i * fitted.exampleLineHeight;
      for (const glyph of layoutMath(box, fitted.exampleFontSize, left, baseline)) {
        if (glyph.kind === "text") {
          const text = svg("text");
          text.setAttribute("class", "kt-card-example");
          text.setAttribute("text-anchor", "start");
          text.setAttribute("x", String(glyph.x));
          text.setAttribute("y", String(glyph.y));
          text.setAttribute("font-size", String(glyph.fontSize));
          text.textContent = glyph.text;
          group.append(text);
          continue;
        }

        // The bar over a root.
        const bar = svg("line");
        bar.setAttribute("class", "kt-card-radical");
        bar.setAttribute("x1", String(glyph.x1));
        bar.setAttribute("x2", String(glyph.x2));
        bar.setAttribute("y1", String(glyph.y));
        bar.setAttribute("y2", String(glyph.y));
        bar.setAttribute("stroke-width", String(glyph.thickness));
        group.append(bar);
      }
    });

    if (fitted.moreExamples) {
      const more = svg("text");
      more.setAttribute("class", "kt-card-more");
      more.setAttribute("text-anchor", "end");
      more.setAttribute("x", String(-left));
      more.setAttribute(
        "y",
        String((fitted.exampleBaseline ?? 0) + (fitted.exampleLines.length - 1) * fitted.exampleLineHeight),
      );
      more.textContent = "\u2026";
      group.append(more);
    }
  }

  /** Small dots saying there is more inside: images, and worked examples. */
  private paintMarkers(
    group: SVGGElement,
    node: TreeNode,
    profile: TabProfile,
    shape: NodeShape,
  ): void {
    const dots: string[] = [];
    if (node.images.length > 0) dots.push("kt-media-dot");
    if (profile.examples && node.examples.trim() !== "") dots.push("kt-example-dot");

    dots.forEach((className, i) => {
      const dot = svg("circle");
      dot.setAttribute("class", className);
      dot.setAttribute("r", "4");

      if (shape.kind === "rect") {
        dot.setAttribute("cx", String(shape.halfWidth - 14 - i * 12));
        dot.setAttribute("cy", String(-shape.halfHeight + 14));
      } else {
        const out = shape.radius + 9;
        dot.setAttribute("cx", String(out * 0.71 + i * 11));
        dot.setAttribute("cy", String(-out * 0.71 + i * 4));
      }
      group.append(dot);
    });
  }

  /**
   * The date, outside the node to its left. Main-rail nodes always show it,
   * flagging the gap when it has not been filled in yet.
   */
  private renderDate(node: TreeNode, shape: NodeShape): SVGTextElement | null {
    const value = node.date.trim();
    const missing = node.main && value === "";
    if (!value && !missing) return null;

    const offset = exitDistance(shape, -1, 0) + DATE_GAP;
    const text = svg("text");
    text.setAttribute("class", missing ? "kt-date is-missing" : "kt-date");
    text.setAttribute("text-anchor", "end");
    text.setAttribute("x", String(-offset));
    text.setAttribute("y", "0");
    text.setAttribute("dy", "0.34em");
    text.textContent = missing ? "date needed" : value;
    return text;
  }

  private renderHandle(handle: HandleSpec, shape: NodeShape): SVGGElement {
    // Follow the outline, so handles hug a card the same way they hug a circle.
    const length = Math.hypot(handle.dx, handle.dy) || 1;
    const ux = handle.dx / length;
    const uy = handle.dy / length;
    const dist = exitDistance(shape, ux, uy) + HANDLE_DIST;

    const group = svg("g");
    group.setAttribute("class", "kt-handle");
    group.setAttribute("transform", `translate(${ux * dist} ${uy * dist})`);
    group.dataset["dir"] = handle.dir;

    const disc = svg("circle");
    disc.setAttribute("r", String(HANDLE_R));
    disc.setAttribute("class", "kt-handle-disc");
    group.append(disc);

    const plus = svg("path");
    plus.setAttribute("d", "M -4.5 0 H 4.5 M 0 -4.5 V 4.5");
    plus.setAttribute("class", "kt-handle-plus");
    group.append(plus);

    const tip = svg("title");
    tip.textContent = handle.label;
    group.append(tip);
    return group;
  }

  // --- interaction ----------------------------------------------------------

  private attachEvents(): void {
    this.root.addEventListener("wheel", this.onWheel, { passive: false });
    this.root.addEventListener("pointerdown", this.onPointerDown);
    this.root.addEventListener("pointermove", this.onPointerMove);
    this.root.addEventListener("pointerup", this.onPointerUp);
    this.root.addEventListener("pointercancel", this.onPointerUp);
    this.root.addEventListener("dblclick", this.onDoubleClick);
    this.root.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;

    if (event.shiftKey && !event.ctrlKey) {
      this.panBy(-event.deltaY * unit, 0);
      return;
    }
    const intensity = event.ctrlKey ? 0.01 : 0.0022;
    this.zoomAt(Math.exp(-event.deltaY * unit * intensity), event.clientX, event.clientY);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const target = event.target as Element;

    const sole = this.getSelected();

    const handleEl = target.closest(".kt-handle");
    if (handleEl instanceof SVGElement && sole && !this.store.isReadOnly()) {
      event.preventDefault();
      const dir = handleEl.dataset["dir"] as Direction | undefined;
      if (!dir) return;
      const created = this.store.addChild(sole, dir);
      if (created) this.setSelected(created);
      return;
    }

    const nodeEl = target.closest(".kt-node");
    if (nodeEl instanceof SVGElement && event.button === 0) {
      const id = nodeEl.dataset["id"];
      if (!id) return;
      event.preventDefault();

      // Ctrl on a node adds it to, or takes it out of, the selection.
      if (event.ctrlKey || event.metaKey) {
        this.toggleSelected(id);
        return;
      }

      if (event.shiftKey && sole && sole !== id && !this.store.isReadOnly()) {
        const linked = this.store.connect(sole, id);
        this.callbacks.onStatus(linked ? "Arrow drawn." : "Those two are already connected.");
        return;
      }

      const node = this.store.node(id);
      if (!node) return;
      const pointer = this.screenToWorld(event.clientX, event.clientY);
      const centre = cellToWorld(node);

      // Nothing is draggable in view mode, but selecting still is.
      if (this.store.isReadOnly()) {
        this.setSelected(id);
        return;
      }

      // Dragging any member of a group takes the whole group with it.
      const asGroup = this.selection.size > 1 && this.selection.has(id);
      const origins = asGroup ? new Map<NodeId, Cell>() : null;
      if (origins) {
        for (const member of this.selection) {
          const found = this.store.node(member);
          if (found) origins.set(member, { col: found.col, row: found.row });
        }
      }

      this.drag = {
        id: event.pointerId,
        node: id,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        grabX: pointer.x - centre.x,
        grabY: pointer.y - centre.y,
        origins,
      };
      this.root.setPointerCapture(event.pointerId);
      return;
    }

    // Ctrl on empty space draws a selection box instead of panning.
    if (event.button === 0 && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      const world = this.screenToWorld(event.clientX, event.clientY);
      this.marquee = {
        id: event.pointerId,
        fromX: world.x,
        fromY: world.y,
        toX: world.x,
        toY: world.y,
      };
      this.root.setPointerCapture(event.pointerId);
      this.container.classList.add("is-selecting");
      this.drawMarquee();
      return;
    }

    if (event.button === 0 || event.button === 1) {
      event.preventDefault();
      this.pan = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        ox: this.viewport.x,
        oy: this.viewport.y,
      };
      this.root.setPointerCapture(event.pointerId);
      this.container.classList.add("is-panning");
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.marquee && this.marquee.id === event.pointerId) {
      const world = this.screenToWorld(event.clientX, event.clientY);
      this.marquee = { ...this.marquee, toX: world.x, toY: world.y };
      this.drawMarquee();
      return;
    }

    if (this.pan && this.pan.id === event.pointerId) {
      this.viewport = {
        ...this.viewport,
        x: this.pan.ox + (event.clientX - this.pan.startX),
        y: this.pan.oy + (event.clientY - this.pan.startY),
      };
      this.applyViewport();
      return;
    }

    if (this.drag && this.drag.id === event.pointerId) {
      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;

      this.drag.moved = true;
      this.container.classList.add("is-dragging");
      const pointer = this.screenToWorld(event.clientX, event.clientY);
      const cell = worldToCell({ x: pointer.x - this.drag.grabX, y: pointer.y - this.drag.grabY });

      const { origins } = this.drag;
      if (!origins) {
        this.store.moveNode(this.drag.node, cell);
        return;
      }

      // Shift everyone by the same amount, measured from where they started.
      const anchor = origins.get(this.drag.node);
      if (!anchor) return;
      const dCol = cell.col - anchor.col;
      const dRow = cell.row - anchor.row;

      const placements = new Map<NodeId, Cell>();
      for (const [id, origin] of origins) {
        placements.set(id, { col: origin.col + dCol, row: snapRow(origin.row + dRow) });
      }
      this.store.moveNodesTo(placements);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.marquee && this.marquee.id === event.pointerId) {
      const box = this.marqueeBounds(this.marquee);
      this.marquee = null;
      this.marqueeLayer.replaceChildren();
      this.container.classList.remove("is-selecting");

      const hit = nodesWithin(this.store.get().nodes, this.store.profile(), box);
      this.setSelection(hit.map((n) => n.id));
      if (hit.length > 0) {
        this.callbacks.onStatus(
          hit.length === 1 ? "1 node selected." : `${hit.length} nodes selected.`,
        );
      }
      return;
    }

    if (this.pan && this.pan.id === event.pointerId) {
      const moved = Math.hypot(event.clientX - this.pan.startX, event.clientY - this.pan.startY);
      this.pan = null;
      this.container.classList.remove("is-panning");
      // A click on empty space (rather than a pan) clears the selection.
      if (moved < 4) this.setSelected(null);
      return;
    }

    if (this.drag && this.drag.id === event.pointerId) {
      const { node, moved } = this.drag;
      this.drag = null;
      this.container.classList.remove("is-dragging");
      // A click, rather than a drag, narrows a group down to the one clicked.
      if (!moved) this.setSelected(node);
    }
  };

  /** The marquee as an ordered box, whichever way it was dragged. */
  private marqueeBounds(box: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  }): { minX: number; minY: number; maxX: number; maxY: number } {
    return {
      minX: Math.min(box.fromX, box.toX),
      minY: Math.min(box.fromY, box.toY),
      maxX: Math.max(box.fromX, box.toX),
      maxY: Math.max(box.fromY, box.toY),
    };
  }

  private drawMarquee(): void {
    if (!this.marquee) {
      this.marqueeLayer.replaceChildren();
      return;
    }

    const box = this.marqueeBounds(this.marquee);
    const rect = svg("rect");
    rect.setAttribute("class", "kt-marquee");
    rect.setAttribute("x", String(box.minX));
    rect.setAttribute("y", String(box.minY));
    rect.setAttribute("width", String(box.maxX - box.minX));
    rect.setAttribute("height", String(box.maxY - box.minY));
    this.marqueeLayer.replaceChildren(rect);
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    if (target.closest(".kt-node") || this.store.isReadOnly()) return;

    event.preventDefault();
    const world = this.screenToWorld(event.clientX, event.clientY);
    const created = this.store.addFreeNode(worldToCell(world));
    this.setSelected(created);
    this.callbacks.onStatus("Loose node added — shift-click another node to connect them.");
  };
}
