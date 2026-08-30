/**
 * Fullscreen click-to-expand: OSC 8 chrome targets + TUI mouse intercept.
 */
import {
  hyperlink,
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  TuiAltScreen,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import {
  formatChromeLine,
  type ChromeKind,
  type ChromeTheme,
} from "./chrome.ts";
import {
  chromeHint,
  foldUrl,
  isGrokFoldScheme,
  parseFoldId,
} from "./click-fold-core.ts";
import { installFoldBodyTextPatch, parseFoldMarker, withFoldMarker } from "./fold-body.ts";
import { isHitAt, parseHitSpan } from "./jump-bottom-core.ts";
import { getState } from "./state.ts";

const handlers = new Map<string, () => void>();
const targetIds = new WeakMap<object, string>();
let nextId = 1;

export function resetFoldHandlers(): void {
  handlers.clear();
}

export function registerFoldHandler(id: string, handler: () => void): void {
  handlers.set(id, handler);
}

export function dispatchGrokFoldUrl(url: string): boolean {
  if (!isGrokFoldScheme(url)) return false;
  const id = parseFoldId(url);
  if (id) {
    const handler = handlers.get(id);
    if (handler) {
      try {
        handler();
      } catch {
        /* swallow — never openBrowser a pi-grok-tui URL */
      }
    }
  }
  return true;
}

export function newFoldId(): string {
  const id = `f${nextId}`;
  nextId += 1;
  return id;
}

export function idForTarget(target: object): string {
  const existing = targetIds.get(target);
  if (existing) return existing;
  const id = newFoldId();
  targetIds.set(target, id);
  return id;
}

export function thinkingFoldId(timestamp: number): string {
  return `think-${timestamp}`;
}

export function groupFoldId(header: object): string {
  return `${idForTarget(header)}:g`;
}

type OpenUrlHost = {
  openUrl?: (url: string) => void;
  requestRender?: (force?: boolean) => void;
};

/** Motion / leave: set hoveredFoldId from the marked row at y. Returns true if it changed. */
export function handleFoldHover(
  rows: unknown[] | undefined,
  y: number | undefined,
  x?: number,
): boolean {
  const state = getState();
  if (!state.clickFoldReady || state.tuiMode !== "fullscreen") return false;
  let next: string | undefined;
  if (
    Array.isArray(rows) &&
    rows.length > 0 &&
    typeof y === "number" &&
    Number.isFinite(y)
  ) {
    const idx = Math.max(0, Math.min(rows.length - 1, y));
    const row = rows[idx];
    if (typeof row === "string") {
      const span = parseHitSpan(row);
      if (span && isHitAt(span, x ?? Number.NaN)) next = span.id;
      else next = parseFoldMarker(row);
    }
  }
  if (state.hoveredFoldId === next) return false;
  state.hoveredFoldId = next;
  return true;
}

/** Inject OSC 8 only across a bounded hit span (pill), not the whole row. */
export function injectHitSpan(
  rows: unknown[] | undefined,
  y: number,
  x: number | undefined,
): (() => void) | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  const idx = Math.max(0, Math.min(rows.length - 1, y));
  const row = rows[idx];
  if (typeof row !== "string") return undefined;
  const span = parseHitSpan(row);
  if (!span || !isHitAt(span, x)) return undefined;
  const saved = row;
  const core = row.replace(/\x1b\[0m\x1b\]8;;(?:\x07|\x1b\\)$/, "");
  const before = sliceByColumn(core, 0, span.startCol, true);
  const pill = sliceByColumn(core, span.startCol, span.width, true);
  const after = sliceByColumn(core, span.startCol + span.width, 10000, true);
  // Temporary press buffer is never painted. Strip OSC 8 / ANSI inside the pill
  // so a SEGMENT_RESET close from compositeTuiLine cannot cancel the new link.
  rows[idx] = before + hyperlink(stripTerminalSequences(pill), foldUrl(span.id)) + after;
  return () => {
    rows[idx] = saved;
  };
}

/**
 * Temporarily inject the fold hyperlink for the row at `y` into a frame-buffer
 * row array (pi's previousScreen). Returns a restore function, or undefined
 * when the row is not a registered fold row.
 */
export function injectFoldRow(
  rows: unknown[] | undefined,
  y: number,
): (() => void) | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const idx = Math.max(0, Math.min(rows.length - 1, y));
  const row = rows[idx];
  if (typeof row !== "string") return undefined;
  const id = parseFoldMarker(row);
  if (!id) return undefined;
  const saved = row;
  // pi appends SEGMENT_RESET (`ESC[0m` + OSC 8 close) to every previousScreen
  // row. Strip it so the injected hyperlink stays open across the visible cells.
  const core = row.replace(/\x1b\[0m\x1b\]8;;(?:\x07|\x1b\\)$/, "");
  rows[idx] = hyperlink(core, foldUrl(id));
  return () => {
    rows[idx] = saved;
  };
}

/** Swap openUrl for the duration of `fn` so grok fold URLs never hit the browser. */
export function withFoldOpenUrl<T>(host: OpenUrlHost, fn: () => T): T {
  const previous = host.openUrl;
  host.openUrl = (url: string) => {
    if (dispatchGrokFoldUrl(url)) {
      try {
        host.requestRender?.();
      } catch {
        /* ignore */
      }
      return;
    }
    previous?.(url);
  };
  try {
    return fn();
  } finally {
    host.openUrl = previous;
  }
}

export function renderClickableChrome(
  width: number,
  theme: ChromeTheme,
  opts: {
    kind: ChromeKind;
    label: string;
    failedSuffix?: string;
    hintKind: "thinking" | "tool";
    id?: string;
    onClick?: () => void;
  },
): string {
  const state = getState();
  const hint = chromeHint(opts.hintKind, {
    tuiMode: state.tuiMode,
    clickFoldReady: state.clickFoldReady,
  });
  const styled = formatChromeLine(theme, {
    kind: opts.kind,
    label: opts.label,
    failedSuffix: opts.failedSuffix,
    hint,
  });
  const truncated = truncateToWidth(styled, Math.max(1, width), "");
  const clickable =
    typeof opts.id === "string" &&
    opts.id.length > 0 &&
    typeof opts.onClick === "function";
  if (!clickable) return truncated;
  registerFoldHandler(opts.id!, opts.onClick!);
  // Paint a zero-width OSC 9999 marker (not a hyperlink) so press lookup
  // survives pi's per-line SEGMENT_RESET without drawing underlines.
  return withFoldMarker(truncated, opts.id!, width);
}

function wrapDoRender(
  Ctor: { prototype: { doRender?: () => void } },
  mode: "fullscreen" | "regular",
): (() => void) | undefined {
  const original = Ctor.prototype.doRender;
  if (typeof original !== "function") return undefined;
  Ctor.prototype.doRender = function (this: unknown) {
    const state = getState();
    state.tuiMode = mode;
    if (mode === "regular") state.hoveredFoldId = undefined;
    return original.call(this);
  };
  return () => {
    Ctor.prototype.doRender = original;
  };
}

export function installClickFoldPatch(): () => void {
  const state = getState();
  state.clickFoldReady = false;

  const altProto = TuiAltScreen.prototype as unknown as {
    handleSelectionMouseEvent?: (event: unknown) => unknown;
    handleViewportInput?: (data: string) => unknown;
    doRender?: () => void;
  };
  const originalMouse = altProto.handleSelectionMouseEvent;
  const originalViewport = altProto.handleViewportInput;
  const restoreAltRender = wrapDoRender(TuiAltScreen, "fullscreen");
  const restoreMainRender = wrapDoRender(TuiMainScreen, "regular");

  if (
    typeof originalMouse !== "function" ||
    !restoreAltRender ||
    !restoreMainRender
  ) {
    restoreAltRender?.();
    restoreMainRender?.();
    return () => {
      state.clickFoldReady = false;
    };
  }

  if (typeof originalViewport === "function") {
    altProto.handleViewportInput = function (this: OpenUrlHost, data: string) {
      if (data === "\x1b[O" && handleFoldHover(undefined, undefined)) {
        try {
          this.requestRender?.();
        } catch {
          /* ignore */
        }
      }
      return originalViewport.call(this, data);
    };
  }

  altProto.handleSelectionMouseEvent = function (this: OpenUrlHost, event: unknown) {
    const ev = event as {
      release?: boolean;
      x?: number;
      y?: number;
      button?: number;
    } | undefined;
    const rows = (this as { previousScreen?: unknown[] }).previousScreen;
    const motion = !!(ev && (ev.button ?? 0) & 32);
    const dragging = !!(this as { selectionPressActive?: boolean }).selectionPressActive;
    if (!dragging && ev && typeof ev.y === "number" && (ev.release || motion)) {
      if (handleFoldHover(rows, ev.y, ev.x)) {
        try {
          this.requestRender?.();
        } catch {
          /* ignore */
        }
      }
    }
    // On unmoved press, pi reads getOsc8LinkAtColumn from previousScreen to
    // compute pressedUrl. Inject the fold hyperlink into that buffer for the
    // duration of the call: the press resolves the fold URL, the release
    // dispatches it, and the screen never receives any OSC 8 (no dotted
    // underlines on Windows Terminal / wetty).
    let restoreRow: (() => void) | undefined;
    if (ev && !ev.release && !motion && typeof ev.y === "number") {
      restoreRow = injectHitSpan(rows, ev.y, ev.x) ?? injectFoldRow(rows, ev.y);
    }
    try {
      return withFoldOpenUrl(this, () => originalMouse.call(this, event));
    } finally {
      restoreRow?.();
    }
  };

  // Body fold links are gated on clickFoldReady at render time, so the Text
  // patch is installed even if the mouse seam failed (it is then inert).
  const restoreBodyText = installFoldBodyTextPatch();

  state.clickFoldReady = true;

  return () => {
    restoreBodyText();
    altProto.handleSelectionMouseEvent = originalMouse;
    if (typeof originalViewport === "function") {
      altProto.handleViewportInput = originalViewport;
    }
    restoreAltRender();
    restoreMainRender();
    state.clickFoldReady = false;
    state.hoveredFoldId = undefined;
  };
}
