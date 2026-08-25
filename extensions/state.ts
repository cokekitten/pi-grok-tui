/**
 * Shared extension state (thinking expand + tool view cycle + patch refcount).
 */

export interface ActiveEntry {
  messageTimestamp: number;
  contentIndex: number;
}

/** Ctrl+O cycles: one-line chrome → pi truncated preview → full expand. */
export type ToolViewMode = "chrome" | "truncated" | "full";

export type TuiMode = "fullscreen" | "regular";

export interface ThinkingScrollState {
  activeByTimestamp: Map<number, ActiveEntry>;
  globalExpanded: boolean;
  /** Tool/custom-message display density. Default: chrome (one line). */
  toolViewMode: ToolViewMode;
  /** Last TUI that started painting. Default: regular (no custom OSC 8). */
  tuiMode: TuiMode;
  /** True only while TuiAltScreen click intercept is installed. */
  clickFoldReady: boolean;
  /** Per-thinking-block expand overrides keyed by message timestamp. */
  thinkingOverrides: Map<number, boolean>;
  /** Per-tool / custom-message view overrides. */
  viewOverrides: WeakMap<object, ToolViewMode>;
  /** Headers of verb groups the user expanded by click. */
  expandedGroupHeaders: WeakSet<object>;
  patchRefCount: number;
  patchCleanup?: (() => void) | undefined;
  patchInstallPromise?: Promise<() => void> | undefined;
  patchRelease?: (() => Promise<void>) | undefined;
}

const STATE_KEY = Symbol.for("pi-grok-tui.state");

const MODE_ORDER: ToolViewMode[] = ["chrome", "truncated", "full"];

function ensureClickFoldState(state: ThinkingScrollState): ThinkingScrollState {
  if (state.tuiMode !== "fullscreen" && state.tuiMode !== "regular") {
    state.tuiMode = "regular";
  }
  if (typeof state.clickFoldReady !== "boolean") {
    state.clickFoldReady = false;
  }
  if (!(state.thinkingOverrides instanceof Map)) {
    state.thinkingOverrides = new Map();
  }
  if (!(state.viewOverrides instanceof WeakMap)) {
    state.viewOverrides = new WeakMap();
  }
  if (!(state.expandedGroupHeaders instanceof WeakSet)) {
    state.expandedGroupHeaders = new WeakSet();
  }
  return state;
}

export function getState(): ThinkingScrollState {
  const existing = (globalThis as any)[STATE_KEY];
  if (existing && typeof existing === "object") {
    // Migrate older sessions that predate toolViewMode
    if (existing.toolViewMode !== "chrome" &&
        existing.toolViewMode !== "truncated" &&
        existing.toolViewMode !== "full") {
      existing.toolViewMode = "chrome";
    }
    return ensureClickFoldState(existing);
  }
  const created: ThinkingScrollState = {
    activeByTimestamp: new Map(),
    globalExpanded: false,
    toolViewMode: "chrome",
    tuiMode: "regular",
    clickFoldReady: false,
    thinkingOverrides: new Map(),
    viewOverrides: new WeakMap(),
    expandedGroupHeaders: new WeakSet(),
    patchRefCount: 0,
  };
  (globalThis as any)[STATE_KEY] = created;
  return created;
}

/** Drop per-row click overrides. Leaves tuiMode / clickFoldReady alone. */
export function resetClickFoldSession(): void {
  const state = getState();
  state.thinkingOverrides = new Map();
  state.viewOverrides = new WeakMap();
  state.expandedGroupHeaders = new WeakSet();
}

/** Ctrl+O: forget tool/custom/group clicks; keep thinking overrides. */
export function clearToolFoldOverrides(): void {
  const state = getState();
  state.viewOverrides = new WeakMap();
  state.expandedGroupHeaders = new WeakSet();
}

export function getViewOverride(target: object): ToolViewMode | undefined {
  return getState().viewOverrides.get(target);
}

export function setViewOverride(target: object, mode: ToolViewMode): void {
  getState().viewOverrides.set(target, mode);
}

export function isGroupExpanded(header: object): boolean {
  return getState().expandedGroupHeaders.has(header);
}

export function setGroupExpanded(header: object, expanded: boolean): void {
  const set = getState().expandedGroupHeaders;
  if (expanded) set.add(header);
  else set.delete(header);
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
