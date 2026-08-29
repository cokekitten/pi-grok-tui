/**
 * Body click-to-collapse: expanded body rows share the chrome title's fold
 * OSC 8, so an unmoved click anywhere inside the expanded block folds it —
 * no need to hit the title row again.
 *
 * Two seams:
 * - ThinkingScrollComponent emits its own body lines → wrapFoldBodyLine().
 * - Tool / custom-message bodies are pi `Text` instances → Text.prototype.render
 *   is patched to wrap rows of marked instances at *output* time (after pi's
 *   own wrapping/truncation produced final rows, so OSC 8 is never cut).
 *
 * Gating mirrors renderClickableChrome: only in fullscreen while the
 * TuiAltScreen click intercept is installed (clickFoldReady). Because the wrap
 * happens per render, Box/Text caches always eventually converge — a mode
 * switch changes the wrapped output, which breaks the cache match and repaints
 * clean lines with no leftover OSC 8 in regular mode.
 */
import { hyperlink, Text } from "@earendil-works/pi-tui";
import { foldUrl } from "./click-fold-core.ts";
import { getState } from "./state.ts";

const bodyFoldIds = new WeakMap<object, string>();

export function markBodyFold(node: object, id: string): void {
  bodyFoldIds.set(node, id);
}

export function unmarkBodyFold(node: object): void {
  bodyFoldIds.delete(node);
}

export function bodyFoldIdOf(node: object): string | undefined {
  return bodyFoldIds.get(node);
}

/**
 * Wrap one final render row with the fold OSC 8 (gated; empty rows skipped —
 * they have no visible cells pi can hit, the link would be dead weight).
 */
export function wrapFoldBodyLine(line: string, id: string): string {
  const state = getState();
  if (state.tuiMode !== "fullscreen" || !state.clickFoldReady) return line;
  if (line.trim() === "") return line;
  try {
    return hyperlink(line, foldUrl(id));
  } catch {
    return line;
  }
}

/**
 * Mark Text leaves under `root` as fold bodies. Skips titled chrome rows
 * (already clickable via their own chrome link) and nested tools.
 */
export function markBodyFoldDeep(
  root: unknown,
  id: string,
  skipMarks: string[],
  depth = 0,
): void {
  if (!root || typeof root !== "object" || depth > 10) return;
  const n = root as Record<string, unknown> & {
    text?: string;
    setText?: unknown;
    children?: unknown[];
    toolName?: string;
    updateDisplay?: unknown;
  };
  for (const m of skipMarks) {
    if (n[m]) return;
  }
  // Do not recurse into nested tools.
  if (typeof n.toolName === "string" && typeof n.updateDisplay === "function" && depth > 0) {
    return;
  }
  if (typeof n.setText === "function" && typeof n.text === "string") {
    markBodyFold(n, id);
  }
  if (Array.isArray(n.children)) {
    for (const c of n.children) {
      markBodyFoldDeep(c, id, skipMarks, depth + 1);
    }
  }
}

/** Patch pi Text rendering: marked instances get body rows linked. */
export function installFoldBodyTextPatch(): () => void {
  const proto = Text.prototype as unknown as {
    render?: (width: number) => string[];
  };
  const original = proto.render;
  if (typeof original !== "function") return () => {};
  proto.render = function (this: object, width: number): string[] {
    const lines = original.call(this, width);
    const id = bodyFoldIds.get(this);
    if (!id) return lines;
    return lines.map((l) => wrapFoldBodyLine(l, id));
  };
  return () => {
    proto.render = original;
  };
}
