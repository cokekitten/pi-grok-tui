import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CustomMessageComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { installCustomMessageCollapsePatch } from "./extensions/custom-message-collapse.ts";
import { getState } from "./extensions/state.ts";

initTheme("dark");

let undo;
before(async () => {
  undo = await installCustomMessageCollapsePatch();
});
after(() => undo());
beforeEach(() => {
  Object.assign(getState(), { toolViewMode: "chrome", globalExpanded: false });
});

// The supervisor request that pi-subagents renders as "[subagent] worker needs
// a decision" (src/tui/subagent-messages.js) instead of a raw custom type.
function supervisorRequest() {
  return {
    customType: "subagent_supervisor_request",
    content:
      "Subagent needs a supervisor decision.\n" +
      "Run: a55d821e-83f4-4f25-a504-00794d339261\n\n" +
      "两项是否批准？",
    details: { id: "0d50754d-b753-4906-8e62-938d564ea8c4" },
  };
}

function render(component, width = 96) {
  return component.render(width).join("\n");
}

describe("custom message collapse", () => {
  it("keeps the block an extension renderer draws", () => {
    const renderer = () => new Text("[subagent] worker needs a decision", 0, 0);
    const out = render(new CustomMessageComponent(supervisorRequest(), renderer, getMarkdownTheme()));

    assert.match(out, /\[subagent\] worker needs a decision/);
    assert.doesNotMatch(out, /\[subagent_supervisor_request\]/);
  });

  it("hands the renderer the collapsed state while chrome mode is active", () => {
    let seen;
    const renderer = (_message, options) => {
      seen = options.expanded;
      return new Text("[subagent] worker needs a decision", 0, 0);
    };
    render(new CustomMessageComponent(supervisorRequest(), renderer, getMarkdownTheme()));

    assert.equal(seen, false);
  });

  it("does not touch renderers when the user expanded tools", () => {
    getState().toolViewMode = "full";
    const renderer = () => new Text("[subagent] worker needs a decision", 0, 0);
    const message = supervisorRequest();
    const component = new CustomMessageComponent(message, renderer, getMarkdownTheme());
    const out = render(component);

    assert.match(out, /\[subagent\] worker needs a decision/);
    assert.doesNotMatch(out, /\[subagent_supervisor_request\]/);
  });

  it("falls back to the one-line chrome row when no renderer is registered", () => {
    const out = render(new CustomMessageComponent(supervisorRequest(), undefined, getMarkdownTheme()));

    assert.match(out, /\[subagent_supervisor_request\] Subagent needs a supervisor decision\. Run: a55d821e/);
    assert.doesNotMatch(out, /两项是否批准/);
  });

  it("falls back to the one-line chrome row when the renderer declines", () => {
    const out = render(new CustomMessageComponent(supervisorRequest(), () => undefined, getMarkdownTheme()));

    assert.match(out, /\[subagent_supervisor_request\] Subagent needs a supervisor decision\. Run: a55d821e/);
    assert.doesNotMatch(out, /\[subagent\]/);
  });

  it("keeps collapsing an unstyled message with its raw content", () => {
    const message = { customType: "background-task", content: "[MR577] opened can_be_merged\n|head=8b3d276a2", details: {} };
    const out = render(new CustomMessageComponent(message, undefined, getMarkdownTheme()));

    assert.match(out, /\[background-task\] \[MR577\] opened can_be_merged \|head=8b3d276a2/);
  });
});
