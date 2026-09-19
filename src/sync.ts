import type { Store } from "./store.js";
import { IMAGE_BUCKET, PROFILES_TABLE, TREES_TABLE, isConfigured, supabase } from "./supabase.js";
import type { PublishedAccount } from "./types.js";

export type SyncStatus =
  | "disabled"
  | "signed-out"
  | "syncing"
  | "synced"
  | "error";

export interface SyncState {
  status: SyncStatus;
  email: string | null;
  message: string | null;
}

/** Small images skip re-encoding, so the stored name must match what they are. */
const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/** How long to batch local edits before sending them up. */
const PUSH_DELAY = 1500;
/** Survives a reload, so edits made offline are not mistaken for a clean cache. */
const DIRTY_KEY = "knowledge-tree:unpushed";

function readDirty(): boolean {
  try {
    return localStorage.getItem(DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDirty(value: boolean): void {
  try {
    if (value) localStorage.setItem(DIRTY_KEY, "1");
    else localStorage.removeItem(DIRTY_KEY);
  } catch {
    // A full or blocked store only costs us the offline-edit hint.
  }
}

/**
 * Keeps the whole workspace in one row per user, pushed as a single JSON
 * document. The trees are small (a paragraph-heavy node is ~400 bytes), so
 * document-level sync is simpler and safer here than syncing node by node.
 *
 * Conflicts resolve last-write-wins with one guard: a device holding unpushed
 * edits pushes them rather than adopting the server copy. Two devices edited
 * while both were offline is the case this does not solve — Export is the
 * backstop there.
 */
export class Sync {
  private state: SyncState = {
    status: isConfigured() ? "signed-out" : "disabled",
    email: null,
    message: null,
  };

  private userId: string | null = null;
  private pushTimer: number | null = null;
  /** True while writing a server copy into the store, so it is not echoed back. */
  private applyingRemote = false;
  private dirty = readDirty();
  private pushing = false;
  private pushAgain = false;
  /** `updated_at` of the newest server copy we have taken, in ms. */
  private adoptedAt = 0;

  constructor(
    private readonly store: Store,
    private readonly onChange: (state: SyncState) => void,
  ) {}

  getState(): Readonly<SyncState> {
    return this.state;
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private fail(message: string): void {
    this.set({ status: "error", message });
  }

  start(): void {
    const sb = supabase();
    if (!sb) return;

    // Fires once on load with any restored session, then on every change.
    sb.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      this.userId = user?.id ?? null;

      if (!user) {
        this.set({ status: "signed-out", email: null, message: null });
        return;
      }
      this.set({ status: "syncing", email: user.email ?? null, message: null });
      void this.pull();
    });

    this.store.subscribe(() => {
      if (this.applyingRemote) return;
      this.markDirty();
    });

    // Coming back to the tab is exactly when another device may have moved ahead.
    window.addEventListener("focus", () => void this.pull());
    window.addEventListener("online", () => void this.pull());
  }

  async signIn(email: string): Promise<string | null> {
    const sb = supabase();
    if (!sb) return "Sync is not configured.";

    const address = email.trim();
    if (!address) return "Enter your email address.";

    this.set({ status: "syncing", message: null });
    const { error } = await sb.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      this.fail(error.message);
      return error.message;
    }
    this.set({ status: "signed-out", message: "Check your email for the sign-in link." });
    return null;
  }

  async signOut(): Promise<void> {
    await supabase()?.auth.signOut();
  }

  /** Uploads an image and returns its public URL, or null when not signed in. */
  async uploadImage(blob: Blob): Promise<string | null> {
    const sb = supabase();
    if (!sb || !this.userId) return null;

    const type = blob.type || "image/webp";
    const path = `${this.userId}/${crypto.randomUUID()}.${EXTENSIONS[type] ?? "webp"}`;
    const { error } = await sb.storage
      .from(IMAGE_BUCKET)
      .upload(path, blob, { contentType: type, upsert: false });

    if (error) {
      this.fail(`Image upload failed: ${error.message}`);
      return null;
    }
    return sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // --- sharing -------------------------------------------------------------

  /** Whether sync is even possible here; browsing needs no account. */
  canBrowse(): boolean {
    return isConfigured();
  }

  signedInAs(): string | null {
    return this.userId;
  }

  /**
   * Everyone who has published. Row-level security means this only ever
   * returns opted-in accounts, whether or not anyone is signed in — so a
   * guest sees exactly what a signed-in visitor sees, and nothing more.
   */
  async listPublished(): Promise<PublishedAccount[]> {
    const sb = supabase();
    if (!sb) return [];

    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select("owner, display_name")
      .eq("published", true)
      .order("display_name", { ascending: true });

    if (error || !data) return [];
    return data.map((row) => ({
      owner: String(row.owner),
      name: String(row.display_name ?? "").trim() || "Unnamed",
    }));
  }

  /** Fetches one account's trees. Null when it is not published after all. */
  async fetchWorkspace(owner: string): Promise<unknown | null> {
    const sb = supabase();
    if (!sb) return null;

    const { data, error } = await sb
      .from(TREES_TABLE)
      .select("data")
      .eq("owner", owner)
      .maybeSingle();

    if (error || !data) return null;
    return data.data;
  }

  /** Your own sharing settings. */
  async getPublishing(): Promise<{ published: boolean; name: string }> {
    const sb = supabase();
    if (!sb || !this.userId) return { published: false, name: "" };

    const { data } = await sb
      .from(PROFILES_TABLE)
      .select("display_name, published")
      .eq("owner", this.userId)
      .maybeSingle();

    return {
      published: data?.published === true,
      name: String(data?.display_name ?? ""),
    };
  }

  /** Publishes or unpublishes your trees. Returns an error message on failure. */
  async setPublishing(published: boolean, name: string): Promise<string | null> {
    const sb = supabase();
    if (!sb || !this.userId) return "Sign in first to publish your trees.";

    const { error } = await sb.from(PROFILES_TABLE).upsert({
      owner: this.userId,
      display_name: name.trim().slice(0, 60),
      published,
      updated_at: new Date().toISOString(),
    });

    return error ? error.message : null;
  }

  // --- pushing your own ----------------------------------------------------

  private markDirty(): void {
    this.dirty = true;
    writeDirty(true);
    if (!this.userId) return;

    if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => void this.push(), PUSH_DELAY);
  }

  private async pull(): Promise<void> {
    const sb = supabase();
    if (!sb || !this.userId) return;

    this.set({ status: "syncing", message: null });
    const { data, error } = await sb
      .from(TREES_TABLE)
      .select("data, updated_at")
      .eq("owner", this.userId)
      .maybeSingle();

    if (error) {
      this.fail(error.message);
      return;
    }

    if (!data) {
      // Nothing up there yet: this device seeds the account.
      await this.push();
      return;
    }

    if (this.dirty) {
      // Local edits have not landed yet; they win rather than being overwritten.
      await this.push();
      return;
    }

    const remoteAt = Date.parse(String(data.updated_at));
    if (Number.isFinite(remoteAt) && remoteAt > this.adoptedAt) {
      this.applyingRemote = true;
      try {
        if (this.store.adopt(data.data)) this.adoptedAt = remoteAt;
      } finally {
        this.applyingRemote = false;
      }
    }
    this.set({ status: "synced", message: null });
  }

  private async push(): Promise<void> {
    const sb = supabase();
    if (!sb || !this.userId) return;

    if (this.pushing) {
      this.pushAgain = true;
      return;
    }
    this.pushing = true;
    this.set({ status: "syncing", message: null });

    const updatedAt = new Date().toISOString();
    const { error } = await sb
      .from(TREES_TABLE)
      .upsert({ owner: this.userId, data: this.store.snapshot(), updated_at: updatedAt });

    this.pushing = false;

    if (error) {
      this.fail(error.message);
      return;
    }

    this.dirty = false;
    writeDirty(false);
    this.adoptedAt = Date.parse(updatedAt);
    this.set({ status: "synced", message: null });

    if (this.pushAgain) {
      this.pushAgain = false;
      void this.push();
    }
  }
}
