/**
 * Body click-to-collapse — OSC 8-free fold identity painted into the row.
 *
 * Windows Terminal and xterm.js (wetty) render every OSC 8 hyperlink with a
 * persistent dotted underline that cannot be disabled. Grok Build's pager
 * avoids that by recording hit identity with the painted cells and routing
 * mouse-down against those cells (no hyperlinks on screen).
 *
 * We do the same in pi: a private OSC 9999 marker (zero-width, ignored by
 * terminals that don't implement it) carries the fold id. On press,
 * TuiAltScreen's seam reads the marker from `previousScreen[y]`, injects an
 * OSC 8 hyperlink into that *buffer* for the duration of pi's pressedUrl
 * lookup, then restores. The screen never receives OSC 8.
 *
 * Markers also survive pi's per-line SEGMENT_RESET (`ESC[0m` + OSC 8 close)
 * which made text-registry lookup miss every click.
 */
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { getState } from "./state.ts";

const FOLD_MARKER_RE =
  /\x1b\]9999;pi-grok-tui\/v1\/fold\/([A-Za-z0-9:_-]+)\x07/;

/** Grok Build groknight `bg_hover` — whole-block hover wash. */
export const HOVER_BG = { r: 44, g: 44, b: 44 } as const;

export function foldMarker(id: string): string {
  return `\x1b]9999;pi-grok-tui/v1/fold/${id}\x07`;
}

/** Extract the fold id painted into a rendered (or previousScreen) row. */
export function parseFoldMarker(line: string): string | undefined {
  const m = FOLD_MARKER_RE.exec(line);
  return m?.[1];
}

function paintHoverBg(line: string, width?: number): string {
  const open = `\x1b[48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}m`;
  const close = "\x1b[49m";
  if (typeof width === "number" && width > 0) {
    const pad = Math.max(0, width - visibleWidth(line));
    return open + line + " ".repeat(pad) + close;
  }
  return open + line + close;
}

/**
 * Prefix a final render row with the fold marker (gated; empty rows skipped).
 * When `hoveredFoldId` matches, wash the row with HOVER_BG (Grok-style block hover).
 */
export function withFoldMarker(line: string, id: string, width?: number): string {
  const state = getState();
  if (state.tuiMode !== "fullscreen" || !state.clickFoldReady) return line;
  if (line.trim() === "") return line;
  const body =
    state.hoveredFoldId === id ? paintHoverBg(line, width) : line;
  if (parseFoldMarker(body) === id) return body;
  return foldMarker(id) + body;
}

/** Session reset: markers live in painted rows, so there is nothing to drop. */
export function clearFoldRegistry(): void {}

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

/** Patch pi Text rendering: marked instances paint fold markers on output rows. */
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
    return lines.map((l) => withFoldMarker(l, id, width));
  };
  return () => {
    proto.render = original;
  };
}
