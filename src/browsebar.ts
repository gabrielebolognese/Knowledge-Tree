import type { Sync } from "./sync.js";
import type { PublishedAccount } from "./types.js";

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

export interface BrowseCallbacks {
  onOpen: (account: PublishedAccount) => void;
  onStatus: (message: string) => void;
}

/**
 * The "Browse" control: who has published, and your own publish switch.
 *
 * Browsing needs no account at all — a signed-out guest sees the same list a
 * signed-in visitor does, because row-level security decides what is in it.
 */
export class BrowseBar {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly list: HTMLElement;
  private readonly publishBox: HTMLElement;
  private readonly publishToggle: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private readonly note: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly sync: Sync,
    private readonly callbacks: BrowseCallbacks,
  ) {
    this.root = el("div", "kt-browse");
    this.root.hidden = !sync.canBrowse();

    this.button = el("button", "kt-sync-pill", "Browse");
    this.button.type = "button";
    this.button.title = "Read other people's published trees";
    this.button.addEventListener("click", () => void this.toggle());

    this.panel = el("div", "kt-sync-panel");
    this.panel.hidden = true;

    this.list = el("div", "kt-browse-list");

    this.nameInput = el("input", "kt-url-input");
    this.nameInput.type = "text";
    this.nameInput.maxLength = 60;
    this.nameInput.placeholder = "Shown to visitors";

    this.publishToggle = el("input");
    this.publishToggle.type = "checkbox";
    this.publishToggle.addEventListener("change", () => void this.savePublishing());
    this.nameInput.addEventListener("change", () => void this.savePublishing());

    const publishLabel = el("label", "kt-toggle");
    publishLabel.append(this.publishToggle, el("span", undefined, "Publish my trees"));

    this.publishBox = el("div", "kt-browse-publish");
    this.publishBox.append(publishLabel, this.nameInput);

    this.note = el("p", "kt-sync-note");
    this.note.textContent =
      "Published trees are readable by anyone, including signed-out visitors. Nothing is shared until you switch this on.";

    this.panel.append(
      el("p", "kt-browse-heading", "Published trees"),
      this.list,
      this.publishBox,
      this.note,
    );
    this.root.append(this.button, this.panel);
    parent.append(this.root);

    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (target instanceof Node && this.root.contains(target)) return;
      this.panel.hidden = true;
    });
  }

  private async toggle(): Promise<void> {
    this.panel.hidden = !this.panel.hidden;
    if (this.panel.hidden) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.list.replaceChildren(el("p", "kt-empty", "Looking…"));

    const accounts = await this.sync.listPublished();
    this.list.replaceChildren();

    if (accounts.length === 0) {
      this.list.append(el("p", "kt-empty", "Nobody has published yet."));
    } else {
      for (const account of accounts) {
        const row = el("button", "kt-browse-row", account.name);
        row.type = "button";
        row.addEventListener("click", () => {
          this.panel.hidden = true;
          this.callbacks.onOpen(account);
        });
        this.list.append(row);
      }
    }

    // You can only publish what you can sign in to.
    const signedIn = this.sync.signedInAs() !== null;
    this.publishBox.hidden = !signedIn;
    if (!signedIn) return;

    const current = await this.sync.getPublishing();
    this.publishToggle.checked = current.published;
    this.nameInput.value = current.name;
  }

  private async savePublishing(): Promise<void> {
    const name = this.nameInput.value.trim();
    if (this.publishToggle.checked && name === "") {
      this.callbacks.onStatus("Give yourself a name first, so visitors know whose trees these are.");
      this.publishToggle.checked = false;
      this.nameInput.focus();
      return;
    }

    const error = await this.sync.setPublishing(this.publishToggle.checked, name);
    if (error) {
      this.callbacks.onStatus(error);
      return;
    }
    this.callbacks.onStatus(
      this.publishToggle.checked ? "Your trees are now public." : "Your trees are private again.",
    );
  }
}
