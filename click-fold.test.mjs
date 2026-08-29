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
  injectFoldRow,
} from "./extensions/click-fold.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";
import { getOsc8LinkAtColumn } from "@earendil-works/pi-tui";
import {
  foldMarker,
  parseFoldMarker,
  clearFoldRegistry,
} from "./extensions/fold-body.ts";

const theme = {
  fg(_color, text) {
    return text;
  },
};

beforeEach(() => {
  resetFoldHandlers();
  resetClickFoldSession();
  clearFoldRegistry();
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
  it("registers the row for press lookup without emitting OSC 8", () => {
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
    // No OSC 8 in the emitted line: no dotted underlines on any terminal.
    assert.equal(line.includes("\x1b]8;;"), false);
    assert.equal(line.includes("Alt+T") || line.includes("⌥T"), false);
    assert.equal(parseFoldMarker(line), "think-1");
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/think-1"), true);
    assert.equal(clicks, 1);
  });

  it("keeps keyboard hints and emits no OSC 8 in regular mode", () => {
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

describe("injectFoldRow", () => {
  it("injects a fold hyperlink at y and restores the original row", () => {
    const painted = foldMarker("f9") + "  some body row";
    const rows = ["first", painted + "\x1b[0m\x1b]8;;\x07", "third"];
    const restore = injectFoldRow(rows, 1);
    assert.ok(restore);
    // pi's press now resolves the fold URL from the injected buffer.
    assert.equal(
      getOsc8LinkAtColumn(rows[1], 3),
      "pi-grok-tui://v1/fold/f9",
    );
    restore();
    assert.equal(rows[1], painted + "\x1b[0m\x1b]8;;\x07");
  });

  it("no-ops without a registered row, out-of-bounds y, or non-string rows", () => {
    assert.equal(injectFoldRow(["x", "y"], 0), undefined);
    assert.equal(injectFoldRow(undefined, 0), undefined);
    assert.equal(injectFoldRow(["x"], 5), undefined);
    assert.equal(injectFoldRow([null], 0), undefined);
    assert.equal(injectFoldRow([], 0), undefined);
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
