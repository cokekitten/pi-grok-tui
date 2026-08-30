/**
 * Pure click-to-expand helpers (URI, hints, fold modes, group runs).
 * No TUI imports so node:test can load this without a pi session.
 */
import { THINKING_EXPAND_HINT } from "./thinking-keys.ts";
import type { ToolViewMode } from "./state.ts";
import { isCollapsibleTool } from "./tool-titles.ts";

export const FOLD_SCHEME = "pi-grok-tui:";
const FOLD_PREFIX = "pi-grok-tui://v1/fold/";

export function foldUrl(id: string): string {
  return `${FOLD_PREFIX}${id}`;
}

export function isGrokFoldScheme(url: string): boolean {
  return typeof url === "string" && url.startsWith(FOLD_SCHEME);
}

export function parseFoldId(url: string): string | undefined {
  if (!url.startsWith(FOLD_PREFIX)) return undefined;
  const id = url.slice(FOLD_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

export function chromeHint(
  kind: "thinking" | "tool",
  opts: { tuiMode: "fullscreen" | "regular"; clickFoldReady: boolean },
): string | undefined {
  if (opts.tuiMode === "fullscreen" && opts.clickFoldReady) return undefined;
  return kind === "thinking" ? THINKING_EXPAND_HINT : " (Ctrl+O)";
}

export function isThinkingExpanded(
  timestamp: number,
  globalExpanded: boolean,
  overrides: Map<number, boolean>,
): boolean {
  return overrides.has(timestamp) ? overrides.get(timestamp)! : globalExpanded;
}

export function nextThinkingExpanded(currentlyExpanded: boolean): boolean {
  return !currentlyExpanded;
}

export function nextToolFoldMode(
  toolName: string,
  current: ToolViewMode,
): ToolViewMode {
  // Native write preview (10 lines) ↔ full; never title-only chrome.
  if (toolName === "write") return current === "full" ? "truncated" : "full";
  if (!isCollapsibleTool(toolName)) return current;
  if (current === "chrome") return toolName === "read" ? "truncated" : "full";
  return "chrome";
}

export type GroupSibling =
  | { kind: "tool"; toolName: string }
  | { kind: "gap" }
  | { kind: "other" };

export function groupRunRange(
  siblings: GroupSibling[],
  index: number,
  groupable: boolean,
): { start: number; end: number } | undefined {
  if (!groupable) return undefined;
  const self = siblings[index];
  if (!self || self.kind !== "tool" || !isCollapsibleTool(self.toolName)) {
    return undefined;
  }
  const isMember = (c: GroupSibling | undefined) =>
    c?.kind === "tool" && isCollapsibleTool(c.toolName);
  let start = index;
  while (start > 0) {
    const prev = siblings[start - 1];
    if (prev?.kind === "gap") {
      start -= 1;
      continue;
    }
    if (isMember(prev)) {
      start -= 1;
      continue;
    }
    break;
  }
  let end = index;
  while (end + 1 < siblings.length) {
    const next = siblings[end + 1];
    if (next?.kind === "gap") {
      end += 1;
      continue;
    }
    if (isMember(next)) {
      end += 1;
      continue;
    }
    break;
  }
  const first = siblings.findIndex(
    (c, i) => i >= start && i <= end && isMember(c),
  );
  let last = first;
  for (let i = start; i <= end; i++) {
    if (isMember(siblings[i])) last = i;
  }
  if (first < 0 || last === first) return undefined;
  return { start: first, end: last };
}
