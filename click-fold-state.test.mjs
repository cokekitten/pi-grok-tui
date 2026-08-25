import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  resetClickFoldSession,
  clearToolFoldOverrides,
  getViewOverride,
  setViewOverride,
  isGroupExpanded,
  setGroupExpanded,
} from "./extensions/state.ts";

beforeEach(() => {
  resetClickFoldSession();
  const state = getState();
  state.tuiMode = "regular";
  state.clickFoldReady = false;
  state.globalExpanded = false;
  state.toolViewMode = "chrome";
});

describe("click-fold session state", () => {
  it("defaults tuiMode regular, clickFoldReady false, empty thinking overrides", () => {
    const state = getState();
    assert.equal(state.tuiMode, "regular");
    assert.equal(state.clickFoldReady, false);
    assert.equal(state.thinkingOverrides.size, 0);
  });

  it("stores thinking overrides until session reset", () => {
    const state = getState();
    state.thinkingOverrides.set(42, true);
    assert.equal(state.thinkingOverrides.get(42), true);
    resetClickFoldSession();
    assert.equal(getState().thinkingOverrides.size, 0);
    assert.equal(getState().thinkingOverrides.get(42), undefined);
  });

  it("stores per-object view overrides until reset", () => {
    const tool = { name: "read" };
    assert.equal(getViewOverride(tool), undefined);
    setViewOverride(tool, "full");
    assert.equal(getViewOverride(tool), "full");
    resetClickFoldSession();
    assert.equal(getViewOverride(tool), undefined);
  });

  it("tracks expanded group headers until reset", () => {
    const header = { toolName: "read" };
    assert.equal(isGroupExpanded(header), false);
    setGroupExpanded(header, true);
    assert.equal(isGroupExpanded(header), true);
    setGroupExpanded(header, false);
    assert.equal(isGroupExpanded(header), false);
    setGroupExpanded(header, true);
    resetClickFoldSession();
    assert.equal(isGroupExpanded(header), false);
  });

  it("clearToolFoldOverrides keeps thinking overrides", () => {
    const tool = { name: "bash" };
    const header = { toolName: "read" };
    const state = getState();
    state.thinkingOverrides.set(7, true);
    setViewOverride(tool, "truncated");
    setGroupExpanded(header, true);
    clearToolFoldOverrides();
    assert.equal(getState().thinkingOverrides.get(7), true);
    assert.equal(getViewOverride(tool), undefined);
    assert.equal(isGroupExpanded(header), false);
  });

  it("resetClickFoldSession does not change tuiMode or clickFoldReady", () => {
    const state = getState();
    state.tuiMode = "fullscreen";
    state.clickFoldReady = true;
    resetClickFoldSession();
    assert.equal(getState().tuiMode, "fullscreen");
    assert.equal(getState().clickFoldReady, true);
  });
});
