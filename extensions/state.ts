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
  /** Fold id under the pointer in fullscreen, if any. */
  hoveredFoldId?: string;
  /** Per-thinking-block expand overrides keyed by message timestamp. */
  thinkingOverrides: Map<number, boolean>;
  /** Per-tool / custom-message view overrides. */
  viewOverrides: WeakMap<object, ToolViewMode>;
  /** Headers of verb groups the user expanded by click. */
  expandedGroupHeaders: WeakSet<object>;
  /** Prose assistant components whose pre-prose work rollup was expanded. */
  expandedWorkRollups: WeakSet<object>;
  /** Prose/closer components whose work rollup initial state was seeded. */
  initializedWorkRollups: WeakSet<object>;
  /** Live completion timestamps (ms) for assistant thinking phases, keyed by msg timestamp. */
  thinkingEndByTimestamp: Map<number, number>;
  /** Live completion timestamps (ms) for assistant messages, keyed by msg timestamp. */
  messageEndByTimestamp: Map<number, number>;
  /** True while installWorkRollupPatch is active. */
  workRollupInstalled?: boolean;
  patchRefCount: number;
  patchCleanup?: (() => void) | undefined;
  patchInstallPromise?: Promise<() => void> | undefined;
  patchRelease?: (() => Promise<void>) | undefined;
}

const STATE_KEY = Symbol.for("pi-grok-tui.state");
export const MIN_EPOCH_MS = 1_000_000_000_000;
export const TOOL_STARTED_AT_KEY = Symbol.for("pi-grok-tui.toolStartedAt");
export const TOOL_FINISHED_AT_KEY = Symbol.for("pi-grok-tui.toolFinishedAt");
const MAX_TIMING_ENTRIES = 1024;

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
  if (!(state.expandedWorkRollups instanceof WeakSet)) {
    state.expandedWorkRollups = new WeakSet();
  }
  if (!(state.initializedWorkRollups instanceof WeakSet)) {
    state.initializedWorkRollups = new WeakSet();
  }
  if (!(state.thinkingEndByTimestamp instanceof Map)) {
    state.thinkingEndByTimestamp = new Map();
  }
  if (!(state.messageEndByTimestamp instanceof Map)) {
    state.messageEndByTimestamp = new Map();
  }
  if (typeof state.hoveredFoldId !== "string") {
    state.hoveredFoldId = undefined;
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
    hoveredFoldId: undefined,
    thinkingOverrides: new Map(),
    viewOverrides: new WeakMap(),
    expandedGroupHeaders: new WeakSet(),
    expandedWorkRollups: new WeakSet(),
    initializedWorkRollups: new WeakSet(),
    thinkingEndByTimestamp: new Map(),
    messageEndByTimestamp: new Map(),
    workRollupInstalled: false,
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
  state.expandedWorkRollups = new WeakSet();
  state.initializedWorkRollups = new WeakSet();
  state.hoveredFoldId = undefined;
}

/** Ctrl+O: forget tool/custom/group clicks; keep thinking overrides. */
export function clearToolFoldOverrides(): void {
  const state = getState();
  state.viewOverrides = new WeakMap();
  state.expandedGroupHeaders = new WeakSet();
  state.expandedWorkRollups = new WeakSet();
}

export function getViewOverride(target: object): ToolViewMode | undefined {
  return getState().viewOverrides.get(target);
}

export function setViewOverride(target: object, mode: ToolViewMode): void {
  getState().viewOverrides.set(target, mode);
}

export function clearViewOverride(target: object): void {
  getState().viewOverrides.delete(target);
}

export function isGroupExpanded(header: object): boolean {
  return getState().expandedGroupHeaders.has(header);
}

export function setGroupExpanded(header: object, expanded: boolean): void {
  const set = getState().expandedGroupHeaders;
  if (expanded) set.add(header);
  else set.delete(header);
}

export function isWorkRollupExpanded(proseTarget: object): boolean {
  return getState().expandedWorkRollups.has(proseTarget);
}

export function setWorkRollupExpanded(proseTarget: object, expanded: boolean): void {
  const set = getState().expandedWorkRollups;
  if (expanded) set.add(proseTarget);
  else set.delete(proseTarget);
}

export function isWorkRollupInitialized(proseTarget: object): boolean {
  return getState().initializedWorkRollups.has(proseTarget);
}

export function markWorkRollupInitialized(proseTarget: object): void {
  getState().initializedWorkRollups.add(proseTarget);
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

function setBoundedMapEntry(map: Map<number, number>, key: number, value: number): void {
  if (!Number.isFinite(key) || key < MIN_EPOCH_MS || !Number.isFinite(value)) return;
  if (!map.has(key) && map.size >= MAX_TIMING_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export function recordThinkingEnd(timestamp: number, atMs = Date.now()): void {
  setBoundedMapEntry(getState().thinkingEndByTimestamp, timestamp, atMs);
}

export function recordMessageEnd(timestamp: number, atMs = Date.now()): void {
  setBoundedMapEntry(getState().messageEndByTimestamp, timestamp, atMs);
}
