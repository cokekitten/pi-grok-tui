/**
 * Fullscreen previous-message jump float — one strip at the top of the
 * transcript viewport showing the most recent user message scrolled past.
 *
 * Clicking the strip jumps to that message (first row top-aligned, like pi's
 * `⌥↑ previousPrompt`); the strip then shows the next older user message.
 * Display-only: it repaints one viewport row before overlay compositing, so
 * real dialogs and search still cover it. Fail-soft — any missing seam just
 * means no strip.
 */
import { TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { ansiBgHex, ansiFgHex } from "./chrome.ts";
import { registerFoldHandler } from "./click-fold.ts";
import { HOVER_BG, withFoldMarker } from "./fold-body.ts";
import {
  findPromptRows,
  formatStrip,
  pickFloatTarget,
} from "./prompt-jump-core.ts";
import { getState } from "./state.ts";
import {
  USER_MESSAGE_ARROW_FG,
  USER_MESSAGE_BG,
} from "./user-message-style.ts";

/** Stable fold id — re-registered every paint with a fresh jump closure. */
const STRIP_ID = "prompt-jump";
const HOVER_BG_HEX = "#2c2c2c";

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
  scrollTo?: (top: number, options?: { disableFollow?: boolean }) => void;
};

type AltScreenHost = {
  isFollowingOutput?: boolean;
  requestRender?: (force?: boolean) => void;
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
): void {
  try {
    const state = getState();
    if (state.tuiMode !== "fullscreen") return;
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
    const target = pickFloatTarget(findPromptRows(lines), scrollTop);
    if (target === undefined) return;

    const row = Math.max(rect.y, clip.y);
    if (row < 0 || row >= screen.length) return;
    if (row >= clip.y + clip.height) return;

    const width = Math.min(rect.width, clip.width);
    if (width < 4) return;
    const text = formatStrip(lines[target] ?? "", width);
    if (!text) return;

    registerFoldHandler(STRIP_ID, () => {
      try {
        (scrollView as ScrollViewLike).scrollTo?.(target, {
          disableFollow: true,
        });
        host.requestRender?.();
      } catch {
        /* ignore */
      }
    });
    const hovered = state.hoveredFoldId === STRIP_ID;
    screen[row] = withFoldMarker(
      styleStrip(text, width, hovered),
      STRIP_ID,
      width,
    );
  } catch {
    /* never throw out of render */
  }
}

export function installPromptJumpPatch(): () => void {
  const proto = TuiAltScreen.prototype as unknown as {
    applySearchHighlights?: (screen: string[], layout: unknown) => string[];
  };
  const original = proto.applySearchHighlights;
  if (typeof original !== "function") return () => {};
  proto.applySearchHighlights = function (
    this: unknown,
    screen: string[],
    layout: unknown,
  ): string[] {
    const out = original.call(this, screen, layout) ?? screen;
    paintPromptJump(this as AltScreenHost, out, layout);
    return out;
  };
  return () => {
    proto.applySearchHighlights = original;
  };
}
