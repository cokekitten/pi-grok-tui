import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveToolMode,
  toggleToolAt,
  toggleGroupAt,
  classifySibling,
  collapsibleRun,
} from "./extensions/tool-click.ts";
import {
  getState,
  resetClickFoldSession,
  clearToolFoldOverrides,
  getViewOverride,
  isGroupExpanded,
} from "./extensions/state.ts";

beforeEach(() => {
  resetClickFoldSession();
  getState().toolViewMode = "chrome";
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
});

describe("collapsibleRun", () => {
  it("groups consecutive collapsible tools across gaps even if a member is expanded", () => {
    const a = { toolName: "read", updateDisplay() {} };
    const b = { toolName: "read", updateDisplay() {} };
    const edit = { toolName: "edit", updateDisplay() {} };
    const spacer = { lines: 1, render() { return [""]; } };
    const siblings = [{ kind: "user" }, a, spacer, b, edit];
    const classified = siblings.map(classifySibling);
    assert.deepEqual(classified, [
      { kind: "other" },
      { kind: "tool", toolName: "read" },
      { kind: "gap" },
      { kind: "tool", toolName: "read" },
      { kind: "tool", toolName: "edit" },
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
});

function setViewOverrideLocal(obj) {
  toggleToolAt(obj, "read");
}
