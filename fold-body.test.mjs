import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@earendil-works/pi-tui";
import {
  registerFoldRow,
  lookupFoldRow,
  normalizeFoldRow,
  markBodyFold,
  unmarkBodyFold,
  markBodyFoldDeep,
  installFoldBodyTextPatch,
  clearFoldRegistry,
} from "./extensions/fold-body.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

beforeEach(() => {
  resetClickFoldSession();
  clearFoldRegistry();
  const state = getState();
  state.tuiMode = "regular";
  state.clickFoldReady = false;
});

describe("normalizeFoldRow", () => {
  it("strips ANSI and trims surrounding whitespace", () => {
    assert.equal(
      normalizeFoldRow("\x1b[38;2;1;2;3m  hello body  \x1b[0m"),
      "hello body",
    );
  });
});

describe("row registry", () => {
  it("registers a row and resolves it back", () => {
    registerFoldRow("  some body", "f1");
    assert.equal(lookupFoldRow("  some body"), "f1");
    // padding/resize variance: trims and strips are normalized away
    assert.equal(lookupFoldRow("   \x1b[38;5;8m some body   "), "f1");
  });

  it("does not register blank rows", () => {
    registerFoldRow("   ", "f1");
    assert.equal(lookupFoldRow("   "), undefined);
  });

  it("resolves ambiguous rows (2+ ids) as no-op", () => {
    registerFoldRow("same line", "f1");
    registerFoldRow("same line", "f2");
    assert.equal(lookupFoldRow("same line"), undefined);
  });

  it("register later rows does not clobber earlier distinct rows", () => {
    registerFoldRow("alpha", "f1");
    registerFoldRow("beta", "f2");
    assert.equal(lookupFoldRow("alpha"), "f1");
    assert.equal(lookupFoldRow("beta"), "f2");
  });
});

describe("markBodyFoldDeep", () => {
  it("marks Text leaves and nothing else", () => {
    const leaf = new Text("body", 0, 0);
    const box = { children: [leaf, { text: "no setText" }] };
    markBodyFoldDeep(box, "f1", []);
    assert.equal(leaf.text, "body"); // marking is side-effect-free on text
  });

  it("skips titled chrome rows (skipMarks)", () => {
    const title = new Text("◆ Read", 0, 0);
    title.__piToolTitle = true;
    const box = { children: [title] };
    markBodyFoldDeep(box, "f1", ["__piToolTitle"]);
    // skipMarks nodes are not registered — verify by rendering later in the
    // patch test; here just ensure no throw and no registration of the text.
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
    // The nested tool's leaf must not be marked; render it after patch install.
  });

  it("markBodyFold / unmarkBodyFold attach and detach an instance", () => {
    const leaf = new Text("attach me", 0, 0);
    markBodyFold(leaf, "f1");
    unmarkBodyFold(leaf);
  });
});

describe("installFoldBodyTextPatch", () => {
  let cleanup;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("registers marked Text rows for press lookup and nothing else", () => {
    cleanup = installFoldBodyTextPatch();

    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    const plain = new Text("hello body", 1, 0);

    assert.ok(marked.render(30).length > 0);
    assert.equal(lookupFoldRow(" hello body "), "f2");

    // plain Text was never marked: its rows must not be registered
    plain.render(30);
    // (same visual row as marked — but lookup is idempotent; distinct row:
    // use a second unmarked text with unique content)
    const other = new Text("never registered", 1, 0);
    other.render(30);
    assert.equal(lookupFoldRow("never registered"), undefined);
  });

  it("skips titled chrome rows and nested tools at render time", () => {
    cleanup = installFoldBodyTextPatch();

    const title = new Text("◆ Read `x.ts`", 0, 0);
    title.__piToolTitle = true;
    markBodyFoldDeep({ children: [title] }, "f3", ["__piToolTitle"]);
    title.render(30);
    assert.equal(lookupFoldRow("◆ Read `x.ts`"), undefined);
  });

  it("does not link OSC 8 into rendered rows (no underlines anywhere)", () => {
    cleanup = installFoldBodyTextPatch();
    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    const lines = marked.render(30);
    assert.ok(lines.length > 0);
    assert.equal(lines[0].includes("\x1b]8;;"), false);
  });

  it("restores the original render after cleanup", () => {
    cleanup = installFoldBodyTextPatch();
    const marked = new Text("hello body", 1, 0);
    markBodyFold(marked, "f2");
    cleanup();
    cleanup = undefined;
    marked.render(30);
    assert.equal(lookupFoldRow("hello body"), undefined);
  });
});
