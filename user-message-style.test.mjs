import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Box, Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { ansiBgHex, ansiFgHex } from "./extensions/chrome.ts";
import {
  createArrowMarkdownBody,
  USER_MESSAGE_ARROW,
  USER_MESSAGE_ARROW_FG,
  USER_MESSAGE_BG,
} from "./extensions/user-message-body.ts";

// ---------------------------------------------------------------------------
// Reference (old) implementation: verbatim copy of the pre-rewrite
// user-message-style.ts render path (Box(outputPad, 1, ansiBgHex) wrapping the
// arrow Markdown body). The rewrite must match it byte for byte.
// ---------------------------------------------------------------------------

const passthroughTheme = {
  bold: (s) => s,
  italic: (s) => s,
  underline: (s) => s,
  strikethrough: (s) => s,
  heading: (s) => s,
  code: (s) => s,
  codeBlock: (s) => s,
  codeBlockBorder: (s) => s,
  listBullet: (s) => s,
  quote: (s) => s,
  quoteBorder: (s) => s,
  link: (s) => s,
  linkUrl: (s) => s,
  hr: (s) => s,
  codeBlockIndent: "  ",
};

function oldArrowBody(text) {
  const arrow = ansiFgHex(USER_MESSAGE_ARROW_FG, USER_MESSAGE_ARROW) + " ";
  // ❯ + space → 2 columns in typical terminals
  const pad = "  ";

  const md = new Markdown(
    text,
    0,
    0,
    passthroughTheme,
    {
      color: (content) => content,
    },
    { preserveOrderedListMarkers: true, preserveBackslashEscapes: true },
  );

  return {
    render(width) {
      const bodyWidth = Math.max(1, width - 2);
      let lines;
      try {
        lines = md.render(bodyWidth);
      } catch {
        lines = [text];
      }
      if (lines.length === 0) return [arrow.trimEnd()];
      return lines.map((line, i) => (i === 0 ? arrow + line : pad + line));
    },
  };
}

function oldRender(text, width, outputPad = 1) {
  const contentBox = new Box(outputPad, 1, (content) =>
    ansiBgHex(USER_MESSAGE_BG, content),
  );
  contentBox.addChild(oldArrowBody(text));
  return contentBox.render(width);
}

// ---------------------------------------------------------------------------
// New implementation under test.
// ---------------------------------------------------------------------------

function newRender(text, width, outputPad = 1) {
  return createArrowMarkdownBody(
    text,
    passthroughTheme,
    (_color, content) => content,
    outputPad,
  ).render(width);
}

const TEXTS = [
  "hello world",
  "two\nlines",
  "**bold** and `code`",
  "- a\n- b\n  - nested",
  "3. ordered\n4. lists",
  "```js\nconst x = 1;\n```",
  "> quoted text",
  "你好世界，这是一段用于验证折行宽度逐字节一致的中文用户消息。",
  "a".repeat(200),
  "word ".repeat(30),
  "   ",
  "",
  "\\*escaped\\* not italic",
  "# Heading\nbody text",
];

describe("user-message body is byte-identical to the old Box pipeline", () => {
  for (const text of TEXTS) {
    for (const width of [80, 40, 20, 12, 6]) {
      const label = `${JSON.stringify(text).slice(0, 26)} @${width}`;
      it(label, () => {
        assert.deepEqual(newRender(text, width), oldRender(text, width));
      });
    }
  }

  it("byte-identical at outputPad=2", () => {
    assert.deepEqual(
      newRender("hello\nworld", 40, 2),
      oldRender("hello\nworld", 40, 2),
    );
  });

  it("byte-identical for the same text at two widths (cache key includes width)", () => {
    const body = createArrowMarkdownBody("re", passthroughTheme, (_c, s) => s);
    const wide = body.render(40);
    const narrow = body.render(20);
    assert.deepEqual(narrow, oldRender("re", 20));
    assert.deepEqual(wide, oldRender("re", 40));
  });
});

describe("user-message body internals", () => {
  it("returns cached output (stable string identity across renders)", () => {
    const body = createArrowMarkdownBody(
      "cached **text**",
      passthroughTheme,
      (_c, s) => s,
    );
    const a = body.render(60);
    const b = body.render(60);
    assert.equal(a, b); // same array reference
    assert.ok(a.every((line) => typeof line === "string"));
    body.invalidate?.();
    const c = body.render(60);
    assert.notEqual(c, a); // recomputed array…
    assert.deepEqual(c, a); // …with identical content
  });

  it("keeps the #0f1217 bubble and #c4a7e7 arrow colors", () => {
    const out = newRender("colored", 40);
    assert.ok(out.length >= 3);
    for (const line of out) {
      assert.ok(line.includes("\x1b[48;2;15;18;23m"), line); // #0f1217 bg
    }
    assert.ok(out[1].includes("\x1b[38;2;196;167;231m❯"), out[1]); // #c4a7e7 fg
    assert.ok(!out[2].includes("❯"), out[2]); // arrow only on the first line
  });

  it("renders every line at the full visible width", () => {
    for (const width of [80, 40, 20]) {
      for (const line of newRender("width check 你好", width)) {
        assert.equal(visibleWidth(line), width);
      }
    }
  });
});
