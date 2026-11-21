/**
 * Per-tool / group click fold helpers.
 */
import { RESPONSE_LEFT_PAD, type ChromeKind, type ChromeTheme } from "./chrome.ts";
import {
  groupRunRange,
  isGroupableTool,
  nextToolFoldMode,
  type GroupSibling,
} from "./click-fold-core.ts";
import {
  extractCodemodeCalls,
  isCodemodeAutoTree,
  isCodemodeTool,
  resolveCodemodeDisplay,
} from "./codemode-style.ts";
import {
  groupFoldId,
  idForTarget,
  registerFoldHandler,
  renderClickableChrome,
} from "./click-fold.ts";
import { isNodeInUnclosedChatTurn } from "./parent-stamp.ts";
import {
  getState,
  getToolViewMode,
  getViewOverride,
  isGroupExpanded,
  setGroupExpanded,
  setViewOverride,
  type ToolViewMode,
} from "./state.ts";
import { isCollapsibleTool } from "./tool-titles.ts";

/** Self-shell tools (MCP compact) have no Box padding — indent the chrome child. */
export function chromePadForRenderShell(
  shell: "self" | "default",
  explicitPad?: number,
): number {
  if (typeof explicitPad === "number") return explicitPad;
  return shell === "self" ? RESPONSE_LEFT_PAD : 0;
}

export function toolChromeKind(status: {
  running: boolean;
  isError: boolean;
}): ChromeKind {
  if (status.running) return "tool_run";
  if (status.isError) return "tool_err";
  return "tool_ok";
}

export function effectiveToolMode(target: object, toolName: string): ToolViewMode {
  if (isCodemodeTool(toolName)) {
    const t = target as {
      isPartial?: boolean;
      result?: { isError?: boolean; details?: unknown };
    };
    const running =
      "isPartial" in t ? Boolean(t.isPartial || t.result == null) : t.result == null;
    const calls = extractCodemodeCalls(t.result?.details);
    const isError = !running && t.result?.isError === true;
    const inUnclosedTurn = isNodeInUnclosedChatTurn(target);
    const autoTree = isCodemodeAutoTree(calls, {
      running,
      inUnclosedTurn,
      isError,
    });
    const { level } = resolveCodemodeDisplay({
      globalMode: getToolViewMode(),
      override: getViewOverride(target),
      autoTree,
    });
    if (level === "collapsed") return "chrome";
    if (level === "calls") return "truncated";
    return "full";
  }
  if (toolName === "write") {
    const mode = getViewOverride(target) ?? getToolViewMode();
    return mode === "chrome" ? "truncated" : mode;
  }
  if (!isCollapsibleTool(toolName)) return "full";
  return getViewOverride(target) ?? getToolViewMode();
}

/** Register a body-click fold target for native preview tools (write). */
export function nativePreviewFoldId(
  target: object,
  toolName: string,
): string | undefined {
  if (toolName !== "write") return undefined;
  const id = idForTarget(target);
  registerFoldHandler(id, () => {
    toggleToolAt(target, toolName);
  });
  return id;
}

function codemodeHasTreeRows(target: object): boolean {
  const t = target as {
    isPartial?: boolean;
    result?: { isError?: boolean; details?: unknown };
  };
  const running =
    "isPartial" in t ? Boolean(t.isPartial || t.result == null) : t.result == null;
  if (running) return true;
  const calls = extractCodemodeCalls(t.result?.details);
  if (calls.length > 1) return true;
  if (calls.length === 1) {
    // One finished healthy call renders no tree row (it would only repeat the
    // chrome title), so the calls view has nothing to show: skip to "full".
    return calls[0]!.status !== "ok" || t.result?.isError === true;
  }
  return t.result?.isError === true;
}

export function codemodeBodyFoldId(target: object): string {
  return `${idForTarget(target)}:b`;
}

export function toggleToolAt(target: object, toolName: string): ToolViewMode {
  let next = nextToolFoldMode(toolName, effectiveToolMode(target, toolName));
  if (isCodemodeTool(toolName) && next === "truncated" && !codemodeHasTreeRows(target)) {
    next = "full";
  }
  setViewOverride(target, next);
  const updater = target as { updateDisplay?: () => void; rebuild?: () => void };
  try {
    if (typeof updater.updateDisplay === "function") updater.updateDisplay();
    else updater.rebuild?.();
  } catch {
    /* render will pick up the override */
  }
  return next;
}

/**
 * Title-bar click handler: for expanded codemode ("calls" or "full"), clicking
 * the title directly collapses back to 1-line chrome; when already collapsed,
 * clicking the title expands it. Lower region keeps the 3-state cycle via toggleToolAt.
 */
export function toggleToolTitleAt(target: object, toolName: string): ToolViewMode {
  if (isCodemodeTool(toolName) && effectiveToolMode(target, toolName) !== "chrome") {
    setViewOverride(target, "chrome");
    const updater = target as { updateDisplay?: () => void; rebuild?: () => void };
    try {
      if (typeof updater.updateDisplay === "function") updater.updateDisplay();
      else updater.rebuild?.();
    } catch {
      /* render will pick up the override */
    }
    return "chrome";
  }
  return toggleToolAt(target, toolName);
}

export function toggleGroupAt(header: object): boolean {
  const next = !isGroupExpanded(header);
  setGroupExpanded(header, next);
  const updater = header as { updateDisplay?: () => void };
  try {
    updater.updateDisplay?.();
  } catch {
    /* render will pick up the override */
  }
  return next;
}

export function classifySibling(c: unknown): GroupSibling {
  if (
    c &&
    typeof c === "object" &&
    typeof (c as { lines?: unknown }).lines === "number" &&
    typeof (c as { render?: unknown }).render === "function"
  ) {
    return { kind: "gap" };
  }
  if (
    c &&
    typeof c === "object" &&
    typeof (c as { toolName?: unknown }).toolName === "string" &&
    typeof (c as { updateDisplay?: unknown }).updateDisplay === "function"
  ) {
    return { kind: "tool", toolName: (c as { toolName: string }).toolName };
  }
  return { kind: "other" };
}

export type CollapsibleTool = {
  toolName: string;
  updateDisplay: () => void;
};

export function collapsibleRun(
  siblings: unknown[],
  index: number,
): { members: CollapsibleTool[]; header: CollapsibleTool; isHeader: boolean } {
  const self = siblings[index] as CollapsibleTool | undefined;
  const fallback = {
    members: self ? [self] : [],
    header: self as CollapsibleTool,
    isHeader: true,
  };
  if (
    !self ||
    typeof self.toolName !== "string" ||
    getToolViewMode() !== "chrome" ||
    !isGroupableTool(self.toolName)
  ) {
    return fallback;
  }
  const selfKind = classifySibling(self);
  if (selfKind.kind !== "tool" || !isGroupableTool(selfKind.toolName)) {
    return fallback;
  }

  let start = index;
  while (start > 0) {
    const prev = classifySibling(siblings[start - 1]);
    if (prev.kind === "gap" || (prev.kind === "tool" && isGroupableTool(prev.toolName))) {
      start -= 1;
      continue;
    }
    break;
  }
  let end = index;
  while (end + 1 < siblings.length) {
    const next = classifySibling(siblings[end + 1]);
    if (next.kind === "gap" || (next.kind === "tool" && isGroupableTool(next.toolName))) {
      end += 1;
      continue;
    }
    break;
  }

  const members: CollapsibleTool[] = [];
  for (let i = start; i <= end; i++) {
    const c = siblings[i];
    const kind = classifySibling(c);
    if (kind.kind === "tool" && isGroupableTool(kind.toolName)) {
      members.push(c as CollapsibleTool);
    }
  }
  if (members.length < 2) return fallback;
  return {
    members,
    header: members[0]!,
    isHeader: members[0] === self,
  };
}

export function renderToolChromeLine(
  width: number,
  theme: ChromeTheme,
  opts: {
    target: object;
    toolName: string;
    kind: ChromeKind;
    label: string;
    failedSuffix?: string;
    groupHeader?: boolean;
  },
): string {
  const id = opts.groupHeader ? groupFoldId(opts.target) : idForTarget(opts.target);
  const onClick = opts.groupHeader
    ? () => {
        toggleGroupAt(opts.target);
      }
    : () => {
        toggleToolTitleAt(opts.target, opts.toolName);
      };
  return renderClickableChrome(width, theme, {
    kind: opts.kind,
    label: opts.label,
    failedSuffix: opts.failedSuffix,
    hintKind: "tool",
    id,
    onClick,
  });
}

/** Width-aware chrome child for Box/self-render containers. */
export function clickableChromeChild(
  theme: ChromeTheme,
  opts: {
    target: object;
    toolName: string;
    kind: ChromeKind;
    label: string;
    failedSuffix?: string;
    groupHeader?: boolean;
    pad?: number;
  },
): { render(width: number): string[]; invalidate(): void } {
  const pad = opts.pad ?? 0;
  const sp = pad > 0 ? " ".repeat(pad) : "";
  const id = opts.groupHeader ? groupFoldId(opts.target) : idForTarget(opts.target);
  const onClick = opts.groupHeader
    ? () => {
        toggleGroupAt(opts.target);
      }
    : () => {
        toggleToolTitleAt(opts.target, opts.toolName);
      };

  let cachedWidth: number | undefined;
  let cachedTuiMode: string | undefined;
  let cachedClickFoldReady: boolean | undefined;
  let cachedHovered: boolean | undefined;
  let cachedThemeSample: string | undefined;
  let cachedLines: string[] | undefined;

  return {
    render(width: number) {
      // Keep click dispatch alive across session-level resetFoldHandlers().
      registerFoldHandler(id, onClick);
      const state = getState();
      const hovered =
        state.tuiMode === "fullscreen" &&
        state.clickFoldReady &&
        state.hoveredFoldId === id;
      const themeSample = theme.fg("muted", "m");
      if (
        cachedLines &&
        cachedWidth === width &&
        cachedTuiMode === state.tuiMode &&
        cachedClickFoldReady === state.clickFoldReady &&
        cachedHovered === hovered &&
        cachedThemeSample === themeSample
      ) {
        return cachedLines;
      }
      const inner = Math.max(1, width - pad);
      const line =
        sp +
        renderClickableChrome(inner, theme, {
          kind: opts.kind,
          label: opts.label,
          failedSuffix: opts.failedSuffix,
          hintKind: "tool",
          id,
          onClick,
        });
      cachedWidth = width;
      cachedTuiMode = state.tuiMode;
      cachedClickFoldReady = state.clickFoldReady;
      cachedHovered = hovered;
      cachedThemeSample = themeSample;
      cachedLines = [line];
      return cachedLines;
    },
    invalidate() {
      cachedLines = undefined;
      cachedWidth = undefined;
      cachedThemeSample = undefined;
    },
  };
}
