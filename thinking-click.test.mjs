import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  thinkingIsExpanded,
  toggleThinkingAt,
  renderThinkingChromeLine,
  applyGlobalThinkingToggle,
} from "./extensions/thinking-click.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";
import { dispatchGrokFoldUrl, resetFoldHandlers } from "./extensions/click-fold.ts";
import { parseFoldMarker } from "./extensions/fold-body.ts";

const theme = {
  fg(_color, text) {
    return text;
  },
};

beforeEach(() => {
  resetFoldHandlers();
  resetClickFoldSession();
  const state = getState();
  state.globalExpanded = false;
  state.tuiMode = "fullscreen";
  state.clickFoldReady = true;
});

describe("thinking click helpers", () => {
  it("toggles only that timestamp", () => {
    assert.equal(thinkingIsExpanded(11), false);
    toggleThinkingAt(11);
    assert.equal(thinkingIsExpanded(11), true);
    assert.equal(thinkingIsExpanded(12), false);
    toggleThinkingAt(11);
    assert.equal(thinkingIsExpanded(11), false);
  });

  it("follows globalExpanded when there is no override", () => {
    getState().globalExpanded = true;
    assert.equal(thinkingIsExpanded(11), true);
    toggleThinkingAt(11);
    assert.equal(thinkingIsExpanded(11), false);
    getState().thinkingOverrides.clear();
    assert.equal(thinkingIsExpanded(11), true);
  });

  it("global toggle clears per-row thinking overrides", () => {
    toggleThinkingAt(11);
    assert.equal(thinkingIsExpanded(11), true);
    const expanded = applyGlobalThinkingToggle();
    assert.equal(expanded, true);
    assert.equal(getState().thinkingOverrides.size, 0);
    assert.equal(thinkingIsExpanded(11), true);
  });

  it("registers a fullscreen fold row via press lookup (no OSC 8)", () => {
    const line = renderThinkingChromeLine(40, theme, 11);
    // No OSC 8 in the row: no dotted underline on Windows Terminal / wetty.
    assert.equal(line.includes("\x1b]8;;"), false);
    assert.equal(line.includes("Alt+T") || line.includes("⌥T"), false);
    assert.equal(parseFoldMarker(line), "think-11");
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/think-11"), true);
    assert.equal(thinkingIsExpanded(11), true);
  });
});
