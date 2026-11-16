import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  ToolExecutionComponent,
  getMarkdownTheme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import { installCustomMessageCollapsePatch } from "./extensions/custom-message-collapse.ts";
import {
  dispatchGrokFoldUrl,
  groupFoldId,
  idForTarget,
  installClickFoldPatch,
  resetFoldHandlers,
  thinkingFoldId,
} from "./extensions/click-fold.ts";
import { installToolViewCyclePatch } from "./extensions/tool-view-cycle.ts";
import { foldUrl } from "./extensions/click-fold-core.ts";
import { parseFoldMarker } from "./extensions/fold-body.ts";
import { installParentStamp } from "./extensions/parent-stamp.ts";
import { installThinkingPatch } from "./extensions/thinking-patch.ts";
import { installToolCollapsePatch } from "./extensions/tool-collapse.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

initTheme("dark", false);

// Mirrors pi-subagents SubagentMessageBlock (Box(1, 1, customMessageBg) + MouseRegion + Markdown).
function makeSubagentBlockRenderer(headline, body) {
  return (_source, options, theme) => {
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    const content = new Container();
    const title = `${theme.fg("warning", theme.bold("[subagent]"))} ${theme.fg("customMessageText", headline)}`;
    const line = options.expanded
      ? title
      : `${title} ${theme.fg("dim", "(ctrl+o to expand)")}`;
    content.addChild({ render: () => [line], invalidate() {} });
    if (options.expanded && body) {
      content.addChild(new Spacer(1));
      content.addChild(
        new Markdown(body, 0, 0, getMarkdownTheme(), {
          color: (t) => theme.fg("customMessageText", t),
        }),
      );
    }
    let internalClicks = 0;
    box.addChild(
      new MouseRegion(content, (ev) => {
        if (ev.type === "click") {
          internalClicks += 1;
          return { handled: true };
        }
        return undefined;
      }),
    );
    box._internalClicks = () => internalClicks;
    return box;
  };
}

// Mirrors pi-intercom InlineMessageComponent (wireframe card + handleMouse).
function makeIntercomRenderer() {
  return (message, options, theme) => {
    const sender = message.details?.from?.name ?? "peer";
    const text = message.details?.bodyText ?? message.details?.message?.content?.text ?? "";
    let expanded = options.expanded;
    return {
      handleMouse(ev) {
        if (ev.type === "click") {
          expanded = !expanded;
          return { handled: true, render: true };
        }
        return undefined;
      },
      invalidate() {},
      render() {
        if (!expanded) {
          return [
            theme.fg("muted", `╭ From: ${sender} (/home/cokekitten/dev)  Ctrl+O expands ───╮`),
            theme.fg("text", `│${text.slice(0, 40)}│`),
            theme.fg("dim", "│ Ctrl+O to expand · Click message (fullscreen) │"),
            theme.fg("muted", "╰──────────────────────────────────────────────╯"),
          ];
        }
        return [
          theme.fg("muted", `╭ From: ${sender} ───╮`),
          theme.fg("text", `│${text}│`),
          theme.fg("muted", "╰────────────────────╯"),
        ];
      },
    };
  };
}

function addCustomEntryViaPi(entry, renderer, toolOutputExpanded = false) {
  let added;
  InteractiveMode.prototype.addCustomEntryToChat.call(
    {
      outputPad: 1,
      toolOutputExpanded,
      session: {
        extensionRunner: {
          getEntryRenderer: () => renderer,
        },
      },
      chatContainer: {
        children: [],
        addChild(c) {
          added = c;
        },
      },
    },
    entry,
  );
  return added;
}

function supervisorRequest() {
  return {
    customType: "subagent_supervisor_request",
    content:
      "Subagent needs a supervisor decision.\n" +
      "Run: a55d821e-83f4-4f25-a504-00794d339261\n\n" +
      "两项是否批准？",
    details: { id: "0d50754d-b753-4906-8e62-938d564ea8c4", agent: "worker" },
  };
}

function supervisorReplyEntry() {
  return {
    type: "custom",
    id: "reply-1",
    parentId: null,
    timestamp: "2026-11-15T04:00:00Z",
    customType: "subagent_supervisor_reply",
    data: {
      requestId: "0d50754d",
      runId: "a55d821e",
      agent: "worker",
      childIndex: 0,
      message: "已放行 worker 修改 config.default.ts",
    },
  };
}

function intercomMessage() {
  return {
    customType: "intercom_message",
    content: "**From subagent-chat-01a07d4d-0da4-717e** (/home/cokekitten/dev)\n\n方案都对，补两个细节，实现时顺手处理",
    details: {
      from: {
        id: "01a07d4d-0da4-717e-94d7-b527759013cc",
        name: "subagent-chat-01a07d4d-0da4-717e",
        cwd: "/home/cokekitten/dev",
      },
      message: {
        id: "m1",
        content: { text: "方案都对，补两个细节，实现时顺手处理：1. 只缓存 {sha, size}" },
      },
    },
  };
}

const stripEsc = (s) =>
  s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

// Any 48;... background escape (e.g. customMessageBg purple wash)
const BG_ESC_RE = /\x1b\[48;/;

describe("custom message & custom entry Grok chrome collapse", () => {
  let cleanups = [];
  let customCleanup;

  before(async () => {
    cleanups.push(installClickFoldPatch());
    cleanups.push(installParentStamp());
    cleanups.push(await installThinkingPatch());
    cleanups.push(await installToolCollapsePatch());
    cleanups.push(await installToolViewCyclePatch());
    customCleanup = await installCustomMessageCollapsePatch();
    cleanups.push(() => customCleanup?.());
  });

  after(() => {
    for (const fn of cleanups.reverse()) fn?.();
  });

  beforeEach(() => {
    resetFoldHandlers();
    resetClickFoldSession();
    Object.assign(getState(), {
      toolViewMode: "chrome",
      globalExpanded: false,
      tuiMode: "fullscreen",
      clickFoldReady: true,
      hoveredFoldId: undefined,
    });
  });

  it("collapses subagent CustomMessageComponent to a single ◇ chrome row without purple bg", () => {
    const renderer = makeSubagentBlockRenderer("worker needs a decision", "两项是否批准？");
    const comp = new CustomMessageComponent(supervisorRequest(), renderer, getMarkdownTheme());
    const lines = comp.render(100);

    assert.equal(lines.length, 1, `expected 1 line, got ${lines.length}: ${JSON.stringify(lines)}`);
    assert.doesNotMatch(lines[0], BG_ESC_RE, "must not paint customMessageBg purple block");
    assert.equal(stripEsc(lines[0]), "  ◇ [subagent] worker needs a decision");
    // Scroll perf invariant: cached array reference
    assert.equal(comp.render(100), lines);
  });

  it("collapses subagent CustomEntryComponent (reply sent to worker) to a single ◇ chrome row without purple bg", () => {
    const renderer = makeSubagentBlockRenderer("reply sent to worker", "已放行 worker 修改 config.default.ts");
    const entryComp = addCustomEntryViaPi(supervisorReplyEntry(), renderer, false);

    assert.ok(entryComp, "CustomEntryComponent must keep hasContent() === true");
    const lines = entryComp.render(100);
    assert.equal(lines.length, 1, `expected 1 line, got ${lines.length}: ${JSON.stringify(lines)}`);
    assert.doesNotMatch(lines[0], BG_ESC_RE, "must not paint customMessageBg purple block");
    assert.equal(stripEsc(lines[0]), "  ◇ [subagent] reply sent to worker");
    assert.equal(entryComp.render(100), lines);
  });

  it("lets CustomEntryComponent stay omitted when its entry renderer returns undefined", () => {
    const entryComp = addCustomEntryViaPi(supervisorReplyEntry(), () => undefined, false);
    assert.equal(entryComp, undefined);
  });

  it("collapses pi-intercom cards to a single ◇ [intercom] chrome row in chrome mode", () => {
    const comp = new CustomMessageComponent(intercomMessage(), makeIntercomRenderer(), getMarkdownTheme());
    const lines = comp.render(120);

    assert.equal(lines.length, 1);
    assert.equal(
      stripEsc(lines[0]),
      "  ◇ [intercom] From subagent-chat-01a07d4d-0da4-717e: 方案都对，补两个细节，实现时顺手处理：1. 只缓存 {sha, size}",
    );
    assert.doesNotMatch(lines[0], /╭|╰/);
  });

  it("expands on fullscreen click without purple bg and collapses when clicking any expanded body row", () => {
    const renderer = makeSubagentBlockRenderer("worker needs a decision", "两项是否批准？");
    const comp = new CustomMessageComponent(supervisorRequest(), renderer, getMarkdownTheme());
    const id = idForTarget(comp);

    // Collapsed -> click chrome row -> expands
    comp.render(100);
    assert.equal(dispatchGrokFoldUrl(foldUrl(id)), true);

    const expandedLines = comp.render(100);
    assert.ok(expandedLines.length >= 2, "expanded view should render body");
    for (const line of expandedLines) {
      assert.doesNotMatch(line, BG_ESC_RE, "expanded view must strip customMessageBg");
      assert.equal(parseFoldMarker(line), id, "every expanded row must carry fold marker");
    }
    assert.match(stripEsc(expandedLines.join("\n")), /两项是否批准/);

    // SubagentMessageBlock's inner MouseRegion must NOT hijack component.handleMouse
    const mouseRes = comp.handleMouse?.({
      type: "click",
      button: "left",
      x: 4,
      y: expandedLines.length - 1,
      screenX: 4,
      screenY: expandedLines.length - 1,
      width: 100,
      height: expandedLines.length,
    });
    assert.equal(mouseRes, undefined, "inner MouseRegion must not swallow body fold clicks");

    // Clicking expanded body folds back to 1-line chrome
    assert.equal(dispatchGrokFoldUrl(foldUrl(id)), true);
    const collapsedAgain = comp.render(100);
    assert.equal(collapsedAgain.length, 1);
    assert.equal(stripEsc(collapsedAgain[0]), "  ◇ [subagent] worker needs a decision");
  });

  it("expands intercom card on click and does not let InlineMessageComponent.handleMouse hijack fold-back", () => {
    const comp = new CustomMessageComponent(intercomMessage(), makeIntercomRenderer(), getMarkdownTheme());
    const id = idForTarget(comp);

    comp.render(100);
    assert.equal(dispatchGrokFoldUrl(foldUrl(id)), true);
    const expanded = comp.render(100);
    assert.ok(expanded.length >= 3);
    assert.match(stripEsc(expanded.join("\n")), /方案都对，补两个细节，实现时顺手处理：1. 只缓存/);
    for (const line of expanded) {
      assert.equal(parseFoldMarker(line), id);
    }

    const mouseRes = comp.handleMouse?.({
      type: "click",
      button: "left",
      x: 4,
      y: 1,
      screenX: 4,
      screenY: 1,
      width: 100,
      height: expanded.length,
    });
    assert.equal(mouseRes, undefined);

    assert.equal(dispatchGrokFoldUrl(foldUrl(id)), true);
    const reCollapsed = comp.render(100);
    assert.equal(reCollapsed.length, 1);
    assert.ok(stripEsc(reCollapsed[0]).startsWith("  ◇ [intercom] From subagent-chat-"));
  });

  it("falls back to [customType] one-line chrome when no renderer is registered or renderer declines", () => {
    const noRenderer = new CustomMessageComponent(supervisorRequest(), undefined, getMarkdownTheme());
    assert.match(
      stripEsc(noRenderer.render(100).join("\n")),
      /^  ◇ \[subagent_supervisor_request\] Subagent needs a supervisor decision\. Run: a55d821e/,
    );

    const declined = new CustomMessageComponent(supervisorRequest(), () => undefined, getMarkdownTheme());
    assert.match(
      stripEsc(declined.render(100).join("\n")),
      /^  ◇ \[subagent_supervisor_request\] Subagent needs a supervisor decision\. Run: a55d821e/,
    );

    const bgTask = new CustomMessageComponent(
      { customType: "background-task", content: "[MR577] opened\n|head=8b3d276a2", details: {} },
      undefined,
      getMarkdownTheme(),
    );
    assert.equal(
      stripEsc(bgTask.render(100).join("\n")),
      "  ◇ [background-task] [MR577] opened |head=8b3d276a2",
    );
  });

  it("stacks prose -> ◇ subagent -> ◆ tool -> ◇ reply -> ◇ intercom -> ◆ tool -> prose with exact Grok spacing", () => {
    const tui = { children: [], requestRender() {} };
    const chat = new Container();
    const mdTheme = getMarkdownTheme();
    const reqRenderer = makeSubagentBlockRenderer("worker needs a decision", "两项是否批准？");
    const replyRenderer = makeSubagentBlockRenderer("reply sent to worker", "已放行");

    const assistantBefore = new AssistantMessageComponent(
      {
        role: "assistant",
        timestamp: 1,
        content: [{ type: "text", text: "另外，死信脚本重排时会给错误记录加一个标记。" }],
      },
      false,
      mdTheme,
      "◆ Thought",
      1,
      [],
    );
    chat.addChild(assistantBefore);

    const reqComp = new CustomMessageComponent(supervisorRequest(), reqRenderer, mdTheme);
    chat.addChild(reqComp);

    const supTool = new ToolExecutionComponent(
      "subagent_supervisor",
      "tc-1",
      { action: "reply" },
      { showImages: false, outputPad: 1 },
      undefined,
      tui,
      "/tmp",
    );
    supTool.updateResult({ role: "toolResult", toolCallId: "tc-1", content: [{ type: "text", text: "ok" }] }, false);
    chat.addChild(supTool);

    const replyComp = addCustomEntryViaPi(supervisorReplyEntry(), replyRenderer, false);
    chat.addChild(replyComp);

    const intercomComp = new CustomMessageComponent(intercomMessage(), makeIntercomRenderer(), mdTheme);
    chat.addChild(intercomComp);

    const subTool = new ToolExecutionComponent(
      "subagent",
      "tc-2",
      { action: "steer" },
      { showImages: false, outputPad: 1 },
      undefined,
      tui,
      "/tmp",
    );
    subTool.updateResult({ role: "toolResult", toolCallId: "tc-2", content: [{ type: "text", text: "ok" }] }, false);
    chat.addChild(subTool);

    const assistantAfter = new AssistantMessageComponent(
      {
        role: "assistant",
        timestamp: 2,
        content: [{ type: "text", text: "GPU 会话补的两点细节已转给 worker：" }],
      },
      false,
      mdTheme,
      "◆ Thought",
      1,
      [],
    );
    chat.addChild(assistantAfter);

    // Trim right-padding spaces added by Markdown; drop leading initial-message spacer
    const plainLines = chat.render(120).map((l) => stripEsc(l).trimEnd()).slice(1);
    assert.deepEqual(plainLines, [
      "  另外，死信脚本重排时会给错误记录加一个标记。",
      "",
      "  ◇ [subagent] worker needs a decision",
      "  ◆ Subagent Supervisor",
      "  ◇ [subagent] reply sent to worker",
      "  ◇ [intercom] From subagent-chat-01a07d4d-0da4-717e: 方案都对，补两个细节，实现时顺手处理：1. 只缓存 {sha, size}",
      "  ◆ Subagent",
      "",
      "  GPU 会话补的两点细节已转给 worker：",
    ]);
  });

  it("self-heals pre-existing CustomMessageComponent and CustomEntryComponent after /reload", async () => {
    // Tear down custom-message patch to simulate /reload's beforeSessionStart rebuild
    customCleanup();
    customCleanup = undefined;

    const reqRenderer = makeSubagentBlockRenderer("worker needs a decision", "两项是否批准？");
    const replyRenderer = makeSubagentBlockRenderer("reply sent to worker", "已放行");

    const preReloadMsg = new CustomMessageComponent(supervisorRequest(), reqRenderer, getMarkdownTheme());
    const preReloadEntry = addCustomEntryViaPi(supervisorReplyEntry(), replyRenderer, false);

    // Before reinstall: both paint native purple customMessageBg blocks
    assert.match(preReloadMsg.render(100).join("\n"), BG_ESC_RE);
    assert.match(preReloadEntry.render(100).join("\n"), BG_ESC_RE);

    // Reinstall patch (as session_start does after /reload)
    customCleanup = await installCustomMessageCollapsePatch();

    // First paint after reload must self-heal without needing manual rebuild()
    const msgAfter = preReloadMsg.render(100);
    const entryAfter = preReloadEntry.render(100);

    assert.equal(msgAfter.length, 1);
    assert.doesNotMatch(msgAfter[0], BG_ESC_RE);
    assert.equal(stripEsc(msgAfter[0]), "  ◇ [subagent] worker needs a decision");

    assert.equal(entryAfter.length, 1);
    assert.doesNotMatch(entryAfter[0], BG_ESC_RE);
    assert.equal(stripEsc(entryAfter[0]), "  ◇ [subagent] reply sent to worker");
  });
  it("cycles CustomMessageComponent and CustomEntryComponent across chrome -> truncated -> full -> chrome even after per-row clicks", () => {
    const reqRenderer = makeSubagentBlockRenderer("worker needs a decision", "两项是否批准？");
    const replyRenderer = makeSubagentBlockRenderer("reply sent to worker", "已放行");
    const msg = new CustomMessageComponent(supervisorRequest(), reqRenderer, getMarkdownTheme());
    const entry = addCustomEntryViaPi(supervisorReplyEntry(), replyRenderer, false);

    // Click msg to expand locally while global is chrome
    msg.render(100);
    dispatchGrokFoldUrl(foldUrl(idForTarget(msg)));
    assert.ok(msg.render(100).length > 1);

    // Global cycle to truncated / full clears overrides and expands both without purple bg
    resetClickFoldSession();
    getState().toolViewMode = "truncated";
    msg.setExpanded(true);
    entry.setExpanded(true);
    assert.match(stripEsc(msg.render(100).join("\n")), /两项是否批准/);
    assert.match(stripEsc(entry.render(100).join("\n")), /已放行/);
    assert.doesNotMatch(msg.render(100).join("\n"), BG_ESC_RE);
    assert.doesNotMatch(entry.render(100).join("\n"), BG_ESC_RE);

    // Global cycle back to chrome collapses both to 1-line ◇ rows
    getState().toolViewMode = "chrome";
    msg.setExpanded(false);
    entry.setExpanded(false);
    assert.equal(stripEsc(msg.render(100).join("\n")), "  ◇ [subagent] worker needs a decision");
    assert.equal(stripEsc(entry.render(100).join("\n")), "  ◇ [subagent] reply sent to worker");
  });

  it("relayouts following CustomEntryComponent lead gap when a preceding tool toggles body via click", () => {
    const tui = { requestRender() {} };
    const chat = new Container();

    const supTool = new ToolExecutionComponent(
      "subagent_supervisor",
      "tc-gap-1",
      { action: "reply" },
      { showImages: false, outputPad: 1 },
      undefined,
      tui,
      "/tmp",
    );
    supTool.updateResult(
      { role: "toolResult", toolCallId: "tc-gap-1", content: [{ type: "text", text: "Replied ok" }] },
      false,
    );
    chat.addChild(supTool);

    const replyRenderer = makeSubagentBlockRenderer("reply sent to worker", "已放行");
    const replyComp = addCustomEntryViaPi(supervisorReplyEntry(), replyRenderer, false);
    chat.addChild(replyComp);

    // Collapsed chrome: tight stack, no blank line between ◆ Subagent Supervisor and ◇ [subagent] reply
    assert.deepEqual(
      chat.render(100).map((l) => stripEsc(l).trimEnd()),
      ["  ◆ Subagent Supervisor", "  ◇ [subagent] reply sent to worker"],
    );

    // Click ◆ Subagent Supervisor -> expands tool body AND inserts 1 blank line before ◇ [subagent] reply
    const toolFoldId = idForTarget(supTool);
    assert.equal(dispatchGrokFoldUrl(foldUrl(toolFoldId)), true);
    const expandedChat = chat.render(100).map((l) => stripEsc(l).trimEnd());
    const replyIdx = expandedChat.indexOf("  ◇ [subagent] reply sent to worker");
    assert.ok(replyIdx >= 2, `expected expanded tool lines before reply, got ${JSON.stringify(expandedChat)}`);
    assert.equal(expandedChat[replyIdx - 1], "", "must insert 1 blank line between expanded tool body and ◇ row");

    // Click expanded tool body -> folds back to 1-line chrome and removes blank line
    assert.equal(dispatchGrokFoldUrl(foldUrl(toolFoldId)), true);
    assert.deepEqual(
      chat.render(100).map((l) => stripEsc(l).trimEnd()),
      ["  ◆ Subagent Supervisor", "  ◇ [subagent] reply sent to worker"],
    );
  });

  it("keeps click-expanded Thought, Tool, CustomMessage, and CustomEntry rows open when setToolsExpanded(false) and new bottom items arrive", () => {
    const tui = { requestRender() {} };
    const chat = new Container();
    const replyRenderer = makeSubagentBlockRenderer("reply sent to worker", "已放行 worker 修改 config.default.ts");
    const reqRenderer = makeSubagentBlockRenderer("worker needs a decision", "两项是否批准？");

    const im = {
      outputPad: 1,
      toolOutputExpanded: false,
      chatContainer: chat,
      loadedResourcesContainer: new Container(),
      ui: tui,
      showStatus() {},
      session: {
        extensionRunner: {
          getEntryRenderer: () => replyRenderer,
        },
      },
    };

    const thoughtTs = 1794740001000;
    const assistant1 = new AssistantMessageComponent(
      undefined,
      false,
      getMarkdownTheme(),
      "Thinking...",
      1,
    );
    chat.addChild(assistant1);
    assistant1.updateContent(
      {
        role: "assistant",
        timestamp: thoughtTs,
        stopReason: "toolUse",
        content: [
          { type: "thinking", thinking: "Deep reasoning step alpha" },
          { type: "toolCall", id: "tc-sup-1", name: "subagent_supervisor", arguments: { action: "reply" } },
        ],
      },
      false,
    );

    const supTool = new ToolExecutionComponent(
      "subagent_supervisor",
      "tc-sup-1",
      { action: "reply" },
      { showImages: false, outputPad: 1 },
      undefined,
      tui,
      "/tmp",
    );
    supTool.updateResult(
      { role: "toolResult", toolCallId: "tc-sup-1", content: [{ type: "text", text: "Supervisor reply delivered" }] },
      false,
    );
    chat.addChild(supTool);

    const reqMsg = new CustomMessageComponent(supervisorRequest(), reqRenderer, getMarkdownTheme());
    reqMsg.setExpanded(false);
    chat.addChild(reqMsg);

    const replyEntry = addCustomEntryViaPi(supervisorReplyEntry(), replyRenderer, false);
    chat.addChild(replyEntry);

    // Initial render registers fold handlers in compact chrome mode
    const initialJoined = stripEsc(chat.render(100).join("\n"));
    assert.doesNotMatch(initialJoined, /Deep reasoning step alpha/);
    assert.doesNotMatch(initialJoined, /Supervisor reply delivered/);
    assert.doesNotMatch(initialJoined, /两项是否批准/);
    assert.doesNotMatch(initialJoined, /已放行/);

    // Click-expand all four row types
    assert.equal(dispatchGrokFoldUrl(foldUrl(thinkingFoldId(thoughtTs))), true);
    assert.equal(dispatchGrokFoldUrl(foldUrl(idForTarget(supTool))), true);
    assert.equal(dispatchGrokFoldUrl(foldUrl(idForTarget(reqMsg))), true);
    assert.equal(dispatchGrokFoldUrl(foldUrl(idForTarget(replyEntry))), true);

    const expandedBefore = stripEsc(chat.render(100).join("\n"));
    assert.match(expandedBefore, /Deep reasoning step alpha/);
    assert.match(expandedBefore, /Supervisor reply delivered/);
    assert.match(expandedBefore, /两项是否批准/);
    assert.match(expandedBefore, /已放行/);

    // Track whether assistant1 is unnecessarily relayouted on setToolsExpanded(false)
    let assistant1Relayouts = 0;
    const origUpdate = assistant1.updateContent;
    assistant1.updateContent = function (...args) {
      assistant1Relayouts += 1;
      return origUpdate.apply(this, args);
    };

    // Simulate pi-subagents calling ctx.ui.setToolsExpanded(false) on subagent execution
    // plus streaming new assistant + custom entry + subagent tool + custom message at the bottom
    InteractiveMode.prototype.setToolsExpanded.call(im, false);
    assert.equal(assistant1Relayouts, 0, "redundant setToolsExpanded(false) must not relayout existing chat");

    const streamingAssistant = new AssistantMessageComponent(
      undefined,
      false,
      getMarkdownTheme(),
      "Thinking...",
      1,
    );
    im.streamingComponent = streamingAssistant;
    chat.addChild(streamingAssistant);
    streamingAssistant.updateContent(
      {
        role: "assistant",
        timestamp: thoughtTs + 5000,
        content: [{ type: "text", text: "New bottom streaming reply" }],
      },
      true,
    );

    // Spliced custom entry while streamingComponent is active (InteractiveMode.addCustomEntryToChat path)
    InteractiveMode.prototype.addCustomEntryToChat.call(im, {
      ...supervisorReplyEntry(),
      id: "entry-2",
    });

    const bottomSubagentTool = new ToolExecutionComponent(
      "subagent",
      "tc-sub-2",
      { action: "status", id: "819d4332" },
      { showImages: false, outputPad: 1 },
      undefined,
      tui,
      "/tmp",
    );
    bottomSubagentTool.setExpanded(im.toolOutputExpanded);
    chat.addChild(bottomSubagentTool);
    InteractiveMode.prototype.setToolsExpanded.call(im, false);
    bottomSubagentTool.updateResult(
      { role: "toolResult", toolCallId: "tc-sub-2", content: [{ type: "text", text: "Subagent status body hidden" }] },
      false,
    );

    const bottomCustomMsg = new CustomMessageComponent(
      { ...supervisorRequest(), content: "Bottom notice" },
      makeSubagentBlockRenderer("worker finished", "Bottom notice detail"),
      getMarkdownTheme(),
    );
    bottomCustomMsg.setExpanded(im.toolOutputExpanded);
    chat.addChild(bottomCustomMsg);

    const afterBottomActivity = stripEsc(chat.render(100).join("\n"));
    // All four user-expanded rows MUST still be expanded
    assert.match(afterBottomActivity, /Deep reasoning step alpha/);
    assert.match(afterBottomActivity, /Supervisor reply delivered/);
    assert.match(afterBottomActivity, /两项是否批准/);
    assert.match(afterBottomActivity, /已放行/);
    // Newly appended bottom rows stay collapsed in compact chrome mode
    assert.doesNotMatch(afterBottomActivity, /Subagent status body hidden/);
    assert.doesNotMatch(afterBottomActivity, /Bottom notice detail/);
    assert.match(afterBottomActivity, /New bottom streaming reply/);
    assert.equal(assistant1Relayouts, 0);
  });

  it("preserves preview mode on setToolsExpanded(false) and still transitions full <-> chrome when global state changes", () => {
    const tui = { requestRender() {} };
    const chat = new Container();
    const reqMsg = new CustomMessageComponent(
      supervisorRequest(),
      makeSubagentBlockRenderer("worker needs a decision", "两项是否批准？"),
      getMarkdownTheme(),
    );
    reqMsg.setExpanded(false);
    chat.addChild(reqMsg);

    const im = {
      toolOutputExpanded: false,
      chatContainer: chat,
      loadedResourcesContainer: new Container(),
      ui: tui,
      showStatus() {},
    };

    // Ctrl+O once: chrome -> truncated (preview), where toolOutputExpanded is still false
    InteractiveMode.prototype.toggleToolOutputExpansion.call(im);
    assert.equal(getState().toolViewMode, "truncated");
    assert.equal(im.toolOutputExpanded, false);
    assert.match(stripEsc(chat.render(100).join("\n")), /两项是否批准/);

    // pi-subagents calling setToolsExpanded(false) must NOT yank out of truncated mode
    InteractiveMode.prototype.setToolsExpanded.call(im, false);
    assert.equal(getState().toolViewMode, "truncated");
    assert.match(stripEsc(chat.render(100).join("\n")), /两项是否批准/);

    // Explicit setToolsExpanded(true) -> full, then setToolsExpanded(false) -> chrome
    InteractiveMode.prototype.setToolsExpanded.call(im, true);
    assert.equal(getState().toolViewMode, "full");
    assert.equal(im.toolOutputExpanded, true);

    InteractiveMode.prototype.setToolsExpanded.call(im, false);
    assert.equal(getState().toolViewMode, "chrome");
    assert.equal(im.toolOutputExpanded, false);
    assert.equal(stripEsc(chat.render(100).join("\n")), "  ◇ [subagent] worker needs a decision");
  });

  it("keeps a click-expanded standalone tool open if a consecutive collapsible tool joins its run", () => {
    const tui = { requestRender() {} };
    const chat = new Container();

    const tool1 = new ToolExecutionComponent(
      "bash",
      "tc-b1",
      { command: "echo first" },
      { showImages: false, outputPad: 1 },
      undefined,
      tui,
      "/tmp",
    );
    tool1.updateResult(
      { role: "toolResult", toolCallId: "tc-b1", content: [{ type: "text", text: "FIRST_OUTPUT_BODY" }] },
      false,
    );
    chat.addChild(tool1);
    chat.render(100);

    // User clicks standalone tool1 open before tool2 starts
    assert.equal(dispatchGrokFoldUrl(foldUrl(idForTarget(tool1))), true);
    assert.match(stripEsc(chat.render(100).join("\n")), /FIRST_OUTPUT_BODY/);

    // Consecutive collapsible tool2 arrives in the same run
    const tool2 = new ToolExecutionComponent(
      "bash",
      "tc-b2",
      { command: "echo second" },
      { showImages: false, outputPad: 1 },
      undefined,
      tui,
      "/tmp",
    );
    tool2.updateResult(
      { role: "toolResult", toolCallId: "tc-b2", content: [{ type: "text", text: "SECOND_OUTPUT_HIDDEN" }] },
      false,
    );
    chat.addChild(tool2);

    const afterJoin = stripEsc(chat.render(100).join("\n"));
    assert.match(afterJoin, /FIRST_OUTPUT_BODY/, "tool1 body must remain expanded when tool2 joins");
    assert.doesNotMatch(afterJoin, /SECOND_OUTPUT_HIDDEN/, "unclicked tool2 stays collapsed");

    // Clicking the group header folds the whole group cleanly to 1 line
    assert.equal(dispatchGrokFoldUrl(foldUrl(groupFoldId(tool1))), true);
    const afterFold = chat.render(100).map((l) => stripEsc(l).trimEnd()).filter(Boolean);
    assert.equal(afterFold.length, 1, `expected 1 collapsed group line, got ${JSON.stringify(afterFold)}`);
    assert.doesNotMatch(afterFold[0], /FIRST_OUTPUT_BODY/);
  });
});
