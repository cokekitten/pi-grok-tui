/**
 * Body click-to-collapse — OSC 8-free row registry.
 *
 * Windows Terminal and xterm.js (wetty) render every OSC 8 hyperlink with a
 * persistent dotted underline that cannot be disabled (SGR 24m has no effect),
 * so emitting fold links on every expanded body row turns the whole screen
 * into horizontal dashed lines on those terminals.
 *
 * Instead we never emit OSC 8 for grok folds. Rendering hooks register the
 * *final row text* (normalized: ANSI stripped, whitespace trimmed) → fold id.
 * On a mouse *press*, TuiAltScreen's intercepted handler temporarily injects
 * the fold hyperlink into the `previousScreen` row buffer pi already consults
 * for `pressedUrl`; PI resolves the URL, the release triggers the fold exactly
 * as before. The injected row is restored in a `finally`, so nothing OSC 8
 * ever reaches the screen — no underlines on any terminal.
 *
 * Collisions: a normalized row registered by 2+ different fold ids resolves to
 * no-op (safe), so identical repeated command echoes stay inert.
 */
import { Text } from "@earendil-works/pi-tui";
import { getState } from "./state.ts";

/** normalized row text → fold ids that registered it */
const rowRegistry = new Map<string, Set<string>>();

export function clearFoldRegistry(): void {
  rowRegistry.clear();
}

export function normalizeFoldRow(line: string): string {
  // Compact trivial ANSI (SGR) escapes; OSC sequences do not appear in rows
  // we render (grok folds are OSC 8-free by design).
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

export function registerFoldRow(line: string, id: string): void {
  const key = normalizeFoldRow(line);
  if (!key) return;
  let ids = rowRegistry.get(key);
  if (!ids) {
    ids = new Set();
    rowRegistry.set(key, ids);
  }
  ids.add(id);
}

/** Resolve a press row to a fold id. Ambiguous (2+ ids) ⇒ no-op. */
export function lookupFoldRow(line: string): string | undefined {
  const ids = rowRegistry.get(normalizeFoldRow(line));
  if (!ids || ids.size !== 1) return undefined;
  return ids.values().next().value as string | undefined;
}

/** Mark a Text instance (e.g. contentText that holds title+body rows). */
export function markBodyFold(node: object, id: string): void {
  textInstances.set(node, id);
}

export function unmarkBodyFold(node: object): void {
  textInstances.delete(node);
}

/** Mark Text leaves under `root` as fold rows (skip titled chrome + nested tools). */
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
    registerTextInstance(n, id);
  }
  if (Array.isArray(n.children)) {
    for (const c of n.children) {
      markBodyFoldDeep(c, id, skipMarks, depth + 1);
    }
  }
}

const textInstances = new WeakMap<object, string>();

function registerTextInstance(node: object, id: string): void {
  textInstances.set(node, id);
}

/** Patch pi Text rendering: marked instances register their rows for press lookup. */
export function installFoldBodyTextPatch(): () => void {
  const proto = Text.prototype as unknown as {
    render?: (width: number) => string[];
  };
  const original = proto.render;
  if (typeof original !== "function") return () => {};
  proto.render = function (this: object, width: number): string[] {
    const lines = original.call(this, width);
    const id = textInstances.get(this);
    if (!id) return lines;
    for (const line of lines) {
      registerFoldRow(line, id);
    }
    return lines;
  };
  return () => {
    proto.render = original;
  };
}
