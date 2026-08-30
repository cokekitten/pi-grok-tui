import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  foldUrl,
  parseFoldId,
  isGrokFoldScheme,
  chromeHint,
  isThinkingExpanded,
  nextThinkingExpanded,
  nextToolFoldMode,
  groupRunRange,
} from "./extensions/click-fold-core.ts";

describe("fold URI", () => {
  it("builds and parses v1 fold ids", () => {
    assert.equal(foldUrl("abc"), "pi-grok-tui://v1/fold/abc");
    assert.equal(parseFoldId("pi-grok-tui://v1/fold/abc"), "abc");
  });

  it("claims every pi-grok-tui URL and no other scheme", () => {
    assert.equal(isGrokFoldScheme("pi-grok-tui://v1/fold/abc"), true);
    assert.equal(isGrokFoldScheme("pi-grok-tui://v1/nope"), true);
    assert.equal(isGrokFoldScheme("pi-grok-tui://"), true);
    assert.equal(isGrokFoldScheme("https://example.com"), false);
    assert.equal(isGrokFoldScheme("file:///tmp/x"), false);
    assert.equal(parseFoldId("https://example.com"), undefined);
    assert.equal(parseFoldId("pi-grok-tui://v1/fold/"), undefined);
    assert.equal(parseFoldId("pi-grok-tui://v1/nope"), undefined);
  });
});

describe("chromeHint", () => {
  it("hides hints only in fullscreen when click-fold is ready", () => {
    assert.equal(
      chromeHint("thinking", { tuiMode: "fullscreen", clickFoldReady: true }),
      undefined,
    );
    assert.equal(
      chromeHint("tool", { tuiMode: "fullscreen", clickFoldReady: true }),
      undefined,
    );
  });

  it("keeps keyboard hints in regular mode and when the patch is not ready", () => {
    const thinking = chromeHint("thinking", {
      tuiMode: "regular",
      clickFoldReady: true,
    });
    assert.ok(thinking === " (⌥T)" || thinking === " (Alt+T)");
    assert.equal(
      chromeHint("tool", { tuiMode: "regular", clickFoldReady: true }),
      " (Ctrl+O)",
    );
    assert.equal(
      chromeHint("tool", { tuiMode: "fullscreen", clickFoldReady: false }),
      " (Ctrl+O)",
    );
  });
});

describe("fold modes", () => {
  it("toggles thinking against the current displayed state", () => {
    const overrides = new Map([[1, true]]);
    assert.equal(isThinkingExpanded(1, false, overrides), true);
    assert.equal(isThinkingExpanded(2, false, overrides), false);
    assert.equal(isThinkingExpanded(2, true, overrides), true);
    assert.equal(nextThinkingExpanded(false), true);
    assert.equal(nextThinkingExpanded(true), false);
  });

  it("maps read to truncated and other tools to full", () => {
    assert.equal(nextToolFoldMode("read", "chrome"), "truncated");
    assert.equal(nextToolFoldMode("read", "truncated"), "chrome");
    assert.equal(nextToolFoldMode("read", "full"), "chrome");
    assert.equal(nextToolFoldMode("bash", "chrome"), "full");
    assert.equal(nextToolFoldMode("bash", "truncated"), "chrome");
    assert.equal(nextToolFoldMode("bash", "full"), "chrome");
    assert.equal(nextToolFoldMode("grep", "chrome"), "full");
    assert.equal(nextToolFoldMode("custom", "chrome"), "full");
    assert.equal(nextToolFoldMode("edit", "chrome"), "chrome");
    assert.equal(nextToolFoldMode("edit", "truncated"), "truncated");
    assert.equal(nextToolFoldMode("edit", "full"), "full");
  });

  it("maps write preview to full and full back to truncated, never chrome", () => {
    assert.equal(nextToolFoldMode("write", "chrome"), "full");
    assert.equal(nextToolFoldMode("write", "truncated"), "full");
    assert.equal(nextToolFoldMode("write", "full"), "truncated");
  });
});

describe("groupRunRange", () => {
  it("groups consecutive collapsible tools across spacers even when a member is locally expanded", () => {
    const siblings = [
      { kind: "other" },
      { kind: "tool", toolName: "read" },
      { kind: "gap" },
      { kind: "tool", toolName: "read" },
      { kind: "tool", toolName: "edit" },
      { kind: "tool", toolName: "write" },
    ];
    assert.deepEqual(groupRunRange(siblings, 1, true), { start: 1, end: 3 });
    assert.deepEqual(groupRunRange(siblings, 3, true), { start: 1, end: 3 });
    assert.equal(groupRunRange(siblings, 4, true), undefined);
    assert.equal(groupRunRange(siblings, 5, true), undefined);
    assert.equal(groupRunRange(siblings, 1, false), undefined);
  });
});
