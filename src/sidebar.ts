import { TITLE_MAX } from "./config.js";
import { prepareImage, type ImageUploader } from "./media.js";
import type { Store } from "./store.js";
import type { NodeId } from "./types.js";

export interface SidebarCallbacks {
  /** Stores an image and returns the URL to render it from. */
  uploadImage: ImageUploader;
  onFocusNode: (id: NodeId) => void;
  onStatus: (message: string) => void;
  onDismiss: () => void;
}

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

/** The detail panel: title, description and images of the selected node. */
export class Sidebar {
  private readonly root: HTMLElement;
  private readonly railTag: HTMLElement;
  private readonly dateLabel: HTMLElement;
  private readonly dateInput: HTMLInputElement;
  private readonly titleInput: HTMLInputElement;
  private readonly counter: HTMLElement;
  private readonly descInput: HTMLTextAreaElement;
  private readonly thumbs: HTMLElement;
  private readonly urlInput: HTMLInputElement;
  private readonly fileInput: HTMLInputElement;
  private readonly links: HTMLElement;
  private readonly mainToggle: HTMLInputElement;
  private readonly lightbox: HTMLElement;
  private readonly lightboxImg: HTMLImageElement;

  private currentId: NodeId | null = null;
  private saveTimer: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly store: Store,
    private readonly callbacks: SidebarCallbacks,
  ) {
    this.root = el("aside", "kt-sidebar");
    this.root.hidden = true;

    const header = el("header", "kt-sidebar-head");
    this.railTag = el("span", "kt-rail-tag");
    const close = el("button", "kt-icon-btn", "×");
    close.type = "button";
    close.title = "Close (Esc)";
    close.addEventListener("click", () => this.callbacks.onDismiss());
    header.append(this.railTag, close);

    this.dateLabel = el("label", "kt-field-label", "Date");
    this.dateInput = el("input", "kt-date-input");
    this.dateInput.type = "text";
    this.dateInput.maxLength = 40;
    this.dateInput.placeholder = "1796";
    this.dateInput.addEventListener("input", () => {
      this.dateInput.classList.toggle("is-missing", this.isDateMissing());
      this.queueSave();
    });

    this.titleInput = el("input", "kt-title-input");
    this.titleInput.type = "text";
    this.titleInput.maxLength = TITLE_MAX;
    this.titleInput.placeholder = "Title";
    this.titleInput.addEventListener("input", () => {
      this.updateCounter();
      this.queueSave();
    });

    this.counter = el("div", "kt-counter");

    this.descInput = el("textarea", "kt-desc-input");
    this.descInput.placeholder = "What happened, and why it matters…";
    this.descInput.rows = 9;
    this.descInput.addEventListener("input", () => this.queueSave());

    this.thumbs = el("div", "kt-thumbs");

    this.fileInput = el("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*";
    this.fileInput.multiple = true;
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => void this.onFilesPicked());

    const uploadBtn = el("button", "kt-btn", "Upload");
    uploadBtn.type = "button";
    uploadBtn.addEventListener("click", () => this.fileInput.click());

    this.urlInput = el("input", "kt-url-input");
    this.urlInput.type = "url";
    this.urlInput.placeholder = "or paste an image URL";
    this.urlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.addUrlImage();
      }
    });

    const addUrlBtn = el("button", "kt-btn", "Add");
    addUrlBtn.type = "button";
    addUrlBtn.addEventListener("click", () => this.addUrlImage());

    const imageRow = el("div", "kt-image-row");
    imageRow.append(uploadBtn, this.urlInput, addUrlBtn, this.fileInput);

    this.links = el("ul", "kt-links");

    this.mainToggle = el("input");
    this.mainToggle.type = "checkbox";
    this.mainToggle.addEventListener("change", () => {
      if (!this.currentId) return;
      this.store.updateNode(this.currentId, { main: this.mainToggle.checked });
    });
    const toggleLabel = el("label", "kt-toggle");
    toggleLabel.append(this.mainToggle, el("span", undefined, "On the main rail"));

    const deleteBtn = el("button", "kt-btn is-danger", "Delete node");
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", () => {
      if (!this.currentId) return;
      this.store.removeNode(this.currentId);
      this.callbacks.onStatus("Node deleted.");
      this.callbacks.onDismiss();
    });

    const footer = el("footer", "kt-sidebar-foot");
    footer.append(toggleLabel, deleteBtn);

    this.root.append(
      header,
      this.dateLabel,
      this.dateInput,
      el("label", "kt-field-label", "Title"),
      this.titleInput,
      this.counter,
      el("label", "kt-field-label", "Description"),
      this.descInput,
      el("label", "kt-field-label", "Images"),
      this.thumbs,
      imageRow,
      el("label", "kt-field-label", "Connections"),
      this.links,
      footer,
    );
    parent.append(this.root);

    this.lightbox = el("div", "kt-lightbox");
    this.lightbox.hidden = true;
    this.lightboxImg = el("img");
    this.lightbox.append(this.lightboxImg);
    this.lightbox.addEventListener("click", () => this.closeLightbox());
    document.body.append(this.lightbox);
  }

  isLightboxOpen(): boolean {
    return !this.lightbox.hidden;
  }

  closeLightbox(): void {
    this.lightbox.hidden = true;
    this.lightboxImg.src = "";
  }

  /** Puts the caret in the title, for a node that was just created. */
  focusTitle(): void {
    this.titleInput.focus();
    this.titleInput.select();
  }

  /** True while a text field has focus, so global shortcuts can stand down. */
  hasFocus(): boolean {
    const active = document.activeElement;
    return active !== null && this.root.contains(active);
  }

  /** Points the panel at a node (or closes it). Rebuilds the field values. */
  setNode(id: NodeId | null): void {
    this.flushSave();
    this.currentId = id;

    const node = this.store.node(id);
    if (!node) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    this.dateInput.value = node.date;
    this.titleInput.value = node.title;
    this.descInput.value = node.description;
    this.mainToggle.checked = node.main;
    this.urlInput.value = "";
    this.updateCounter();
    this.refresh();
  }

  /** Re-renders the parts that can change while the panel stays open. */
  refresh(): void {
    const node = this.store.node(this.currentId);
    if (!node) {
      this.root.hidden = true;
      return;
    }

    this.railTag.textContent = node.main ? "Main rail" : "Side rail";
    this.railTag.classList.toggle("is-main", node.main);
    this.mainToggle.checked = node.main;
    this.dateLabel.textContent = node.main ? "Date · required" : "Date · optional";
    this.dateInput.classList.toggle("is-missing", this.isDateMissing());
    if (document.activeElement !== this.titleInput) this.updateCounter();

    this.renderThumbs(node.images);
    this.renderLinks(node.id);
  }

  /** True when a main-rail node has been left without its mandatory date. */
  private isDateMissing(): boolean {
    const node = this.store.node(this.currentId);
    return node !== undefined && node.main && this.dateInput.value.trim() === "";
  }

  private updateCounter(): void {
    this.counter.textContent = `${this.titleInput.value.length} / ${TITLE_MAX}`;
  }

  private queueSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 220);
  }

  private flushSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.currentId || !this.store.node(this.currentId)) return;
    this.store.updateNode(this.currentId, {
      date: this.dateInput.value,
      title: this.titleInput.value,
      description: this.descInput.value,
    });
  }

  private renderThumbs(images: readonly string[]): void {
    this.thumbs.replaceChildren();
    if (images.length === 0) {
      this.thumbs.append(el("p", "kt-empty", "No images yet."));
      return;
    }

    images.forEach((src, index) => {
      const figure = el("figure", "kt-thumb");
      const img = el("img");
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("click", () => {
        this.lightboxImg.src = src;
        this.lightbox.hidden = false;
      });

      const remove = el("button", "kt-thumb-remove", "×");
      remove.type = "button";
      remove.title = "Remove image";
      remove.addEventListener("click", () => this.removeImage(index));

      figure.append(img, remove);
      this.thumbs.append(figure);
    });
  }

  private renderLinks(id: NodeId): void {
    this.links.replaceChildren();
    const edges = this.store.edgesOf(id);
    if (edges.length === 0) {
      this.links.append(el("li", "kt-empty", "Not connected to anything."));
      return;
    }

    for (const edge of edges) {
      const otherId = edge.from === id ? edge.to : edge.from;
      const other = this.store.node(otherId);
      if (!other) continue;

      const item = el("li", "kt-link");
      const jump = el("button", "kt-link-jump");
      jump.type = "button";
      jump.append(
        el("span", "kt-link-dir", edge.from === id ? "→" : "←"),
        el("span", "kt-link-title", other.title || "Untitled"),
      );
      jump.addEventListener("click", () => this.callbacks.onFocusNode(otherId));

      const unlink = el("button", "kt-icon-btn", "×");
      unlink.type = "button";
      unlink.title = "Remove this arrow";
      unlink.addEventListener("click", () => {
        this.store.removeEdge(edge.id);
        this.callbacks.onStatus("Arrow removed.");
      });

      item.append(jump, unlink);
      this.links.append(item);
    }
  }

  private removeImage(index: number): void {
    const node = this.store.node(this.currentId);
    if (!node) return;
    const next = node.images.filter((_, i) => i !== index);
    this.store.updateNode(node.id, { images: next });
  }

  private addUrlImage(): void {
    const node = this.store.node(this.currentId);
    if (!node) return;
    const url = this.urlInput.value.trim();
    if (!url) return;

    this.store.updateNode(node.id, { images: [...node.images, url] });
    this.urlInput.value = "";
  }

  private async onFilesPicked(): Promise<void> {
    const node = this.store.node(this.currentId);
    const files = Array.from(this.fileInput.files ?? []);
    this.fileInput.value = "";
    if (!node || files.length === 0) return;

    const added: string[] = [];
    for (const file of files) {
      try {
        added.push(await this.callbacks.uploadImage(await prepareImage(file)));
      } catch {
        this.callbacks.onStatus(`Could not read ${file.name}.`);
      }
    }
    if (added.length === 0) return;

    const current = this.store.node(node.id);
    if (!current) return;
    this.store.updateNode(node.id, { images: [...current.images, ...added] });

    const error = this.store.getSaveError();
    this.callbacks.onStatus(
      error ?? `${added.length} image${added.length === 1 ? "" : "s"} added.`,
    );
  }
}
