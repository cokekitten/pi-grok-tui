/**
 * Fullscreen previous-message jump float — one strip at the top of the
 * transcript viewport showing the most recent user message scrolled past.
 *
 * Clicking aligns the user block's top padding with the viewport; the strip
 * covers that empty row while the message text remains visible below it.
 * Display-only: one viewport row, hidden while real dialogs/search are open. Fail-soft — any missing seam just
 * means no strip.
 */
import { sliceByColumn, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { ansiBgHex, ansiFgHex } from "./chrome.ts";
import { registerFoldHandler } from "./click-fold.ts";
import { HOVER_BG, parseFoldMarker, withFoldMarker } from "./fold-body.ts";
import { findUserMessageTarget, formatStrip } from "./prompt-jump-core.ts";
import { getState } from "./state.ts";
import {
  USER_MESSAGE_ARROW_FG,
  USER_MESSAGE_BG,
} from "./user-message-style.ts";

/** Stable fold id — re-registered every paint with a fresh jump closure. */
const STRIP_ID = "prompt-jump";
const HOVER_BG_HEX = `#${[HOVER_BG.r, HOVER_BG.g, HOVER_BG.b]
  .map(n => n.toString(16).padStart(2, "0")).join("")}`;

type RectLike = { x: number; y: number; width: number; height: number };

type LayoutBoxLike = {
  rect?: RectLike;
  clip?: RectLike;
  children?: LayoutBoxLike[];
  scrollView?: unknown;
  scrollContentLines?: readonly string[];
};

type ScrollViewLike = {
  scrollTop?: unknown;
  isScrollbarVisible?: boolean;
  scrollTo?: (top: number, options?: { disableFollow?: boolean }) => void;
};

type MouseEvent = { x: number; y: number; button: number; release?: boolean };
type StripBounds = { row: number; width: number };
type AltScreenHost = {
  isFollowingOutput?: boolean;
  requestRender?: (force?: boolean) => void;
  hasOverlay?: () => boolean;
  previousScreen?: string[];
  mouseCapture?: unknown;
  mousePressTarget?: unknown;
  handleSelectionMouseEvent?: (event: MouseEvent) => unknown;
};

function findScrollBox(
  node: LayoutBoxLike | undefined,
  scrollView: unknown,
): LayoutBoxLike | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (node.scrollView === scrollView) return node;
  for (const child of node.children ?? []) {
    const hit = findScrollBox(child, scrollView);
    if (hit) return hit;
  }
  return undefined;
}

/** Bubble strip: purple `❯`, faint body, full-width #0f1217 bg (bright on hover). */
function styleStrip(text: string, width: number, hovered: boolean): string {
  const arrow = text.startsWith("\u276f")
    ? ansiFgHex(USER_MESSAGE_ARROW_FG, "\u276f")
    : "";
  const rest = text.slice(arrow ? 1 : 0);
  const body = hovered ? arrow + rest : arrow + "\x1b[2m" + rest + "\x1b[22m";
  const pad = " ".repeat(Math.max(0, width - visibleWidth(text)));
  return ansiBgHex(hovered ? HOVER_BG_HEX : USER_MESSAGE_BG, body + pad);
}

function paintPromptJump(
  host: AltScreenHost,
  screen: string[],
  layout: unknown,
): StripBounds | undefined {
  try {
    const state = getState();
    if (state.tuiMode !== "fullscreen" || !state.clickFoldReady || host.hasOverlay?.()) return;
    const frame = layout as
      | { primaryScrollView?: unknown; root?: LayoutBoxLike }
      | undefined;
    const scrollView = frame?.primaryScrollView;
    if (!scrollView || !frame?.root) return;
    // Only while scrolled away from the end; `undefined` (old pi) → no strip.
    if (host.isFollowingOutput !== false) return;

    const box = findScrollBox(frame.root, scrollView);
    const lines = box?.scrollContentLines;
    const rect = box?.rect;
    if (!lines || !rect || rect.x !== 0) return;
    const clip = box.clip ?? rect;
    if (clip.x !== 0 || clip.height <= 0) return;

    const scrollTop = (scrollView as ScrollViewLike).scrollTop;
    if (typeof scrollTop !== "number") return;
    const target = findUserMessageTarget(lines, scrollTop);
    if (target === undefined) return;

    const row = Math.max(rect.y, clip.y);
    if (row < 0 || row >= screen.length) return;
    if (row >= clip.y + clip.height) return;

    const scrollbar = (scrollView as ScrollViewLike).isScrollbarVisible ? 1 : 0;
    const width = Math.min(rect.width - scrollbar, clip.width);
    if (width < 4) return;
    // /reload can retain user components built with native (arrowless) bodies.
    const preview = target.preview.startsWith("❯") ? target.preview : `❯ ${target.preview}`;
    const text = formatStrip(preview, width);
    if (!text) return;

    registerFoldHandler(STRIP_ID, () => {
      try {
        (scrollView as ScrollViewLike).scrollTo?.(target.row, {
          disableFollow: true,
        });
        host.requestRender?.();
      } catch {
        /* ignore */
      }
    });
    const hovered = state.hoveredFoldId === STRIP_ID;
    // Keep the scrollbar cell. compositeTuiLine adds an OSC 8 close BEFORE
    // the strip, which would immediately cancel click-fold's press-only link.
    // Put the segment reset AFTER the strip instead, bounding its hit area.
    const suffix = sliceByColumn(screen[row] ?? "", width, Math.max(0, rect.width - width), true);
    screen[row] = withFoldMarker(styleStrip(text, width, hovered), STRIP_ID, width)
      + "\x1b[0m\x1b]8;;\x07" + suffix;
    return { row, width };
  } catch {
    /* never throw out of render */
  }
}

export function installPromptJumpPatch(): () => void {
  const proto = TuiAltScreen.prototype as unknown as {
    applySearchHighlights?: (screen: string[], layout: unknown) => string[];
    handleMouseEvent?: (event: MouseEvent) => unknown;
  };
  // Both wrappers share this install-local map; no cross-jiti-instance state.
  const bounds = new WeakMap<AltScreenHost, StripBounds>();
  const originalMouse = proto.handleMouseEvent;
  const original = proto.applySearchHighlights;
  if (typeof original !== "function") return () => {};
  proto.applySearchHighlights = function (
    this: unknown,
    screen: string[],
    layout: unknown,
  ): string[] {
    const out = original.call(this, screen, layout) ?? screen;
    const host = this as AltScreenHost;
    bounds.delete(host);
    const strip = paintPromptJump(host, out, layout);
    if (strip) bounds.set(host, strip);
    return out;
  };
  if (typeof originalMouse === "function") {
    proto.handleMouseEvent = function (this: AltScreenHost, event: MouseEvent) {
      const strip = bounds.get(this);
      const button = event.button & 3;
      const primaryOrHover = button === 0 || (button === 3 && ((event.button & 32) !== 0 || event.release));
      // A painted float wins over any MouseRegion/tool body underneath, but
      // not dialogs, scrollbar cells, or an existing component drag capture.
      if (strip && primaryOrHover && !this.hasOverlay?.() && !this.mouseCapture && !this.mousePressTarget
        && event.y === strip.row && event.x >= 0 && event.x < strip.width
        && parseFoldMarker(this.previousScreen?.[event.y] ?? "") === STRIP_ID
        && typeof this.handleSelectionMouseEvent === "function") {
        return this.handleSelectionMouseEvent(event);
      }
      return originalMouse.call(this, event);
    };
  }
  return () => {
    proto.applySearchHighlights = original;
    if (typeof originalMouse === "function") proto.handleMouseEvent = originalMouse;
    registerFoldHandler(STRIP_ID, () => {});
    if (getState().hoveredFoldId === STRIP_ID) getState().hoveredFoldId = undefined;
  };
}
