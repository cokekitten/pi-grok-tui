/**
 * Fullscreen jump-to-bottom pill: overlay the last visible transcript row
 * when the user has scrolled away from follow-end.
 */
import {
  compositeTuiLine,
  TuiAltScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { ansiBgHex, ansiFgHex } from "./chrome.ts";
import { registerFoldHandler } from "./click-fold.ts";
import {
  hitSpanMarker,
  JUMP_BOTTOM_ID,
  JUMP_BOTTOM_TEXT,
  jumpBottomPlacement,
} from "./jump-bottom-core.ts";
import { getState } from "./state.ts";

const PILL_BG = { r: 58, g: 58, b: 58 } as const;
const PILL_BG_HOVER = { r: 90, g: 90, b: 90 } as const;
const PILL_FG = "#e5e5e5";

type LayoutRect = { x: number; y: number; width: number; height: number };
type LayoutBox = {
  scrollView?: { isScrollbarVisible?: boolean } | unknown;
  rect?: LayoutRect;
  children?: unknown[];
};
type LayoutFrame = {
  primaryScrollView?: unknown;
  root?: LayoutBox;
};

type JumpHost = {
  isFollowingOutput?: boolean;
  scrollToBottom?: () => void;
};

function findPrimaryScrollBox(
  node: unknown,
  primary: unknown,
  depth = 0,
): LayoutBox | undefined {
  if (!node || typeof node !== "object" || depth > 24) return undefined;
  const box = node as LayoutBox;
  if (primary && box.scrollView === primary) return box;
  if (!Array.isArray(box.children)) return undefined;
  for (const child of box.children) {
    const found = findPrimaryScrollBox(child, primary, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function paintPill(hovered: boolean): string {
  const bg = hovered ? PILL_BG_HOVER : PILL_BG;
  const bgHex = `#${[bg.r, bg.g, bg.b]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
  return ansiBgHex(bgHex, ansiFgHex(PILL_FG, JUMP_BOTTOM_TEXT));
}

function hideJumpBottom(state: ReturnType<typeof getState>, screen: string[]): string[] {
  if (state.hoveredFoldId === JUMP_BOTTOM_ID) state.hoveredFoldId = undefined;
  return screen;
}

function scrollbarReserve(scrollView: LayoutBox["scrollView"]): number {
  return typeof scrollView === "object" &&
    scrollView !== null &&
    (scrollView as { isScrollbarVisible?: boolean }).isScrollbarVisible === true
    ? 1
    : 0;
}

function paintJumpBottom(
  host: JumpHost,
  screen: string[],
  layout: LayoutFrame,
): string[] {
  const state = getState();
  if (state.tuiMode !== "fullscreen" || !state.clickFoldReady) {
    return hideJumpBottom(state, screen);
  }
  if (
    host.isFollowingOutput !== false ||
    typeof host.scrollToBottom !== "function"
  ) {
    return hideJumpBottom(state, screen);
  }
  const box = findPrimaryScrollBox(layout.root, layout.primaryScrollView);
  const rect = box?.rect;
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.height <= 0
  ) {
    return hideJumpBottom(state, screen);
  }
  const place = jumpBottomPlacement(
    rect.x,
    rect.width - scrollbarReserve(box?.scrollView),
  );
  if (!place) return hideJumpBottom(state, screen);
  const row = Math.floor(rect.y + rect.height - 1);
  if (row < 0 || row >= screen.length) return hideJumpBottom(state, screen);
  const totalWidth = Math.max(
    place.startCol + place.width,
    visibleWidth(screen[row] ?? ""),
    Math.floor(rect.x + rect.width),
    1,
  );
  const overlay =
    hitSpanMarker(JUMP_BOTTOM_ID, place.width) +
    paintPill(state.hoveredFoldId === JUMP_BOTTOM_ID);
  const next = [...screen];
  next[row] = compositeTuiLine(
    next[row] ?? "",
    overlay,
    place.startCol,
    place.width,
    totalWidth,
  );
  registerFoldHandler(JUMP_BOTTOM_ID, () => {
    state.hoveredFoldId = undefined;
    try {
      host.scrollToBottom?.();
    } catch {
      /* fail-soft */
    }
  });
  return next;
}

export function installJumpBottomPatch(): () => void {
  const proto = TuiAltScreen.prototype as unknown as {
    applySearchHighlights?: (
      screen: string[],
      layout: LayoutFrame,
    ) => string[];
  };
  const original = proto.applySearchHighlights;
  if (typeof original !== "function") return () => {};

  proto.applySearchHighlights = function (
    this: JumpHost,
    screen: string[],
    layout: LayoutFrame,
  ): string[] {
    const highlighted = original.call(this, screen, layout);
    try {
      return paintJumpBottom(this, highlighted, layout);
    } catch {
      return hideJumpBottom(getState(), highlighted);
    }
  };

  return () => {
    proto.applySearchHighlights = original;
    hideJumpBottom(getState(), []);
  };
}
