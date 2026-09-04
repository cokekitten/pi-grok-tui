import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  foldMarker,
  parseFoldMarker,
  withFoldMarker,
  HOVER_BG,
} from "./extensions/fold-body.ts";
import { handleFoldHover, injectFoldRow } from "./extensions/click-fold.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

beforeEach(() => {
  resetClickFoldSession();
  const state = getState();
  state.tuiMode = "fullscreen";
  state.clickFoldReady = true;
  state.hoveredFoldId = undefined;
});

describe("withFoldMarker hover paint", () => {
  it("adds the hover background when hoveredFoldId matches", () => {
    getState().hoveredFoldId = "f1";
    const painted = withFoldMarker("  some body", "f1", 20);
    assert.equal(parseFoldMarker(painted), "f1");
    assert.ok(painted.includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
    assert.equal(painted.includes("\x1b]8;;"), false);
  });

  it("does not highlight a different fold id", () => {
    getState().hoveredFoldId = "f1";
    const painted = withFoldMarker("  other", "f2", 20);
    assert.equal(parseFoldMarker(painted), "f2");
    assert.equal(
      painted.includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`),
      false,
    );
  });

  it("does not highlight when nothing is hovered", () => {
    const painted = withFoldMarker("  some body", "f1", 20);
    assert.equal(
      painted.includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`),
      false,
    );
  });

  it("washes a blank row to full width when hovered", () => {
    getState().hoveredFoldId = "f1";
    const painted = withFoldMarker("", "f1", 20);
    assert.equal(parseFoldMarker(painted), "f1");
    assert.ok(painted.includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
    assert.equal(visibleWidth(painted), 20);
  });
});

describe("handleFoldHover", () => {
  it("sets hoveredFoldId from a marked previousScreen row and reports a change", () => {
    const rows = ["pad", foldMarker("think-11") + "◆ Thought" + SEGMENT_RESET];
    assert.equal(handleFoldHover(rows, 1), true);
    assert.equal(getState().hoveredFoldId, "think-11");
  });

  it("is a no-op when the same id is already hovered", () => {
    getState().hoveredFoldId = "think-11";
    const rows = [foldMarker("think-11") + "◆ Thought" + SEGMENT_RESET];
    assert.equal(handleFoldHover(rows, 0), false);
    assert.equal(getState().hoveredFoldId, "think-11");
  });

  it("clears hover when the pointer leaves fold rows", () => {
    getState().hoveredFoldId = "think-11";
    assert.equal(handleFoldHover(["plain row"], 0), true);
    assert.equal(getState().hoveredFoldId, undefined);
  });

  it("keeps hover when the pointer is on a marked blank row", () => {
    const blank = withFoldMarker("", "write-1", 20);
    assert.equal(handleFoldHover([blank], 0), true);
    assert.equal(getState().hoveredFoldId, "write-1");
  });

  it("does not steal injectFoldRow press lookup", () => {
    const painted = foldMarker("f9") + "  some body row";
    const rows = [painted + SEGMENT_RESET];
    const restore = injectFoldRow(rows, 0);
    assert.ok(restore);
    restore();
    assert.equal(rows[0], painted + SEGMENT_RESET);
  });
});
