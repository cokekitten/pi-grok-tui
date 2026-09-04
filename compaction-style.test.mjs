import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RESPONSE_LEFT_PAD } from "./extensions/chrome.ts";
import {
  compactedLabel,
  paintCompactionChrome,
} from "./extensions/compaction-chrome.ts";
import { parseFoldMarker } from "./extensions/fold-body.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";
import { resetFoldHandlers } from "./extensions/click-fold.ts";

function stripDecorations(s) {
  return s
    .replace(/\x1b\]9999;[^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "");
}

const NATIVE_CUSTOM_BG = "48;2;45;40;56";

const theme = {
  fg(_color, text) {
    return text;
  },
};

class FakeBox {
  paddingX = 1;
  paddingY = 1;
  bgFn = (t) => `\x1b[48;2;45;40;56m${t}\x1b[49m`;
  children = [];
  expanded = false;
  message;
  markdownTheme = {
    heading: (t) => t,
    link: (t) => t,
    linkUrl: (t) => t,
    code: (t) => t,
    codeBlock: (t) => t,
    codeBlockBorder: (t) => t,
    quote: (t) => t,
    quoteBorder: (t) => t,
    hr: (t) => t,
    listBullet: (t) => t,
    bold: (t) => t,
    italic: (t) => t,
    strikethrough: (t) => t,
    underline: (t) => t,
  };

  constructor(message) {
    this.message = message;
  }

  setBgFn(fn) {
    this.bgFn = fn;
  }

  clear() {
    this.children = [];
  }

  addChild(c) {
    this.children.push(c);
  }

  render(width) {
    const pad = " ".repeat(this.paddingX ?? 0);
    const inner = Math.max(1, width - (this.paddingX ?? 0) * 2);
    const lines = [];
    for (const child of this.children) {
      for (const line of child.render(inner)) {
        lines.push(this.bgFn(pad + line));
      }
    }
    return lines;
  }
}

beforeEach(() => {
  resetFoldHandlers();
  resetClickFoldSession();
  const state = getState();
  state.tuiMode = "fullscreen";
  state.clickFoldReady = true;
  state.toolViewMode = "chrome";
});

describe("compaction grok chrome", () => {
  it("formats the collapsed title without a [compaction] prefix", () => {
    assert.equal(compactedLabel(246080), "Compacted from 246,080 tokens");
  });

  it("collapses to an indented Grok title without native purple chrome", () => {
    const component = new FakeBox({
      tokensBefore: 246080,
      summary: "Kept the login 3D scene work.",
    });
    paintCompactionChrome(component, theme);
    const lines = component.render(72);
    const visible = lines.map(stripDecorations);
    const joined = visible.join("\n");

    assert.equal(joined.includes("[compaction]"), false);
    assert.equal(lines.some((line) => line.includes(NATIVE_CUSTOM_BG)), false);
    assert.ok(
      visible.some((line) => line.includes("Compacted from 246,080 tokens")),
      joined,
    );
    const title = visible.find((line) =>
      line.includes("Compacted from 246,080 tokens"),
    );
    assert.ok(title.startsWith(" ".repeat(RESPONSE_LEFT_PAD)));
    assert.equal(title.startsWith(" ".repeat(RESPONSE_LEFT_PAD + 1)), false);
    assert.ok(title.includes("◇") || title.includes("◆"));
    assert.ok(lines.some((line) => parseFoldMarker(line)));
  });

  it("keeps the summary under the same chrome when expanded", () => {
    getState().toolViewMode = "full";
    const component = new FakeBox({
      tokensBefore: 246080,
      summary: "Kept the login 3D scene work.",
    });
    paintCompactionChrome(component, theme);
    const lines = component.render(72);
    const visible = lines.map(stripDecorations).join("\n");
    assert.equal(visible.includes("[compaction]"), false);
    assert.ok(visible.includes("Compacted from 246,080 tokens"));
    assert.ok(visible.includes("Kept the login 3D scene work."));
    assert.equal(lines.some((line) => line.includes(NATIVE_CUSTOM_BG)), false);
  });
});
