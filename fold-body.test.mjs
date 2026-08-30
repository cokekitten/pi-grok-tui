import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Box, Text } from "@earendil-works/pi-tui";
import {
  foldMarker,
  parseFoldMarker,
  withFoldMarker,
  markBodyFold,
  unmarkBodyFold,
  markBodyFoldDeep,
  installFoldBodyTextPatch,
  clearFoldRegistry,
} from "./extensions/fold-body.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

beforeEach(() => {
  resetClickFoldSession();
  clearFoldRegistry();
  const state = getState();
  state.tuiMode = "regular";
  state.clickFoldReady = false;
});

describe("fold markers", () => {
  it("parses the id from a painted row", () => {
    const line = foldMarker("f1") + "  some body";
    assert.equal(parseFoldMarker(line), "f1");
  });

  it("survives leading pad and pi's per-line SEGMENT_RESET", () => {
    const line = "  " + foldMarker("think-11") + "◆ Thought" + SEGMENT_RESET;
    assert.equal(parseFoldMarker(line), "think-11");
  });

  it("returns undefined when no marker is present", () => {
    assert.equal(parseFoldMarker("◆ Thought"), undefined);
    assert.equal(parseFoldMarker("hello" + SEGMENT_RESET), undefined);
  });

  it("paints a marker only in fullscreen when click-fold is ready", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    const painted = withFoldMarker("  some body", "f1");
    assert.equal(parseFoldMarker(painted), "f1");
    assert.equal(painted.includes("\x1b]8;;"), false);
    assert.ok(painted.startsWith(foldMarker("f1")));
  });

  it("does not paint in regular mode", () => {
    const state = getState();
    state.tuiMode = "regular";
    state.clickFoldReady = true;
    assert.equal(withFoldMarker("  some body", "f1"), "  some body");
  });

  it("skips blank rows", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    assert.equal(withFoldMarker("", "f1"), "");
    assert.equal(withFoldMarker("   ", "f1"), "   ");
  });

  it("is idempotent for the same id", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    const once = withFoldMarker("body", "f1");
    assert.equal(withFoldMarker(once, "f1"), once);
  });
});

describe("markBodyFoldDeep", () => {
  it("marks Text leaves and nothing else", () => {
    const leaf = new Text("body", 0, 0);
    const box = { children: [leaf, { text: "no setText" }] };
    markBodyFoldDeep(box, "f1", []);
    assert.equal(leaf.text, "body");
  });

  it("skips titled chrome rows (skipMarks)", () => {
    const title = new Text("◆ Read", 0, 0);
    title.__piToolTitle = true;
    markBodyFoldDeep({ children: [title] }, "f1", ["__piToolTitle"]);
  });

  it("does not recurse into nested tools", () => {
    const innerLeaf = new Text("nested", 0, 0);
    const nestedTool = {
      toolName: "bash",
      updateDisplay() {},
      children: [innerLeaf],
    };
    markBodyFoldDeep({ children: [nestedTool] }, "f1", []);
  });

  it("markBodyFold / unmarkBodyFold attach and detach an instance", () => {
    const leaf = new Text("attach me", 0, 0);
    markBodyFold(leaf, "f1");
    unmarkBodyFold(leaf);
  });

  it("marks a write-style Text subclass inside a Box", () => {
    const cleanup = installFoldBodyTextPatch();
    try {
      const state = getState();
      state.tuiMode = "fullscreen";
      state.clickFoldReady = true;
      class WriteLike extends Text {
        constructor() {
          super("write foo.ts\nline1\nline2", 0, 0);
        }
      }
      const box = new Box(0, 0);
      const child = new WriteLike();
      box.addChild(child);
      markBodyFoldDeep(box, "write-1", []);
      const lines = box.render(40);
      assert.ok(lines.length >= 3);
      for (const line of lines) {
        if (line.trim() === "") continue;
        assert.equal(parseFoldMarker(line), "write-1");
      }
    } finally {
      cleanup();
    }
  });
});

describe("installFoldBodyTextPatch", () => {
  let cleanup;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("paints markers on marked Text rows only in fullscreen when ready", () => {
    cleanup = installFoldBodyTextPatch();
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;

    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    const lines = marked.render(30);
    assert.ok(lines.length > 0);
    assert.equal(parseFoldMarker(lines[0]), "f2");
    assert.equal(lines[0].includes("\x1b]8;;"), false);

    const other = new Text("never marked", 1, 0);
    const otherLines = other.render(30);
    assert.equal(parseFoldMarker(otherLines[0] ?? ""), undefined);
  });

  it("does not paint markers in regular mode", () => {
    cleanup = installFoldBodyTextPatch();
    const state = getState();
    state.tuiMode = "regular";
    state.clickFoldReady = true;
    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    const lines = marked.render(30);
    assert.equal(parseFoldMarker(lines[0] ?? ""), undefined);
  });

  it("skips titled chrome rows at render time", () => {
    cleanup = installFoldBodyTextPatch();
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    const title = new Text("◆ Read `x.ts`", 0, 0);
    title.__piToolTitle = true;
    markBodyFoldDeep({ children: [title] }, "f3", ["__piToolTitle"]);
    const lines = title.render(30);
    assert.equal(parseFoldMarker(lines[0] ?? ""), undefined);
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
    const lines = marked.render(30);
    assert.equal(parseFoldMarker(lines[0] ?? ""), undefined);
  });
});
