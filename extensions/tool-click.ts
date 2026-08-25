/**
 * Per-tool / group click fold helpers.
 */
import type { ChromeKind, ChromeTheme } from "./chrome.ts";
import { groupRunRange, nextToolFoldMode, type GroupSibling } from "./click-fold-core.ts";
import {
  groupFoldId,
  idForTarget,
  renderClickableChrome,
} from "./click-fold.ts";
import {
  getToolViewMode,
  getViewOverride,
  isGroupExpanded,
  setGroupExpanded,
  setViewOverride,
  type ToolViewMode,
} from "./state.ts";
import { isCollapsibleTool } from "./tool-titles.ts";

export function effectiveToolMode(target: object, toolName: string): ToolViewMode {
  if (!isCollapsibleTool(toolName)) return "full";
  return getViewOverride(target) ?? getToolViewMode();
}

export function toggleToolAt(target: object, toolName: string): ToolViewMode {
  const next = nextToolFoldMode(toolName, effectiveToolMode(target, toolName));
  setViewOverride(target, next);
  const updater = target as { updateDisplay?: () => void; rebuild?: () => void };
  try {
    updater.updateDisplay?.();
    updater.rebuild?.();
  } catch {
    /* render will pick up the override */
  }
  return next;
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
  if (!self || typeof self.toolName !== "string") return fallback;
  const classified = siblings.map(classifySibling);
  const range = groupRunRange(
    classified,
    index,
    getToolViewMode() === "chrome",
  );
  if (!range) return fallback;
  const members: CollapsibleTool[] = [];
  for (let i = range.start; i <= range.end; i++) {
    const c = siblings[i];
    const kind = classified[i];
    if (kind?.kind === "tool" && isCollapsibleTool(kind.toolName)) {
      members.push(c as CollapsibleTool);
    }
  }
  if (members.length === 0) return fallback;
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
        toggleToolAt(opts.target, opts.toolName);
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
  return {
    render(width: number) {
      const inner = Math.max(1, width - pad);
      return [
        sp +
          renderToolChromeLine(inner, theme, {
            target: opts.target,
            toolName: opts.toolName,
            kind: opts.kind,
            label: opts.label,
            failedSuffix: opts.failedSuffix,
            groupHeader: opts.groupHeader,
          }),
      ];
    },
    invalidate() {},
  };
}
