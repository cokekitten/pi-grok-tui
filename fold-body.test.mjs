import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Text, getOsc8LinkAtColumn } from "@earendil-works/pi-tui";
import {
  markBodyFold,
  unmarkBodyFold,
  markBodyFoldDeep,
  wrapFoldBodyLine,
  installFoldBodyTextPatch,
  bodyFoldIdOf,
} from "./extensions/fold-body.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

const FOLD_RE = /\x1b\]8;;pi-grok-tui:\/\/v1\/fold\/[^;]*/;

beforeEach(() => {
  resetClickFoldSession();
  const state = getState();
  state.tuiMode = "regular";
  state.clickFoldReady = false;
});

describe("wrapFoldBodyLine", () => {
  it("wraps non-empty rows in fullscreen when click-fold is ready", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    const line = wrapFoldBodyLine("  some body", "f1");
    assert.match(line, /\x1b\]8;;pi-grok-tui:\/\/v1\/fold\/f1/);
    // The fold URL is resolvable at the wrapped row's text cells.
    assert.equal(
      getOsc8LinkAtColumn(line, 3),
      "pi-grok-tui://v1/fold/f1",
    );
  });

  it("keeps the row untouched in regular mode", () => {
    const state = getState();
    state.tuiMode = "regular";
    state.clickFoldReady = true;
    assert.equal(wrapFoldBodyLine("  some body", "f1"), "  some body");
  });

  it("keeps the row untouched when click-fold is not installed", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = false;
    assert.equal(wrapFoldBodyLine("  some body", "f1"), "  some body");
  });

  it("skips blank rows (no visible cells to hit)", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    assert.equal(wrapFoldBodyLine("", "f1"), "");
    assert.equal(wrapFoldBodyLine("   ", "f1"), "   ");
  });
});

describe("markBodyFoldDeep", () => {
  it("marks Text leaves and nothing else", () => {
    const leaf = new Text("body", 0, 0);
    const box = { children: [leaf, { text: "no setText" }] };
    markBodyFoldDeep(box, "f1", []);
    assert.equal(bodyFoldIdOf(leaf), "f1");
  });

  it("skips titled chrome rows (skipMarks)", () => {
    const title = new Text("◆ Read", 0, 0);
    title.__piToolTitle = true;
    const box = { children: [title] };
    markBodyFoldDeep(box, "f1", ["__piToolTitle"]);
    assert.equal(bodyFoldIdOf(title), undefined);
  });

  it("does not recurse into nested tools", () => {
    const innerLeaf = new Text("nested", 0, 0);
    const nestedTool = {
      toolName: "bash",
      updateDisplay() {},
      children: [innerLeaf],
    };
    const box = { children: [nestedTool] };
    markBodyFoldDeep(box, "f1", []);
    assert.equal(bodyFoldIdOf(innerLeaf), undefined);
  });

  it("unmarkBodyFold removes a mark", () => {
    const leaf = new Text("body", 0, 0);
    markBodyFold(leaf, "f1");
    assert.equal(bodyFoldIdOf(leaf), "f1");
    unmarkBodyFold(leaf);
    assert.equal(bodyFoldIdOf(leaf), undefined);
  });
});

describe("installFoldBodyTextPatch", () => {
  let cleanup;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("links marked Text rows only in fullscreen when ready", () => {
    cleanup = installFoldBodyTextPatch();
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;

    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    const plain = new Text("hello body", 1, 0);

    const markedLines = marked.render(30);
    assert.ok(markedLines.length > 0);
    assert.match(markedLines[0], FOLD_RE);
    assert.equal(
      getOsc8LinkAtColumn(markedLines[0], 3),
      "pi-grok-tui://v1/fold/f2",
    );

    const plainLines = plain.render(30);
    assert.equal(plainLines[0].includes("\x1b]8;;"), false);
  });

  it("renders marked rows without links in regular mode", () => {
    cleanup = installFoldBodyTextPatch();
    const state = getState();
    state.tuiMode = "regular";
    state.clickFoldReady = true;

    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    const lines = marked.render(30);
    assert.ok(lines.length > 0);
    assert.equal(lines[0].includes("\x1b]8;;"), false);
  });

  it("does not link empty Text output", () => {
    cleanup = installFoldBodyTextPatch();
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;

    const empty = new Text("", 1, 0);
    markBodyFold(empty, "f2");
    const lines = empty.render(30);
    assert.equal(lines.length, 0);
  });

  it("restores the original render after cleanup", () => {
    cleanup = installFoldBodyTextPatch();
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;

    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    cleanup();
    cleanup = undefined;
    // Text instance is a different class identity? No — patch restored, so
    // the output must be plain again even though the mark is still set.
    assert.equal(marked.render(30)[0].includes("\x1b]8;;"), false);
  });
});
