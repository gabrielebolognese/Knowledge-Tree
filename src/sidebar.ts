import { titleLimitFor } from "./layout.js";
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
  private readonly dateField: HTMLElement;
  private readonly dateLabel: HTMLElement;
  private readonly dateInput: HTMLInputElement;
  private readonly examplesField: HTMLElement;
  private readonly examplesInput: HTMLTextAreaElement;
  private readonly translationField: HTMLElement;
  private readonly italianField: HTMLElement;
  private readonly italianInput: HTMLInputElement;
  private readonly descriptionField: HTMLElement;
  private readonly imagesField: HTMLElement;
  private readonly connectionsField: HTMLElement;
  private readonly translationInput: HTMLInputElement;
  private readonly titleLabel: HTMLElement;
  private readonly titleInput: HTMLInputElement;
  private readonly counter: HTMLElement;
  private readonly descInput: HTMLTextAreaElement;
  private readonly thumbs: HTMLElement;
  private readonly urlInput: HTMLInputElement;
  private readonly fileInput: HTMLInputElement;
  private readonly links: HTMLElement;
  private readonly toggles: HTMLElement;
  private readonly mainToggle: HTMLInputElement;
  private readonly corollaryToggle: HTMLInputElement;
  private readonly importantToggle: HTMLInputElement;
  private readonly importantLabel: HTMLElement;
  private readonly editControls: HTMLElement[] = [];
  private readonly lightbox: HTMLElement;
  private readonly lightboxImg: HTMLImageElement;

  private currentId: NodeId | null = null;
  /** Infinity where the subject accepts whole phrases. */
  private titleLimit = Number.POSITIVE_INFINITY;
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

    this.titleLabel = el("label", "kt-field-label", "Title");
    this.dateField = el("div", "kt-field");
    this.dateField.append(this.dateLabel, this.dateInput);

    this.titleInput = el("input", "kt-title-input");
    this.titleInput.type = "text";
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

    this.examplesInput = el("textarea", "kt-desc-input");
    this.examplesInput.placeholder = "Worked examples, one per line\u2026";
    this.examplesInput.rows = 6;
    this.examplesInput.addEventListener("input", () => this.queueSave());

    this.examplesField = el("div", "kt-field");
    this.examplesField.append(el("label", "kt-field-label", "Examples"), this.examplesInput);

    this.translationInput = el("input", "kt-title-input");
    this.translationInput.type = "text";
    this.translationInput.placeholder = "in English";
    this.translationInput.addEventListener("input", () => this.queueSave());

    this.translationField = el("div", "kt-field");
    this.translationField.append(
      el("label", "kt-field-label", "English"),
      this.translationInput,
    );

    this.italianInput = el("input", "kt-url-input");
    this.italianInput.type = "text";
    this.italianInput.placeholder = "in italiano";
    this.italianInput.addEventListener("input", () => this.queueSave());

    this.italianField = el("div", "kt-field");
    this.italianField.append(el("label", "kt-field-label", "Italian"), this.italianInput);

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

    this.corollaryToggle = el("input");
    this.corollaryToggle.type = "checkbox";
    this.corollaryToggle.addEventListener("change", () => {
      if (!this.currentId) return;
      this.store.updateNode(this.currentId, { corollary: this.corollaryToggle.checked });
    });
    const corollaryLabel = el("label", "kt-toggle");
    corollaryLabel.title =
      "A sub-point hanging off this node: smaller, closer, and only grows downward";
    corollaryLabel.append(this.corollaryToggle, el("span", undefined, "Is a corollary"));

    this.importantToggle = el("input");
    this.importantToggle.type = "checkbox";
    this.importantToggle.addEventListener("change", () => {
      if (!this.currentId) return;
      this.store.updateNode(this.currentId, { important: this.importantToggle.checked });
    });
    this.importantLabel = el("label", "kt-toggle");
    this.importantLabel.title = "Squares off this side node so it stands out";
    this.importantLabel.append(this.importantToggle, el("span", undefined, "Important"));

    const deleteBtn = el("button", "kt-btn is-danger", "Delete node");
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", () => {
      if (!this.currentId) return;
      this.store.removeNode(this.currentId);
      this.callbacks.onStatus("Node deleted.");
      this.callbacks.onDismiss();
    });

    this.toggles = el("div", "kt-toggles");
    this.toggles.append(toggleLabel, corollaryLabel, this.importantLabel);

    const footer = el("footer", "kt-sidebar-foot");
    footer.append(this.toggles, deleteBtn);

    // Grouped so a subject can drop whole sections it has no use for.
    this.descriptionField = el("div", "kt-field");
    this.descriptionField.append(
      el("label", "kt-field-label", "Description"),
      this.descInput,
    );

    this.imagesField = el("div", "kt-field");
    this.imagesField.append(
      el("label", "kt-field-label", "Images"),
      this.thumbs,
      imageRow,
    );

    this.connectionsField = el("div", "kt-field");
    this.connectionsField.append(
      el("label", "kt-field-label", "Connections"),
      this.links,
    );

    this.root.append(
      header,
      this.dateField,
      this.titleLabel,
      this.titleInput,
      this.counter,
      this.translationField,
      this.italianField,
      this.descriptionField,
      this.examplesField,
      this.imagesField,
      this.connectionsField,
      footer,
    );
    // Everything here writes, so all of it is switched off in view mode.
    this.editControls.push(
      this.dateInput,
      this.titleInput,
      this.descInput,
      this.examplesInput,
      this.urlInput,
      this.translationInput,
      this.italianInput,
      uploadBtn,
      addUrlBtn,
      this.mainToggle,
      this.corollaryToggle,
      this.importantToggle,
      deleteBtn,
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
    this.examplesInput.value = node.examples;
    this.translationInput.value = node.translation;
    this.italianInput.value = node.italian;
    this.descInput.value = node.description;
    this.mainToggle.checked = node.main;
    this.corollaryToggle.checked = node.corollary;
    this.importantToggle.checked = node.important;
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

    const profile = this.store.profile();
    const readOnly = this.store.isReadOnly();
    this.root.classList.toggle("is-readonly", readOnly);
    for (const control of this.editControls) {
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        control.readOnly = readOnly && control.type !== "checkbox";
        control.disabled = readOnly && control.type === "checkbox";
      } else if (control instanceof HTMLButtonElement) {
        control.disabled = readOnly;
      }
    }
    // Dates belong to a timeline; examples to a rulebook. Show only what applies.
    this.dateField.hidden = !profile.dates;
    this.examplesField.hidden = !profile.examples;
    // A vocabulary bubble is a word and its meaning; there are no rails here.
    this.translationField.hidden = !profile.bubbles;
    this.italianField.hidden = !profile.bubbles;
    // A bubble is three words and nothing else: no prose, no pictures, and
    // nothing to connect to.
    this.descriptionField.hidden = profile.bubbles;
    this.imagesField.hidden = profile.bubbles;
    this.connectionsField.hidden = profile.bubbles;
    this.titleLabel.textContent = profile.bubbles ? "Word" : "Title";
    this.titleInput.placeholder = profile.bubbles ? "la palabra" : "Title";
    this.toggles.hidden = profile.bubbles;
    this.titleLimit = titleLimitFor(node, profile);
    if (Number.isFinite(this.titleLimit)) {
      this.titleInput.maxLength = this.titleLimit;
    } else {
      this.titleInput.removeAttribute("maxlength");
    }

    this.railTag.textContent = profile.bubbles
      ? "Word"
      : node.main
        ? "Main rail"
        : node.corollary
          ? "Corollary"
          : "Side rail";
    this.railTag.classList.toggle("is-main", node.main);
    this.railTag.classList.toggle("is-corollary", node.corollary);
    this.mainToggle.checked = node.main;
    this.corollaryToggle.checked = node.corollary;
    // The two are mutually exclusive, so never offer both at once.
    this.mainToggle.disabled = readOnly || node.corollary || node.important;
    this.corollaryToggle.disabled = readOnly || node.main;
    // Emphasis for side nodes only, and only where the subject allows it.
    this.importantLabel.hidden = !profile.important;
    this.importantToggle.checked = node.important;
    this.importantToggle.disabled = readOnly || node.main;
    this.dateLabel.textContent = node.main ? "Date · required" : "Date · optional";
    this.dateInput.classList.toggle("is-missing", this.isDateMissing());
    if (document.activeElement !== this.titleInput) this.updateCounter();

    this.renderThumbs(node.images);
    this.renderLinks(node.id);
  }

  /** True when a main-rail node has been left without its mandatory date. */
  private isDateMissing(): boolean {
    if (!this.store.profile().dates) return false;
    const node = this.store.node(this.currentId);
    return node !== undefined && node.main && this.dateInput.value.trim() === "";
  }

  private updateCounter(): void {
    const length = this.titleInput.value.length;
    this.counter.textContent = Number.isFinite(this.titleLimit)
      ? `${length} / ${this.titleLimit}`
      : `${length}`;
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
      examples: this.examplesInput.value,
      translation: this.translationInput.value,
      italian: this.italianInput.value,
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
