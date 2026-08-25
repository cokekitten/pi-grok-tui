import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import {
  resetFoldHandlers,
  registerFoldHandler,
  dispatchGrokFoldUrl,
  newFoldId,
  idForTarget,
  thinkingFoldId,
  renderClickableChrome,
  installClickFoldPatch,
  withFoldOpenUrl,
} from "./extensions/click-fold.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

const theme = {
  fg(_color, text) {
    return text;
  },
};

beforeEach(() => {
  resetFoldHandlers();
  resetClickFoldSession();
  const state = getState();
  state.tuiMode = "regular";
  state.clickFoldReady = false;
});

describe("dispatchGrokFoldUrl", () => {
  it("invokes the registered handler and claims the URL", () => {
    let n = 0;
    registerFoldHandler("abc", () => {
      n += 1;
    });
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/abc"), true);
    assert.equal(n, 1);
  });

  it("does not claim https or file URLs", () => {
    assert.equal(dispatchGrokFoldUrl("https://example.com"), false);
    assert.equal(dispatchGrokFoldUrl("file:///tmp/x"), false);
  });

  it("claims stale and malformed pi-grok-tui URLs without throwing", () => {
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/missing"), true);
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/nope"), true);
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://"), true);
  });

  it("swallows handler throws and still claims the URL", () => {
    registerFoldHandler("boom", () => {
      throw new Error("handler failed");
    });
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/boom"), true);
  });

  it("resetFoldHandlers drops stale handlers", () => {
    let n = 0;
    registerFoldHandler("abc", () => {
      n += 1;
    });
    resetFoldHandlers();
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/abc"), true);
    assert.equal(n, 0);
  });
});

describe("fold ids", () => {
  it("issues monotonic ids and stable per-object ids", () => {
    const a = newFoldId();
    const b = newFoldId();
    assert.notEqual(a, b);
    const obj = {};
    assert.equal(idForTarget(obj), idForTarget(obj));
    assert.notEqual(idForTarget(obj), idForTarget({}));
    assert.equal(thinkingFoldId(99), "think-99");
  });
});

describe("withFoldOpenUrl", () => {
  it("consumes grok URLs and forwards other schemes", () => {
    const opened = [];
    let clicks = 0;
    let renders = 0;
    registerFoldHandler("abc", () => {
      clicks += 1;
    });
    const self = {
      openUrl(url) {
        opened.push(url);
      },
      requestRender() {
        renders += 1;
      },
    };
    withFoldOpenUrl(self, () => {
      self.openUrl("https://example.com");
      self.openUrl("pi-grok-tui://v1/fold/abc");
      self.openUrl("pi-grok-tui://v1/fold/stale");
    });
    assert.deepEqual(opened, ["https://example.com"]);
    assert.equal(clicks, 1);
    assert.equal(renders, 2);
    assert.equal(typeof self.openUrl, "function");
  });
});

describe("renderClickableChrome", () => {
  it("wraps OSC 8 only in fullscreen when click-fold is ready", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    let clicks = 0;
    const line = renderClickableChrome(80, theme, {
      kind: "thinking",
      label: "Thought",
      hintKind: "thinking",
      id: "think-1",
      onClick: () => {
        clicks += 1;
      },
    });
    assert.match(line, /\x1b\]8;;pi-grok-tui:\/\/v1\/fold\/think-1/);
    assert.equal(line.includes("Alt+T") || line.includes("⌥T"), false);
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/think-1"), true);
    assert.equal(clicks, 1);
  });

  it("keeps keyboard hints and skips OSC 8 in regular mode", () => {
    const state = getState();
    state.tuiMode = "regular";
    state.clickFoldReady = true;
    const line = renderClickableChrome(80, theme, {
      kind: "tool_ok",
      label: "Read `a.ts`",
      hintKind: "tool",
      id: "t1",
      onClick: () => {},
    });
    assert.equal(line.includes("\x1b]8;;"), false);
    assert.ok(line.includes("(Ctrl+O)"));
  });
});

describe("installClickFoldPatch", () => {
  let cleanup;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("marks click-fold ready when TuiAltScreen mouse handling exists", () => {
    assert.equal(
      typeof TuiAltScreen.prototype.handleSelectionMouseEvent,
      "function",
    );
    assert.equal(typeof TuiAltScreen.prototype.doRender, "function");
    assert.equal(typeof TuiMainScreen.prototype.doRender, "function");
    cleanup = installClickFoldPatch();
    assert.equal(getState().clickFoldReady, true);
    cleanup();
    cleanup = undefined;
    assert.equal(getState().clickFoldReady, false);
  });
});
