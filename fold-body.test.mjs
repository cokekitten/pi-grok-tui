import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Box, MouseRegion, Text, visibleWidth } from "@earendil-works/pi-tui";
import {
  foldMarker,
  parseFoldMarker,
  withFoldMarker,
  wrapFoldBodyComponent,
  markBodyFold,
  unmarkBodyFold,
  markBodyFoldDeep,
  installFoldBodyTextPatch,
  clearFoldRegistry,
  HOVER_BG,
} from "./extensions/fold-body.ts";
import { RESPONSE_LEFT_PAD } from "./extensions/chrome.ts";
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

  it("marks blank rows so hover can paint a solid rectangle", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    assert.equal(parseFoldMarker(withFoldMarker("", "f1")), "f1");
    assert.equal(parseFoldMarker(withFoldMarker("   ", "f1")), "f1");
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

  it("walks pi 0.85 MouseRegion.child to mark nested Text", () => {
    const cleanup = installFoldBodyTextPatch();
    try {
      const state = getState();
      state.tuiMode = "fullscreen";
      state.clickFoldReady = true;
      const leaf = new Text("mcp body", 0, 0);
      const region = new MouseRegion(leaf, () => undefined);
      markBodyFoldDeep({ children: [region] }, "mcp-1", []);
      const lines = region.render(20);
      assert.equal(parseFoldMarker(lines[0] ?? ""), "mcp-1");
    } finally {
      cleanup();
    }
  });

  it("marks a write-style Text subclass inside a Box", () => {
    const cleanup = installFoldBodyTextPatch();
    try {
      const state = getState();
      state.tuiMode = "fullscreen";
      state.clickFoldReady = true;
      class WriteLike extends Text {
        constructor() {
          super("write foo.ts\nline1\n\nline2", 0, 0);
        }
      }
      const box = new Box(0, 0);
      const child = new WriteLike();
      box.addChild(child);
      markBodyFoldDeep(box, "write-1", []);
      const lines = box.render(40);
      assert.ok(lines.length >= 3);
      assert.ok(
        lines.some((line) => line.replace(/\x1b\]9999;[^\x07]*\x07/g, "").trim() === ""),
        "write preview should keep an interior blank line",
      );
      for (const line of lines) {
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

describe("wrapFoldBodyComponent", () => {
  it("indents custom-render rows and paints fold markers including blanks", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    state.hoveredFoldId = "mcp-1";
    let invalidated = 0;
    const inner = {
      render() {
        return ["first", "", "second"];
      },
      invalidate() {
        invalidated += 1;
      },
    };
    const wrapped = wrapFoldBodyComponent(inner, "mcp-1", RESPONSE_LEFT_PAD);
    const lines = wrapped.render(20);
    assert.equal(lines.length, 3);
    const pad = " ".repeat(RESPONSE_LEFT_PAD);
    for (const line of lines) {
      assert.ok(line.startsWith(pad));
      assert.equal(parseFoldMarker(line), "mcp-1");
      assert.ok(line.includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      assert.equal(visibleWidth(line), 20);
    }
    wrapped.invalidate();
    assert.equal(invalidated, 1);
  });
});
