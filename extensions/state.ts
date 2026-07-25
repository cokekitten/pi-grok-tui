/**
 * Shared extension state (thinking expand + tool view cycle + patch refcount).
 */

export interface ActiveEntry {
  messageTimestamp: number;
  contentIndex: number;
}

/** Ctrl+O cycles: one-line chrome → pi truncated preview → full expand. */
export type ToolViewMode = "chrome" | "truncated" | "full";

export interface ThinkingScrollState {
  activeByTimestamp: Map<number, ActiveEntry>;
  globalExpanded: boolean;
  /** Tool/custom-message display density. Default: chrome (one line). */
  toolViewMode: ToolViewMode;
  patchRefCount: number;
  patchCleanup?: (() => void) | undefined;
  patchInstallPromise?: Promise<() => void> | undefined;
  patchRelease?: (() => Promise<void>) | undefined;
}

const STATE_KEY = Symbol.for("thinking-scroll.state");

const MODE_ORDER: ToolViewMode[] = ["chrome", "truncated", "full"];

export function getState(): ThinkingScrollState {
  const existing = (globalThis as any)[STATE_KEY];
  if (existing && typeof existing === "object") {
    // Migrate older sessions that predate toolViewMode
    if (existing.toolViewMode !== "chrome" &&
        existing.toolViewMode !== "truncated" &&
        existing.toolViewMode !== "full") {
      existing.toolViewMode = "chrome";
    }
    return existing;
  }
  const created: ThinkingScrollState = {
    activeByTimestamp: new Map(),
    globalExpanded: false,
    toolViewMode: "chrome",
    patchRefCount: 0,
  };
  (globalThis as any)[STATE_KEY] = created;
  return created;
}

export function getToolViewMode(): ToolViewMode {
  return getState().toolViewMode;
}

/** Advance chrome → truncated → full → chrome. Returns the new mode. */
export function cycleToolViewMode(): ToolViewMode {
  const state = getState();
  const idx = MODE_ORDER.indexOf(state.toolViewMode);
  const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length]!;
  state.toolViewMode = next;
  return next;
}

export function toolViewModeLabel(mode: ToolViewMode): string {
  switch (mode) {
    case "chrome":
      return "compact (one line)";
    case "truncated":
      return "preview (truncated)";
    case "full":
      return "full";
  }
}
