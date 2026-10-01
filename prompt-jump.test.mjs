import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findPromptRows,
  formatStrip,
  pickFloatTarget,
  PROMPT_ROW_RE,
} from "./extensions/prompt-jump-core.ts";

describe("findPromptRows", () => {
  it("matches OSC 133 prompt-start rows (BEL and ST)", () => {
    const lines = [
      "plain",
      "\x1b]133;A\x07\xe2\x9d\xaf hi",
      "\x1b]133;B\x07x",
      "\x1b]133;C\x07y",
      "x\x1b]133;A\x07z",
      "\x1b]133;A\x1b\\st row",
    ];
    assert.deepEqual(findPromptRows(lines), [1, 5]);
  });

  it("ignores empty lines and ANSI-only rows", () => {
    assert.deepEqual(findPromptRows(["", "\x1b[0m", "\x1b[2m\x1b[22m"]), []);
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(findPromptRows([]), []);
  });

  it("PROMPT_ROW_RE anchors at line start", () => {
    assert.equal(PROMPT_ROW_RE.test("\x1b]133;A\x07x"), true);
    assert.equal(PROMPT_ROW_RE.test(" \x1b]133;A\x07x"), false);
    assert.equal(PROMPT_ROW_RE.test("\x1b]133;B\x07x"), false);
  });
});

describe("pickFloatTarget", () => {
  it("returns undefined when no prompt rows", () => {
    assert.equal(pickFloatTarget([], 10), undefined);
  });

  it("picks the largest row strictly below scrollTop", () => {
    assert.equal(pickFloatTarget([3, 7, 12], 10), 7);
    assert.equal(pickFloatTarget([3, 7, 12], 100), 12);
  });

  it("excludes a prompt exactly at scrollTop", () => {
    assert.equal(pickFloatTarget([3, 7, 12], 12), 7);
  });

  it("returns undefined when nothing is above the viewport top", () => {
    assert.equal(pickFloatTarget([3, 7, 12], 3), undefined);
    assert.equal(pickFloatTarget([3, 7, 12], 0), undefined);
    assert.equal(pickFloatTarget([3, 7, 12], -5), undefined);
  });
});

describe("formatStrip", () => {
  it("strips OSC 133 prefixes and ANSI styling", () => {
    const raw =
      "\x1b]133;A\x07\x1b[38;2;196;167;231m\u276f\x1b[39m \x1b[2mhello\x1b[22m";
    assert.equal(formatStrip(raw, 100), "\u276f hello");
  });

  it("strips stacked OSC 133 zone prefixes", () => {
    assert.equal(formatStrip("\x1b]133;A\x07\x1b]133;B\x07x", 100), "x");
  });

  it("truncates ASCII with an ellipsis only when needed", () => {
    assert.equal(formatStrip("abcdef", 4), "abc\u2026");
    assert.equal(formatStrip("abc", 3), "abc");
  });

  it("truncates CJK by display width", () => {
    assert.equal(formatStrip("\u4e2d\u4e2d\u4e2d", 4), "\u4e2d\u2026");
  });

  it("returns empty string for empty or marker-only rows", () => {
    assert.equal(formatStrip("", 10), "");
    assert.equal(formatStrip("\x1b]133;A\x07", 10), "");
    assert.equal(formatStrip("anything", 0), "");
  });
});
