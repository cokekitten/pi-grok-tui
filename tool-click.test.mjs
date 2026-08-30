import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveToolMode,
  toggleToolAt,
  toggleGroupAt,
  classifySibling,
  collapsibleRun,
  toolChromeKind,
  nativePreviewFoldId,
} from "./extensions/tool-click.ts";
import {
  getState,
  resetClickFoldSession,
  clearToolFoldOverrides,
  getViewOverride,
  isGroupExpanded,
} from "./extensions/state.ts";
import {
  dispatchGrokFoldUrl,
  resetFoldHandlers,
} from "./extensions/click-fold.ts";
import { foldUrl } from "./extensions/click-fold-core.ts";

beforeEach(() => {
  resetClickFoldSession();
  resetFoldHandlers();
  getState().toolViewMode = "chrome";
});

describe("toolChromeKind", () => {
  it("uses this tool's running/error, not a group aggregate", () => {
    assert.equal(toolChromeKind({ running: true, isError: false }), "tool_run");
    assert.equal(toolChromeKind({ running: false, isError: true }), "tool_err");
    assert.equal(toolChromeKind({ running: false, isError: false }), "tool_ok");
    // A sibling failure must not paint this successful member red.
    const siblingFailed = true;
    const self = { running: false, isError: false };
    assert.equal(toolChromeKind(self), "tool_ok");
    assert.notEqual(toolChromeKind(self), siblingFailed ? "tool_err" : "tool_ok");
  });
});

describe("effectiveToolMode", () => {
  it("follows global mode then local override; edit stays full", () => {
    const read = { name: "read" };
    const edit = { name: "edit" };
    assert.equal(effectiveToolMode(read, "read"), "chrome");
    getState().toolViewMode = "full";
    assert.equal(effectiveToolMode(read, "read"), "full");
    toggleToolAt(read, "read");
    assert.equal(effectiveToolMode(read, "read"), "chrome");
    assert.equal(effectiveToolMode(edit, "edit"), "full");
  });

  it("maps write chrome to truncated and follows local truncated/full overrides", () => {
    const write = { name: "write" };
    const edit = { name: "edit" };
    assert.equal(effectiveToolMode(write, "write"), "truncated");
    getState().toolViewMode = "full";
    assert.equal(effectiveToolMode(write, "write"), "full");
    getState().toolViewMode = "truncated";
    assert.equal(effectiveToolMode(write, "write"), "truncated");
    toggleToolAt(write, "write");
    assert.equal(effectiveToolMode(write, "write"), "full");
    toggleToolAt(write, "write");
    assert.equal(effectiveToolMode(write, "write"), "truncated");
    assert.equal(getViewOverride(write), "truncated");
    assert.equal(effectiveToolMode(edit, "edit"), "full");
  });

  it("prefers updateDisplay and does not also rebuild", () => {
    let displays = 0;
    let rebuilds = 0;
    const tool = {
      updateDisplay() {
        displays += 1;
      },
      rebuild() {
        rebuilds += 1;
      },
    };
    toggleToolAt(tool, "bash");
    assert.equal(displays, 1);
    assert.equal(rebuilds, 0);
  });

  it("falls back to rebuild when updateDisplay is missing", () => {
    let rebuilds = 0;
    const custom = {
      rebuild() {
        rebuilds += 1;
      },
    };
    toggleToolAt(custom, "custom");
    assert.equal(rebuilds, 1);
  });

  it("read click goes chrome → truncated, bash goes chrome → full", () => {
    const read = {};
    const bash = {};
    toggleToolAt(read, "read");
    assert.equal(getViewOverride(read), "truncated");
    toggleToolAt(read, "read");
    assert.equal(getViewOverride(read), "chrome");
    toggleToolAt(bash, "bash");
    assert.equal(getViewOverride(bash), "full");
  });

  it("write click goes truncated ↔ full and never chrome", () => {
    const write = {};
    assert.equal(toggleToolAt(write, "write"), "full");
    assert.equal(getViewOverride(write), "full");
    assert.equal(toggleToolAt(write, "write"), "truncated");
    assert.equal(getViewOverride(write), "truncated");
  });
});

describe("nativePreviewFoldId", () => {
  it("registers a write body handler that toggles truncated ↔ full; edit gets none", () => {
    const write = {};
    const edit = {};
    const writeId = nativePreviewFoldId(write, "write");
    assert.equal(typeof writeId, "string");
    assert.ok(writeId.length > 0);
    assert.equal(nativePreviewFoldId(edit, "edit"), undefined);
    assert.equal(nativePreviewFoldId(write, "read"), undefined);

    assert.equal(dispatchGrokFoldUrl(foldUrl(writeId)), true);
    assert.equal(getViewOverride(write), "full");
    assert.equal(effectiveToolMode(write, "write"), "full");
    assert.equal(dispatchGrokFoldUrl(foldUrl(writeId)), true);
    assert.equal(getViewOverride(write), "truncated");
    assert.equal(effectiveToolMode(write, "write"), "truncated");
    assert.equal(getViewOverride(edit), undefined);
    assert.equal(effectiveToolMode(edit, "edit"), "full");
  });
});

describe("collapsibleRun", () => {
  it("groups consecutive collapsible tools across gaps even if a member is expanded", () => {
    const a = { toolName: "read", updateDisplay() {} };
    const b = { toolName: "read", updateDisplay() {} };
    const edit = { toolName: "edit", updateDisplay() {} };
    const write = { toolName: "write", updateDisplay() {} };
    const spacer = { lines: 1, render() { return [""]; } };
    const siblings = [{ kind: "user" }, a, spacer, b, edit, write];
    const classified = siblings.map(classifySibling);
    assert.deepEqual(classified, [
      { kind: "other" },
      { kind: "tool", toolName: "read" },
      { kind: "gap" },
      { kind: "tool", toolName: "read" },
      { kind: "tool", toolName: "edit" },
      { kind: "tool", toolName: "write" },
    ]);
    setViewOverrideLocal(b);
    const run = collapsibleRun(siblings, 1);
    assert.equal(run.members.length, 2);
    assert.equal(run.header, a);
    assert.equal(run.isHeader, true);
    const runB = collapsibleRun(siblings, 3);
    assert.equal(runB.header, a);
    assert.equal(runB.isHeader, false);
    assert.equal(collapsibleRun(siblings, 4).members.length, 1);
    assert.equal(collapsibleRun(siblings, 5).members.length, 1);
  });
});

describe("collapsed group vs member override", () => {
  it("keeps the run grouped after a member is locally expanded", () => {
    const a = { toolName: "read", updateDisplay() {} };
    const b = { toolName: "read", updateDisplay() {} };
    const siblings = [a, b];
    toggleToolAt(a, "read");
    assert.equal(effectiveToolMode(a, "read"), "truncated");
    const run = collapsibleRun(siblings, 0);
    assert.equal(run.members.length, 2);
    assert.equal(isGroupExpanded(a), false);
  });
});

describe("toggleGroupAt", () => {
  it("expands and collapses a group without clearing member overrides", () => {
    const header = {};
    const member = {};
    toggleToolAt(member, "read");
    assert.equal(getViewOverride(member), "truncated");
    assert.equal(isGroupExpanded(header), false);
    toggleGroupAt(header);
    assert.equal(isGroupExpanded(header), true);
    assert.equal(getViewOverride(member), "truncated");
    toggleGroupAt(header);
    assert.equal(isGroupExpanded(header), false);
    assert.equal(getViewOverride(member), "truncated");
  });

  it("Ctrl+O-style clear drops groups and tool overrides", () => {
    const header = {};
    const member = {};
    toggleToolAt(member, "bash");
    toggleGroupAt(header);
    getState().thinkingOverrides.set(1, true);
    clearToolFoldOverrides();
    assert.equal(getViewOverride(member), undefined);
    assert.equal(isGroupExpanded(header), false);
    assert.equal(getState().thinkingOverrides.get(1), true);
  });

  it("Ctrl+O-style clear returns write to truncated, not chrome", () => {
    const write = {};
    toggleToolAt(write, "write");
    assert.equal(effectiveToolMode(write, "write"), "full");
    clearToolFoldOverrides();
    assert.equal(getViewOverride(write), undefined);
    assert.equal(effectiveToolMode(write, "write"), "truncated");
  });
});

function setViewOverrideLocal(obj) {
  toggleToolAt(obj, "read");
}
