import type { Sync, SyncState } from "./sync.js";

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

const LABELS: Record<SyncState["status"], string> = {
  disabled: "Local only",
  "signed-out": "Sign in to sync",
  syncing: "Syncing…",
  synced: "Synced",
  error: "Sync problem",
};

/**
 * The sync control in the top nav: a status pill that opens either a sign-in
 * form or a sign-out menu. Hidden entirely when no credentials were built in.
 */
export class SyncBar {
  private readonly root: HTMLElement;
  private readonly pill: HTMLButtonElement;
  private readonly dot: HTMLElement;
  private readonly label: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly emailInput: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly signOutButton: HTMLButtonElement;

  private state: SyncState;

  constructor(
    parent: HTMLElement,
    private readonly sync: Sync,
  ) {
    this.state = sync.getState();

    this.root = el("div", "kt-sync");

    this.pill = el("button", "kt-sync-pill");
    this.pill.type = "button";
    this.dot = el("span", "kt-sync-dot");
    this.label = el("span", "kt-sync-label");
    this.pill.append(this.dot, this.label);
    this.pill.addEventListener("click", () => this.toggle());

    this.panel = el("div", "kt-sync-panel");
    this.panel.hidden = true;

    this.emailInput = el("input", "kt-url-input");
    this.emailInput.type = "email";
    this.emailInput.placeholder = "you@example.com";
    this.emailInput.autocomplete = "email";
    this.emailInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.send();
      }
    });

    this.sendButton = el("button", "kt-btn is-primary", "Email me a link");
    this.sendButton.type = "button";
    this.sendButton.addEventListener("click", () => void this.send());

    this.note = el("p", "kt-sync-note");

    this.signOutButton = el("button", "kt-btn", "Sign out");
    this.signOutButton.type = "button";
    this.signOutButton.addEventListener("click", () => {
      this.panel.hidden = true;
      void this.sync.signOut();
    });

    this.panel.append(this.emailInput, this.sendButton, this.signOutButton, this.note);
    this.root.append(this.pill, this.panel);
    parent.append(this.root);

    // Clicking anywhere else closes the panel.
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (target instanceof Node && this.root.contains(target)) return;
      this.panel.hidden = true;
    });

    this.update(this.state);
  }

  private toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden && this.state.status !== "synced") this.emailInput.focus();
  }

  private async send(): Promise<void> {
    this.sendButton.disabled = true;
    const error = await this.sync.signIn(this.emailInput.value);
    this.sendButton.disabled = false;
    if (!error) this.emailInput.value = "";
  }

  update(state: SyncState): void {
    this.state = state;
    this.root.hidden = state.status === "disabled";

    this.pill.dataset["status"] = state.status;
    this.dot.dataset["status"] = state.status;
    this.label.textContent =
      state.status === "synced" && state.email ? state.email : LABELS[state.status];

    const signedIn = state.status === "synced" || state.status === "syncing";
    const showForm = !signedIn || !state.email;
    this.emailInput.hidden = !showForm;
    this.sendButton.hidden = !showForm;
    this.signOutButton.hidden = showForm;

    this.note.textContent =
      state.message ??
      (showForm
        ? "No password. You get a sign-in link by email, and your trees follow you to any device."
        : "Your trees sync automatically. Export now and then for a copy you own.");
    this.note.classList.toggle("is-error", state.status === "error");
  }
}
