import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { markUserMessageRows, findUserMessageTarget, formatStrip } from "./extensions/prompt-jump-core.ts";

const prompt = "\x1b]133;A\x07";
const end = "\x1b]133;B\x07\x1b]133;C\x07";
const user = (text) => markUserMessageRows([prompt + "  ", ` ❯ ${text} `, end + "  "]);

describe("user-only rendered anchors", () => {
  it("does not mutate cached lines or native OSC 133, and preserves row widths", () => {
    const rows = [prompt + "  ", " ❯ hello ", end + "  "];
    const saved = [...rows];
    const marked = markUserMessageRows(rows);
    assert.deepEqual(rows, saved);
    assert.notEqual(marked, rows);
    assert.ok(marked[0].startsWith(prompt));
    assert.deepEqual(marked.map(visibleWidth), rows.map(visibleWidth));
    assert.deepEqual(marked.map(stripTerminalSequences), rows.map(stripTerminalSequences));
    assert.deepEqual(markUserMessageRows(marked), marked);
  });

  it("takes the preview from the real body, not the empty prompt padding", () => {
    assert.deepEqual(findUserMessageTarget(user("hello"), 2), { row: 0, preview: "❯ hello" });
  });

  it("ignores assistant OSC 133 zones even when they contain a quoted ❯", () => {
    const rows = [...user("first"), prompt, "❯ assistant quote", end, ...user("second"), prompt, "assistant answer", end];
    assert.deepEqual(findUserMessageTarget(rows, 9), { row: 6, preview: "❯ second" });
    assert.deepEqual(findUserMessageTarget(rows, 6), { row: 0, preview: "❯ first" });
  });

  it("never borrows a later message as an empty user's preview", () => {
    const rows = [...markUserMessageRows([prompt, end]), "assistant answer", ...user("later")];
    assert.equal(findUserMessageTarget(rows, 2), undefined);
    const incomplete = [...markUserMessageRows([""]), ...user("later")];
    assert.equal(findUserMessageTarget(incomplete, 1), undefined);
  });

  it("handles a one-row message and successive jumps to the beginning", () => {
    const rows = markUserMessageRows(["❯ single"]);
    assert.deepEqual(findUserMessageTarget(rows, 1), { row: 0, preview: "❯ single" });
    assert.equal(findUserMessageTarget(rows, 0), undefined);
    assert.equal(findUserMessageTarget(rows, -1), undefined);
    assert.equal(findUserMessageTarget(rows, NaN), undefined);
    assert.equal(findUserMessageTarget([], 5), undefined);
    assert.deepEqual(markUserMessageRows([]), []);
  });
});

describe("formatStrip", () => {
  it("strips private anchors and other terminal styling", () => {
    const raw = markUserMessageRows([prompt + "\x1b[31m❯ hello\x1b[0m"])[0];
    assert.equal(formatStrip(raw, 100), "❯ hello");
  });
  it("truncates ASCII only when necessary, without leaking ANSI resets", () => {
    assert.equal(formatStrip("abcdef", 4), "abc…");
    assert.equal(formatStrip("abc", 3), "abc");
  });
  it("truncates CJK and emoji using display columns", () => {
    assert.equal(formatStrip("中中中", 4), "中…");
    const text = formatStrip("❯ 🐈🐈🐈🐈", 7);
    assert.ok(visibleWidth(text) <= 7);
    assert.ok(text.endsWith("…"));
  });
  it("returns empty for blank content or invalid width", () => {
    assert.equal(formatStrip("", 10), "");
    assert.equal(formatStrip(prompt, 10), "");
    assert.equal(formatStrip("text", 0), "");
    assert.equal(formatStrip("text", Infinity), "");
  });
});
