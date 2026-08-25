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

  it("registers a fullscreen OSC 8 fold target", () => {
    const line = renderThinkingChromeLine(40, theme, 11);
    assert.match(line, /\x1b\]8;;pi-grok-tui:\/\/v1\/fold\/think-11/);
    assert.equal(line.includes("Alt+T") || line.includes("⌥T"), false);
    assert.equal(dispatchGrokFoldUrl("pi-grok-tui://v1/fold/think-11"), true);
    assert.equal(thinkingIsExpanded(11), true);
  });
});
