import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  TuiAltScreen,
  compositeTuiLine,
  getOsc8LinkAtColumn,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  JUMP_BOTTOM_ID,
  JUMP_BOTTOM_TEXT,
  hitSpanMarker,
  isHitAt,
  jumpBottomPlacement,
  parseHitSpan,
} from "./extensions/jump-bottom-core.ts";
import { installJumpBottomPatch } from "./extensions/jump-bottom.ts";
import {
  dispatchGrokFoldUrl,
  handleFoldHover,
  injectFoldRow,
  injectHitSpan,
  resetFoldHandlers,
} from "./extensions/click-fold.ts";
import { foldMarker } from "./extensions/fold-body.ts";
import { foldUrl } from "./extensions/click-fold-core.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

beforeEach(() => {
  resetFoldHandlers();
  resetClickFoldSession();
  const state = getState();
  state.tuiMode = "fullscreen";
  state.clickFoldReady = true;
  state.hoveredFoldId = undefined;
});

function paintedHitLine(startCol, id = JUMP_BOTTOM_ID) {
  const width = visibleWidth(JUMP_BOTTOM_TEXT);
  return (
    "x".repeat(startCol) +
    hitSpanMarker(id, width) +
    JUMP_BOTTOM_TEXT +
    "y".repeat(8)
  );
}

describe("jumpBottomPlacement", () => {
  it("centers the full pill inside the transcript viewport", () => {
    const width = visibleWidth(JUMP_BOTTOM_TEXT);
    assert.equal(JUMP_BOTTOM_TEXT, " Jump to bottom (click) ↓ ");
    const place = jumpBottomPlacement(0, 80);
    assert.deepEqual(place, {
      startCol: Math.floor((80 - width) / 2),
      width,
    });
    const inset = jumpBottomPlacement(4, 40);
    assert.deepEqual(inset, {
      startCol: 4 + Math.floor((40 - width) / 2),
      width,
    });
  });

  it("hides the pill when the viewport is too narrow", () => {
    const width = visibleWidth(JUMP_BOTTOM_TEXT);
    assert.equal(jumpBottomPlacement(0, width - 1), undefined);
    assert.equal(jumpBottomPlacement(0, 0), undefined);
    assert.equal(jumpBottomPlacement(Number.NaN, 80), undefined);
  });
});

describe("hit spans", () => {
  it("parses id, start column, and width from a bounded marker", () => {
    const line = paintedHitLine(10);
    const span = parseHitSpan(line);
    assert.deepEqual(span, {
      id: JUMP_BOTTOM_ID,
      startCol: 10,
      width: visibleWidth(JUMP_BOTTOM_TEXT),
    });
  });

  it("hits only columns inside the span", () => {
    const span = { id: JUMP_BOTTOM_ID, startCol: 10, width: 26 };
    assert.equal(isHitAt(span, 9), false);
    assert.equal(isHitAt(span, 10), true);
    assert.equal(isHitAt(span, 35), true);
    assert.equal(isHitAt(span, 36), false);
  });
});

describe("injectHitSpan", () => {
  it("injects an OSC 8 link only on the pill columns", () => {
    const line = paintedHitLine(10) + SEGMENT_RESET;
    const rows = [line];
    const restore = injectHitSpan(rows, 0, 10);
    assert.ok(restore);
    assert.equal(getOsc8LinkAtColumn(rows[0], 10), foldUrl(JUMP_BOTTOM_ID));
    assert.equal(getOsc8LinkAtColumn(rows[0], 9), undefined);
    restore();
    assert.equal(rows[0], line);
  });

  it("does not inject when x is outside the pill", () => {
    const line = paintedHitLine(10);
    assert.equal(injectHitSpan([line], 0, 9), undefined);
    assert.equal(injectHitSpan([line], 0, 10 + visibleWidth(JUMP_BOTTOM_TEXT)), undefined);
    assert.equal(injectHitSpan(["plain"], 0, 0), undefined);
  });

  it("prefers the hit span over a whole-row fold marker on the same line", () => {
    const width = visibleWidth(JUMP_BOTTOM_TEXT);
    const line =
      foldMarker("f9") +
      "x".repeat(10) +
      hitSpanMarker(JUMP_BOTTOM_ID, width) +
      JUMP_BOTTOM_TEXT;
    const rows = [line];
    const restoreHit = injectHitSpan(rows, 0, 10);
    assert.ok(restoreHit);
    assert.equal(getOsc8LinkAtColumn(rows[0], 12), foldUrl(JUMP_BOTTOM_ID));
    restoreHit();
    const restoreFold = injectHitSpan(rows, 0, 2) ?? injectFoldRow(rows, 0);
    assert.ok(restoreFold);
    assert.equal(getOsc8LinkAtColumn(rows[0], 2), foldUrl("f9"));
    restoreFold();
  });
});

describe("handleFoldHover hit spans", () => {
  it("uses the bounded span id when x is inside the pill", () => {
    const rows = [paintedHitLine(10)];
    assert.equal(handleFoldHover(rows, 0, 12), true);
    assert.equal(getState().hoveredFoldId, JUMP_BOTTOM_ID);
  });

  it("falls back to the whole-row fold marker outside the pill", () => {
    const width = visibleWidth(JUMP_BOTTOM_TEXT);
    const rows = [
      foldMarker("think-11") +
        "x".repeat(10) +
        hitSpanMarker(JUMP_BOTTOM_ID, width) +
        JUMP_BOTTOM_TEXT,
    ];
    assert.equal(handleFoldHover(rows, 0, 2), true);
    assert.equal(getState().hoveredFoldId, "think-11");
  });
});

describe("installJumpBottomPatch", () => {
  let cleanup;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function host(following) {
    let bottoms = 0;
    const self = {
      isFollowingOutput: following,
      activeSearch: undefined,
      scrollToBottom() {
        bottoms += 1;
      },
      bottoms() {
        return bottoms;
      },
    };
    return self;
  }

  function layout(rect, opts = {}) {
    const scrollView = {
      id: "primary",
      isScrollbarVisible: opts.scrollbar === true,
    };
    const box = {
      scrollView,
      children: [],
    };
    if (rect !== undefined) box.rect = rect;
    return {
      width: 80,
      height: 20,
      primaryScrollView: scrollView,
      root: {
        children: [box],
      },
    };
  }

  it("paints the pill on the last transcript row when not following output", () => {
    cleanup = installJumpBottomPatch();
    const state = getState();
    state.clickFoldReady = true;
    const h = host(false);
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const out = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: 80, height: 10 }),
    );
    const row = out[9] ?? "";
    assert.ok(row.includes("Jump to bottom (click)"));
    const span = parseHitSpan(row);
    assert.ok(span);
    assert.equal(span.id, JUMP_BOTTOM_ID);
    assert.equal(span.startCol, jumpBottomPlacement(0, 80).startCol);
    assert.equal(out[8].includes("Jump to bottom (click)"), false);
  });

  it("does not paint while following output", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    const h = host(true);
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const out = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: 80, height: 10 }),
    );
    assert.equal(
      out.some((line) => line.includes("Jump to bottom (click)")),
      false,
    );
  });

  it("does not paint when isFollowingOutput is missing", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    const h = { scrollToBottom() {} };
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const out = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: 80, height: 10 }),
    );
    assert.equal(
      out.some((line) => line.includes("Jump to bottom (click)")),
      false,
    );
  });

  it("does not paint when scrollToBottom is missing", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    const h = { isFollowingOutput: false };
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const out = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: 80, height: 10 }),
    );
    assert.equal(
      out.some((line) => line.includes("Jump to bottom (click)")),
      false,
    );
  });

  it("dispatches the jump-bottom fold URL to scrollToBottom and clears hover", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    getState().hoveredFoldId = JUMP_BOTTOM_ID;
    const h = host(false);
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: 80, height: 10 }),
    );
    assert.equal(dispatchGrokFoldUrl(foldUrl(JUMP_BOTTOM_ID)), true);
    assert.equal(h.bottoms(), 1);
    assert.equal(getState().hoveredFoldId, undefined);
  });

  it("clears jump hover when the viewport is too narrow to paint", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    getState().hoveredFoldId = JUMP_BOTTOM_ID;
    const h = host(false);
    const width = visibleWidth(JUMP_BOTTOM_TEXT);
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const out = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: width - 1, height: 10 }),
    );
    assert.equal(
      out.some((line) => line.includes("Jump to bottom (click)")),
      false,
    );
    assert.equal(getState().hoveredFoldId, undefined);
  });

  it("clears jump hover when the primary scroll rect is missing", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    getState().hoveredFoldId = JUMP_BOTTOM_ID;
    const h = host(false);
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const out = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout(undefined),
    );
    assert.equal(
      out.some((line) => line.includes("Jump to bottom (click)")),
      false,
    );
    assert.equal(getState().hoveredFoldId, undefined);
  });

  it("does not paint over a visible scrollbar column", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    const h = host(false);
    const width = visibleWidth(JUMP_BOTTOM_TEXT);
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const exact = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width, height: 10 }, { scrollbar: true }),
    );
    assert.equal(
      exact.some((line) => line.includes("Jump to bottom (click)")),
      false,
    );
    const roomy = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: width + 1, height: 10 }, { scrollbar: true }),
    );
    const span = parseHitSpan(roomy[9] ?? "");
    assert.ok(span);
    assert.ok(span.startCol + span.width <= width);
  });

  it("restores applySearchHighlights on cleanup", () => {
    const proto = TuiAltScreen.prototype;
    const original = proto.applySearchHighlights;
    cleanup = installJumpBottomPatch();
    assert.notEqual(proto.applySearchHighlights, original);
    cleanup();
    cleanup = undefined;
    assert.equal(proto.applySearchHighlights, original);
  });

  it("survives compositeTuiLine so the hit span still parses", () => {
    const width = visibleWidth(JUMP_BOTTOM_TEXT);
    const startCol = 20;
    const overlay = hitSpanMarker(JUMP_BOTTOM_ID, width) + JUMP_BOTTOM_TEXT;
    const composed = compositeTuiLine("base transcript row".padEnd(80, " "), overlay, startCol, width, 80);
    const span = parseHitSpan(composed);
    assert.ok(span);
    assert.equal(span.id, JUMP_BOTTOM_ID);
    assert.equal(span.startCol, startCol);
    assert.equal(span.width, width);
  });

  it("injects a clickable URL on a real composited pill row", () => {
    cleanup = installJumpBottomPatch();
    getState().clickFoldReady = true;
    const h = host(false);
    const screen = Array.from({ length: 20 }, () => "conversation line".padEnd(80, " "));
    const out = TuiAltScreen.prototype.applySearchHighlights.call(
      h,
      screen,
      layout({ x: 0, y: 0, width: 80, height: 10 }),
    );
    const line = out[9] ?? "";
    const span = parseHitSpan(line);
    assert.ok(span);
    const rows = [line];
    const restore = injectHitSpan(rows, 0, span.startCol);
    assert.ok(restore);
    assert.equal(
      getOsc8LinkAtColumn(rows[0], span.startCol),
      foldUrl(JUMP_BOTTOM_ID),
    );
    assert.equal(
      getOsc8LinkAtColumn(rows[0], span.startCol + span.width - 1),
      foldUrl(JUMP_BOTTOM_ID),
    );
    assert.equal(getOsc8LinkAtColumn(rows[0], span.startCol - 1), undefined);
    restore();
    assert.equal(rows[0], line);
  });
});
