/**
 * Per-thinking-block click fold (timestamp-keyed; survives component rebuild).
 */
import type { ChromeTheme } from "./chrome.ts";
import {
  isThinkingExpanded,
  nextThinkingExpanded,
} from "./click-fold-core.ts";
import { renderClickableChrome, thinkingFoldId } from "./click-fold.ts";
import { getState } from "./state.ts";

export function thinkingIsExpanded(timestamp: number): boolean {
  const state = getState();
  return isThinkingExpanded(
    timestamp,
    state.globalExpanded,
    state.thinkingOverrides,
  );
}

export function toggleThinkingAt(timestamp: number): void {
  const state = getState();
  const current = thinkingIsExpanded(timestamp);
  state.thinkingOverrides.set(timestamp, nextThinkingExpanded(current));
}

/** Alt+T / Option+T / Ctrl+Shift+H: global toggle, forget per-row clicks. */
export function applyGlobalThinkingToggle(): boolean {
  const state = getState();
  state.thinkingOverrides.clear();
  state.globalExpanded = !state.globalExpanded;
  return state.globalExpanded;
}

export function renderThinkingChromeLine(
  width: number,
  theme: ChromeTheme,
  timestamp: number,
): string {
  return renderClickableChrome(width, theme, {
    kind: "thinking",
    label: "Thought",
    hintKind: "thinking",
    id: thinkingFoldId(timestamp),
    onClick: () => toggleThinkingAt(timestamp),
  });
}
