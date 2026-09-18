import { DATE_GAP, MAX_SCALE, MIN_SCALE } from "./config.js";
import {
  cellToWorld,
  contentBounds,
  edgeGeometry,
  fitTitle,
  radiusOf,
  worldToCell,
} from "./layout.js";
import type { Store } from "./store.js";
import type { Direction, NodeId, Point, TreeNode, Viewport } from "./types.js";

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

  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private selected: NodeId | null = null;

  private pan: { id: number; startX: number; startY: number; ox: number; oy: number } | null = null;
  private drag: {
    id: number;
    node: NodeId;
    moved: boolean;
    startX: number;
    startY: number;
    grabX: number;
    grabY: number;
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
    this.world.append(this.edgeLayer, this.nodeLayer);
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
    const bounds = contentBounds(this.store.get().nodes);
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

  getSelected(): NodeId | null {
    return this.selected;
  }

  setSelected(id: NodeId | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.render();
    this.callbacks.onSelect(id);
  }

  // --- rendering ------------------------------------------------------------

  render(): void {
    const { nodes, edges } = this.store.get();
    const byId = new Map<NodeId, TreeNode>(nodes.map((n) => [n.id, n]));

    const edgeFrag = document.createDocumentFragment();
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;

      const geom = edgeGeometry(cellToWorld(from), cellToWorld(to), radiusOf(from), radiusOf(to));
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
    for (const node of nodes) nodeFrag.append(this.renderNode(node));
    this.nodeLayer.replaceChildren(nodeFrag);
  }

  private renderNode(node: TreeNode): SVGGElement {
    const group = svg("g");
    const isSelected = node.id === this.selected;
    const classes = ["kt-node"];
    if (node.main) classes.push("is-main");
    if (isSelected) classes.push("is-selected");
    group.setAttribute("class", classes.join(" "));
    group.dataset["id"] = node.id;

    const { x, y } = cellToWorld(node);
    group.setAttribute("transform", `translate(${x} ${y})`);

    const r = radiusOf(node);

    const circle = svg("circle");
    circle.setAttribute("class", "kt-circle");
    circle.setAttribute("r", String(r));
    group.append(circle);

    group.append(this.renderTitle(node, r));

    const date = this.renderDate(node, r);
    if (date) group.append(date);

    if (node.images.length > 0) {
      const dot = svg("circle");
      dot.setAttribute("class", "kt-media-dot");
      dot.setAttribute("r", "4");
      dot.setAttribute("cx", String((r + 9) * 0.71));
      dot.setAttribute("cy", String(-(r + 9) * 0.71));
      group.append(dot);
    }

    if (isSelected) {
      for (const handle of HANDLES) group.append(this.renderHandle(handle, r));
    }
    return group;
  }

  /** The title, wrapped to sit inside the circle. */
  private renderTitle(node: TreeNode, radius: number): SVGTextElement {
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
    return text;
  }

  /**
   * The date, outside the circle to its left. Main-rail nodes always show it,
   * flagging the gap when it has not been filled in yet.
   */
  private renderDate(node: TreeNode, radius: number): SVGTextElement | null {
    const value = node.date.trim();
    const missing = node.main && value === "";
    if (!value && !missing) return null;

    const text = svg("text");
    text.setAttribute("class", missing ? "kt-date is-missing" : "kt-date");
    text.setAttribute("text-anchor", "end");
    text.setAttribute("x", String(-(radius + DATE_GAP)));
    text.setAttribute("y", "0");
    text.setAttribute("dy", "0.34em");
    text.textContent = missing ? "date needed" : value;
    return text;
  }

  private renderHandle(handle: HandleSpec, r: number): SVGGElement {
    const dist = r + HANDLE_DIST;
    const group = svg("g");
    group.setAttribute("class", "kt-handle");
    group.setAttribute("transform", `translate(${handle.dx * dist} ${handle.dy * dist})`);
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

    const handleEl = target.closest(".kt-handle");
    if (handleEl instanceof SVGElement && this.selected) {
      event.preventDefault();
      const dir = handleEl.dataset["dir"] as Direction | undefined;
      if (!dir) return;
      const created = this.store.addChild(this.selected, dir);
      if (created) this.setSelected(created);
      return;
    }

    const nodeEl = target.closest(".kt-node");
    if (nodeEl instanceof SVGElement && event.button === 0) {
      const id = nodeEl.dataset["id"];
      if (!id) return;
      event.preventDefault();

      if (event.shiftKey && this.selected && this.selected !== id) {
        const linked = this.store.connect(this.selected, id);
        this.callbacks.onStatus(linked ? "Arrow drawn." : "Those two are already connected.");
        return;
      }

      const node = this.store.node(id);
      if (!node) return;
      const pointer = this.screenToWorld(event.clientX, event.clientY);
      const centre = cellToWorld(node);
      this.drag = {
        id: event.pointerId,
        node: id,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        grabX: pointer.x - centre.x,
        grabY: pointer.y - centre.y,
      };
      this.root.setPointerCapture(event.pointerId);
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
      this.store.moveNode(this.drag.node, cell);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
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
      if (!moved) this.setSelected(node);
    }
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    if (target.closest(".kt-node")) return;

    event.preventDefault();
    const world = this.screenToWorld(event.clientX, event.clientY);
    const created = this.store.addFreeNode(worldToCell(world));
    this.setSelected(created);
    this.callbacks.onStatus("Loose node added — shift-click another node to connect them.");
  };
}
