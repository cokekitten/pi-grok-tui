import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  ToolExecutionComponent,
  UserMessageComponent,
  createCodemodeExtension,
  getMarkdownTheme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  formatRollupDuration,
  scanChatWorkRollups,
  summarizeWorkRollup,
  installWorkRollupPatch,
  rollupFoldId,
} from "./extensions/work-rollup.ts";
import { installParentStamp } from "./extensions/parent-stamp.ts";
import { installThinkingPatch } from "./extensions/thinking-patch.ts";
import { installToolCollapsePatch } from "./extensions/tool-collapse.ts";
import { installCustomMessageCollapsePatch } from "./extensions/custom-message-collapse.ts";
import { installToolViewCyclePatch } from "./extensions/tool-view-cycle.ts";
import { installUserMessageStylePatch } from "./extensions/user-message-style.ts";
import { installFoldBodyTextPatch, parseFoldMarker } from "./extensions/fold-body.ts";
import {
  dispatchGrokFoldUrl,
  idForTarget,
  resetFoldHandlers,
  thinkingFoldId,
} from "./extensions/click-fold.ts";
import { foldUrl } from "./extensions/click-fold-core.ts";
import { applyGlobalThinkingToggle } from "./extensions/thinking-click.ts";
import {
  getState,
  recordThinkingEnd,
  resetClickFoldSession,
} from "./extensions/state.ts";
import { codemodeBodyFoldId } from "./extensions/tool-click.ts";

initTheme("dark", false);

function getRealCodemodeDefinition() {
  let captured;
  createCodemodeExtension()({
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry() {},
    registerTool(def) {
      captured = def;
    },
  });
  return captured;
}

const codemodeDef = getRealCodemodeDefinition();
const plainLines = (comp, width = 100) =>
  comp.render(width).map((l) => stripTerminalSequences(l).trimEnd());

function makeAssistant(content, opts = {}) {
  const comp = new AssistantMessageComponent(
    undefined,
    false,
    getMarkdownTheme(),
    "Thinking...",
    1,
    [],
  );
  comp.updateContent(
    {
      role: "assistant",
      timestamp: opts.timestamp ?? Date.now() + Math.random(),
      stopReason: opts.stopReason ?? "stop",
      content,
    },
    opts.isStreaming ?? false,
  );
  return comp;
}

function makeTool(name, id, args, result, opts = {}) {
  const comp = new ToolExecutionComponent(
    name,
    id,
    args,
    { showImages: false, outputPad: 1 },
    name === "codemode" ? codemodeDef : undefined,
    { requestRender() {} },
    opts.cwd ?? "/proj",
  );
  if (result !== undefined) {
    comp.updateResult(result, opts.isPartial ?? false);
  }
  return comp;
}

describe("work-rollup: pure scanner & summary aggregation", () => {
  it("does NOT roll up an in-progress turn when latest items have no prose yet", async () => {
    const cleanups = [
      installParentStamp(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
    ];
    try {
      const chat = new Container();
      chat.addChild(new UserMessageComponent("检查进度", getMarkdownTheme(), 1, []));
      chat.addChild(
        makeAssistant(
          [
            { type: "thinking", thinking: "Step 1" },
            { type: "toolCall", id: "t1", name: "codemode", arguments: { code: "..." } },
          ],
          { timestamp: 1001, stopReason: "toolUse" },
        ),
      );
      chat.addChild(
        makeTool(
          "codemode",
          "t1",
          { code: "..." },
          {
            content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
            details: {
              calls: [
                { id: "c1", name: "read", args: '{"path":"a.ts"}', status: "ok", durationMs: 4 },
                { id: "c2", name: "read", args: '{"path":"b.ts"}', status: "ok", durationMs: 5 },
              ],
            },
          },
        ),
      );
      // Streaming thinking on final step (no prose text yet!)
      chat.addChild(
        makeAssistant([{ type: "thinking", thinking: "Still thinking..." }], {
          timestamp: 1002,
          isStreaming: true,
        }),
      );

      const scan = scanChatWorkRollups(chat.children);
      assert.equal(scan.segments.length, 0);
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });

  it("does NOT double-wrap single-block pre-prose items (lone Thought, lone tool, lone verb group)", async () => {
    const cleanups = [
      installParentStamp(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
    ];
    try {
      // 1. Lone [Assistant(thinking + prose)] -> 1 visible block -> 0 rollups
      const c1 = new Container();
      c1.addChild(
        makeAssistant(
          [
            { type: "thinking", thinking: "Quick thought" },
            { type: "text", text: "Direct answer." },
          ],
          { timestamp: 2001 },
        ),
      );
      assert.equal(scanChatWorkRollups(c1.children).segments.length, 0);

      // 2. Lone [Assistant(toolCall only), Tool(codemode), Assistant(prose only)] -> 1 visible block -> 0 rollups
      const c2 = new Container();
      c2.addChild(
        makeAssistant(
          [{ type: "toolCall", id: "cm1", name: "codemode", arguments: { code: "..." } }],
          { timestamp: 2002, stopReason: "toolUse" },
        ),
      );
      c2.addChild(
        makeTool(
          "codemode",
          "cm1",
          { code: "..." },
          {
            content: [],
            details: { calls: [{ id: "1", name: "read", args: '{"path":"x.ts"}', status: "ok" }] },
          },
        ),
      );
      c2.addChild(makeAssistant([{ type: "text", text: "Done." }], { timestamp: 2003 }));
      assert.equal(scanChatWorkRollups(c2.children).segments.length, 0);

      // 3. Adjacent groupable tools [read, read] + prose (no thoughts) -> already 1 verb group -> 0 rollups
      const c3 = new Container();
      c3.addChild(makeTool("read", "r1", { path: "a.ts" }, { content: [{ type: "text", text: "1" }] }));
      c3.addChild(makeTool("read", "r2", { path: "b.ts" }, { content: [{ type: "text", text: "2" }] }));
      c3.addChild(makeAssistant([{ type: "text", text: "Read both." }], { timestamp: 2004 }));
      assert.equal(scanChatWorkRollups(c3.children).segments.length, 0);
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });

  it("aggregates Thoughts, codemode nested calls, direct tools, subagents, custom messages, and failures", async () => {
    const cleanups = [
      installParentStamp(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installCustomMessageCollapsePatch(),
    ];
    try {
      const chat = new Container();
      chat.addChild(
        makeAssistant([{ type: "thinking", thinking: "T1" }], {
          timestamp: 3001,
          stopReason: "toolUse",
        }),
      );
      chat.addChild(
        makeTool(
          "codemode",
          "cm-batch",
          { code: "..." },
          {
            isError: true,
            content: [],
            details: {
              calls: [
                { id: "1", name: "read", args: '{"path":"a.ts"}', status: "ok" },
                { id: "2", name: "write", args: '{"path":"b.ts"}', status: "ok" },
                { id: "3", name: "bash", args: '{"command":"npm test"}', status: "error", error: "exit 1" },
              ],
            },
          },
        ),
      );
      chat.addChild(
        makeTool(
          "subagent",
          "sub-1",
          { agent: "explorer", task: "inspect" },
          { content: [{ type: "text", text: "ok" }] },
        ),
      );
      const customMsg = new CustomMessageComponent(
        { role: "custom", customType: "intercom", content: "ping", display: true },
        undefined,
        getMarkdownTheme(),
      );
      chat.addChild(customMsg);
      const prose = makeAssistant(
        [
          { type: "thinking", thinking: "Final synthesis" },
          { type: "text", text: "All summarized." },
        ],
        { timestamp: 3002 },
      );
      chat.addChild(prose);

      const scan = scanChatWorkRollups(chat.children);
      assert.equal(scan.segments.length, 1);
      const seg = scan.segments[0];
      assert.equal(seg.absorbsProseLeadingThinking, true);

      const summary = summarizeWorkRollup(seg);
      assert.equal(summary.kind, "group_err");
      assert.equal(
        summary.label,
        "Thought · Read 1 file, Wrote 1 file, Ran 1 command, Ran 1 subagent, +1 more",
      );
      assert.equal(summary.failedSuffix, " · 1 failed");
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });
});

describe("work-rollup: full chatContainer render, click-to-expand, spacing & mouseLayout", () => {
  it("collapses multi-step work above prose to 1 line, expands to exact rows on click, and folds back", async () => {
    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installCustomMessageCollapsePatch(),
      await installToolViewCyclePatch(),
      await installUserMessageStylePatch(),
      await installWorkRollupPatch(),
    ];
    try {
      resetFoldHandlers();
      resetClickFoldSession();
      Object.assign(getState(), {
        globalExpanded: false,
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
        hoveredFoldId: undefined,
      });

      const chat = new Container();
      const user = new UserMessageComponent("执行期间是子调用清单，完成后自动收起", getMarkdownTheme(), 1, []);
      chat.addChild(user);

      const step1Think = makeAssistant(
        [
          { type: "thinking", thinking: "Inspecting files..." },
          { type: "toolCall", id: "cm1", name: "codemode", arguments: { code: "..." } },
        ],
        { timestamp: 4001, stopReason: "toolUse" },
      );
      chat.addChild(step1Think);

      const cm1 = makeTool(
        "codemode",
        "cm1",
        { code: "..." },
        {
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: {
            calls: [
              { id: "1", name: "read", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 3 },
              { id: "2", name: "read", args: '{"path":"/proj/b.ts"}', status: "ok", durationMs: 4 },
            ],
          },
        },
        { cwd: "/proj" },
      );
      chat.addChild(cm1);

      const step2Think = makeAssistant(
        [
          { type: "thinking", thinking: "Checking git status..." },
          { type: "toolCall", id: "cm2", name: "codemode", arguments: { code: "..." } },
        ],
        { timestamp: 4002, stopReason: "toolUse" },
      );
      chat.addChild(step2Think);

      const cm2 = makeTool(
        "codemode",
        "cm2",
        { code: "..." },
        {
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: {
            calls: [
              { id: "3", name: "write", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 5 },
              { id: "4", name: "bash", args: '{"command":"cd /proj && git status --short"}', status: "ok", durationMs: 12 },
            ],
          },
        },
        { cwd: "/proj" },
      );

      // Before prose arrives (while turn is still executing): codemode blocks KEEP their subcall lists!
      chat.addChild(cm2);
      const whileWorking = plainLines(chat);
      assert.ok(whileWorking.includes("  ◆ Thought"));
      assert.ok(whileWorking.includes("  ◇ Read 2 files"));
      assert.ok(whileWorking.some((l) => l.includes("├─ ✓ Read `a.ts` 3ms")));
      assert.ok(whileWorking.some((l) => l.includes("└─ ✓ Read `b.ts` 4ms")));
      assert.ok(whileWorking.includes("  ◇ Wrote 1 file, Ran 1 command"));
      assert.ok(whileWorking.some((l) => l.includes("├─ ✓ Write `a.ts` 5ms")));
      assert.ok(whileWorking.some((l) => l.includes("└─ ✓ Execute `git status --short` 12ms")));

      // Final assistant reply arrives with BOTH leading thinking AND prose!
      const finalReply = makeAssistant(
        [
          { type: "thinking", thinking: "Everything green, writing summary." },
          { type: "text", text: "已调整完毕，执行 /reload 即可生效。" },
        ],
        { timestamp: 4003 },
      );
      chat.addChild(finalReply);

      // 1. Collapsed state: entire 5-block work stack (including finalReply's leading Thought!) -> 1 line!
      const collapsedRaw = chat.render(100);
      const collapsedPlain = collapsedRaw.map((l) => stripTerminalSequences(l).trimEnd());
      // Drop 3-line user bubble at top
      assert.deepEqual(collapsedPlain.slice(3), [
        "",
        "  ◇ Thought · Read 2 files, Wrote 1 file, Ran 1 command",
        "",
        "  已调整完毕，执行 /reload 即可生效。",
      ]);

      // Verify mouseLayout heights sum to exact rendered line count
      const collapsedHeightSum = chat.mouseLayout.children.reduce((s, c) => s + c.height, 0);
      assert.equal(collapsedHeightSum, collapsedRaw.length);

      // Verify scroll render cache reuses exact rollup header string
      const collapsedRaw2 = chat.render(100);
      assert.equal(collapsedRaw2[4], collapsedRaw[4]);

      // 2. Click the rollup line -> expands to exact current rows + header on top!
      const rId = parseFoldMarker(collapsedRaw[4]);
      assert.equal(rId, rollupFoldId(finalReply));
      assert.equal(dispatchGrokFoldUrl(foldUrl(rId)), true);

      const expandedRaw = chat.render(100);
      const expandedPlain = expandedRaw.map((l) => stripTerminalSequences(l).trimEnd());
      assert.deepEqual(expandedPlain.slice(3), [
        "",
        "  ◇ Thought · Read 2 files, Wrote 1 file, Ran 1 command",
        "  ◆ Thought",
        "  ◇ Read 2 files",
        "  ◆ Thought",
        "  ◇ Wrote 1 file, Ran 1 command",
        "  ◆ Thought",
        "",
        "  已调整完毕，执行 /reload 即可生效。",
      ]);
      const expandedHeightSum = chat.mouseLayout.children.reduce((s, c) => s + c.height, 0);
      assert.equal(expandedHeightSum, expandedRaw.length);

      // 3. Clicking an inner item (cm1) expands cm1's subcall tree; lower zone cycles to full, title zone collapses directly!
      assert.equal(dispatchGrokFoldUrl(foldUrl(idForTarget(cm1))), true);
      const innerExpanded = plainLines(chat).slice(3);
      assert.ok(innerExpanded.some((l) => l.includes("├─ ✓ Read `a.ts`")));
      assert.ok(innerExpanded.some((l) => l.includes("└─ ✓ Read `b.ts`")));
      assert.equal(dispatchGrokFoldUrl(foldUrl(codemodeBodyFoldId(cm1))), true);
      assert.ok(plainLines(chat).some((l) => l.includes("...")) || plainLines(chat).length > 10);
      assert.equal(dispatchGrokFoldUrl(foldUrl(idForTarget(cm1))), true);
      assert.ok(!plainLines(chat).some((l) => l.includes("├─ ✓ Read `a.ts`")));

      // 4. Clicking an inner Thought (4003, inside finalReply!) expands that Thought in place!
      assert.equal(dispatchGrokFoldUrl(foldUrl(thinkingFoldId(4003))), true);
      assert.ok(plainLines(chat).join("\n").includes("Everything green, writing summary."));

      // 5. Clicking the top rollup header folds the entire stack back into 1 line!
      assert.equal(dispatchGrokFoldUrl(foldUrl(rId)), true);
      assert.deepEqual(plainLines(chat).slice(3), [
        "",
        "  ◇ Thought · Read 2 files, Wrote 1 file, Ran 1 command",
        "",
        "  已调整完毕，执行 /reload 即可生效。",
      ]);

      // 6. Alt+T (global thinking expand) dissolves rollup to reveal thoughts, then restores on second Alt+T
      applyGlobalThinkingToggle();
      assert.ok(plainLines(chat).join("\n").includes("Inspecting files..."));
      assert.ok(plainLines(chat).join("\n").includes("Everything green, writing summary."));
      applyGlobalThinkingToggle();
      assert.deepEqual(plainLines(chat).slice(3), [
        "",
        "  ◇ Thought · Read 2 files, Wrote 1 file, Ran 1 command",
        "",
        "  已调整完毕，执行 /reload 即可生效。",
      ]);

      // 7. Ctrl+O cycles compact -> truncated (dissolves rollup, shows subcall trees) -> full -> compact
      const im = {
        toolOutputExpanded: false,
        chatContainer: chat,
        ui: { requestRender() {} },
        showStatus() {},
      };
      InteractiveMode.prototype.toggleToolOutputExpansion.call(im);
      assert.ok(plainLines(chat).some((l) => l.includes("├─ ✓ Read `a.ts`")));
      InteractiveMode.prototype.toggleToolOutputExpansion.call(im);
      InteractiveMode.prototype.toggleToolOutputExpansion.call(im);
      assert.deepEqual(plainLines(chat).slice(3), [
        "",
        "  ◇ Thought · Read 2 files, Wrote 1 file, Ran 1 command",
        "",
        "  已调整完毕，执行 /reload 即可生效。",
      ]);
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });

  it("self-heals pre-existing chatContainer turns on first paint after /reload", async () => {
    // Build chat BEFORE patches are installed (simulating pre-/reload history)
    const chat = new Container();
    chat.addChild(new UserMessageComponent("Prompt before reload", getMarkdownTheme(), 1, []));
    const t1 = new AssistantMessageComponent(
      {
        role: "assistant",
        timestamp: 5001,
        stopReason: "toolUse",
        content: [
          { type: "thinking", thinking: "Old thought 1" },
          { type: "toolCall", id: "old-r1", name: "read", arguments: { path: "x.ts" } },
        ],
      },
      false,
      getMarkdownTheme(),
      "Thinking...",
      1,
      [],
    );
    chat.addChild(t1);
    const tool1 = makeTool("read", "old-r1", { path: "x.ts" }, { content: [{ type: "text", text: "ok" }] });
    chat.addChild(tool1);
    const finalMsg = new AssistantMessageComponent(
      {
        role: "assistant",
        timestamp: 5002,
        stopReason: "stop",
        content: [
          { type: "thinking", thinking: "Old thought 2" },
          { type: "text", text: "Historical answer." },
        ],
      },
      false,
      getMarkdownTheme(),
      "Thinking...",
      1,
      [],
    );
    chat.addChild(finalMsg);

    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installUserMessageStylePatch(),
      await installWorkRollupPatch(),
    ];
    try {
      resetClickFoldSession();
      Object.assign(getState(), {
        globalExpanded: false,
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
      });

      const afterReload = plainLines(chat);
      assert.deepEqual(afterReload.slice(3), [
        "",
        "  ◇ Thought · Read 1 file",
        "",
        "  Historical answer.",
      ]);
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });

  it("handles tool-first segments (transparent Assistant([toolCall])), mid-turn prose, and active user overrides", async () => {
    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installUserMessageStylePatch(),
      await installWorkRollupPatch(),
    ];
    try {
      resetFoldHandlers();
      resetClickFoldSession();
      Object.assign(getState(), {
        globalExpanded: false,
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
      });

      const chat = new Container();
      chat.addChild(new UserMessageComponent("Non-thinking multi-step", getMarkdownTheme(), 1, []));

      // Transparent assistant wrappers (no thinking, no text, only toolCall)
      chat.addChild(
        makeAssistant(
          [{ type: "toolCall", id: "nt-1", name: "codemode", arguments: { code: "..." } }],
          { timestamp: 6001, stopReason: "toolUse" },
        ),
      );
      const cmA = makeTool(
        "codemode",
        "nt-1",
        { code: "..." },
        {
          content: [],
          details: { calls: [{ id: "1", name: "read", args: '{"path":"/proj/x.ts"}', status: "ok" }] },
        },
      );
      chat.addChild(cmA);

      chat.addChild(
        makeAssistant(
          [{ type: "toolCall", id: "nt-2", name: "codemode", arguments: { code: "..." } }],
          { timestamp: 6002, stopReason: "toolUse" },
        ),
      );
      const cmB = makeTool(
        "codemode",
        "nt-2",
        { code: "..." },
        {
          content: [],
          details: { calls: [{ id: "2", name: "bash", args: '{"command":"ls"}', status: "ok" }] },
        },
      );
      chat.addChild(cmB);

      // Mid-turn prose + new running work below it
      const midProse = makeAssistant([{ type: "text", text: "中间汇报：已读完文件，继续执行。" }], {
        timestamp: 6003,
      });
      chat.addChild(midProse);

      const tailThink = makeAssistant([{ type: "thinking", thinking: "Tail step thinking" }], {
        timestamp: 6004,
        stopReason: "toolUse",
      });
      chat.addChild(tailThink);
      const tailTool = makeTool(
        "read",
        "nt-tail",
        { path: "tail.ts" },
        { content: [{ type: "text", text: "tail body" }] },
      );
      chat.addChild(tailTool);

      // Segment 1 above midProse collapses to 1 line; Segment 2 at tail (no prose below) stays live!
      const midRender = chat.render(100);
      const midPlain = midRender.map((l) => stripTerminalSequences(l).trimEnd());
      assert.deepEqual(midPlain.slice(3), [
        "",
        "  ◇ Read 1 file, Ran 1 command",
        "",
        "  中间汇报：已读完文件，继续执行。",
        "",
        "  ◆ Thought",
        "  ◆ Read `tail.ts`",
      ]);

      // Expand tool-first Segment 1 -> cmA must stack tightly (0 blank lines) under rollup header!
      const seg1Fold = parseFoldMarker(midRender[4]);
      assert.equal(dispatchGrokFoldUrl(foldUrl(seg1Fold)), true);
      assert.deepEqual(plainLines(chat).slice(3, 9), [
        "",
        "  ◇ Read 1 file, Ran 1 command",
        "  ◆ Read `x.ts`",
        "  ◆ Execute `ls`",
        "",
        "  中间汇报：已读完文件，继续执行。",
      ]);

      // User clicks tailThink open BEFORE final prose arrives -> auto-seeds open so text isn't yanked!
      assert.equal(dispatchGrokFoldUrl(foldUrl(thinkingFoldId(6004))), true);
      assert.ok(plainLines(chat).join("\n").includes("Tail step thinking"));

      const finalProse = makeAssistant([{ type: "text", text: "全部完成。" }], {
        timestamp: 6005,
      });
      chat.addChild(finalProse);

      const withFinal = plainLines(chat);
      assert.ok(withFinal.includes("    Tail step thinking") || withFinal.join("\n").includes("Tail step thinking"));

      // Clicking Segment 2's rollup header folds it cleanly
      const finalRaw = chat.render(100);
      const seg2HeaderLine = finalRaw.find((l) =>
        stripTerminalSequences(l).includes("◇ Thought · Read 1 file"),
      );
      assert.ok(seg2HeaderLine);
      assert.equal(dispatchGrokFoldUrl(foldUrl(parseFoldMarker(seg2HeaderLine))), true);
      assert.ok(!plainLines(chat).join("\n").includes("Tail step thinking"));
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });

  it("rolls up interrupted work between two user messages (and standalone error closers) with total duration", async () => {
    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installCustomMessageCollapsePatch(),
      await installUserMessageStylePatch(),
      await installWorkRollupPatch(),
    ];
    try {
      resetFoldHandlers();
      resetClickFoldSession();
      Object.assign(getState(), {
        globalExpanded: false,
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
        hoveredFoldId: undefined,
      });

      const chat = new Container();
      const user1 = new UserMessageComponent(
        "这个版本我展开某行内容后，最底下有新的内容出现的话...",
        getMarkdownTheme(),
        1,
        [],
        "u1",
        "2026-11-15T11:54:51.279Z",
      );
      chat.addChild(user1);

      const T0 = 1_794_743_691_296;
      const step1 = makeAssistant(
        [
          { type: "thinking", thinking: "Step 1 analysis" },
          { type: "toolCall", id: "int-cm1", name: "codemode", arguments: { code: "..." } },
        ],
        { timestamp: T0, stopReason: "toolUse" },
      );
      chat.addChild(step1);

      const cm1 = makeTool(
        "codemode",
        "int-cm1",
        { code: "..." },
        {
          isError: true,
          timestamp: T0 + 24_500,
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: {
            calls: [
              { id: "1", name: "read", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 28 },
              { id: "2", name: "read", args: '{"path":"/proj/b.ts"}', status: "ok", durationMs: 24 },
              { id: "3", name: "bash", args: '{"command":"npm test"}', status: "error", error: "exit 1", durationMs: 120 },
            ],
          },
        },
        { cwd: "/proj" },
      );
      chat.addChild(cm1);

      const step2 = makeAssistant(
        [
          { type: "thinking", thinking: "Step 2 follow-up" },
          { type: "toolCall", id: "int-cm2", name: "codemode", arguments: { code: "..." } },
        ],
        { timestamp: T0 + 25_000, stopReason: "toolUse" },
      );
      chat.addChild(step2);

      // Total active work duration: 604_246 ms = 10m 4s
      const cm2 = makeTool(
        "codemode",
        "int-cm2",
        { code: "..." },
        {
          timestamp: T0 + 604_246,
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: {
            calls: [
              { id: "4", name: "read", args: '{"path":"/proj/c.ts"}', status: "ok", durationMs: 19 },
            ],
          },
        },
        { cwd: "/proj" },
      );
      chat.addChild(cm2);

      // Before second user message arrives: still live, codemode keeps subcall tree!
      assert.ok(plainLines(chat).some((l) => l.includes("├─ ✓ Read `a.ts` 28ms")));

      // User sends a second message (InteractiveMode inserts Spacer(1) before UserMessageComponent)
      // Notice user2 arrives 2 hours later — idle time after cm2 MUST NOT inflate the rollup duration!
      chat.addChild(new Spacer(1));
      const user2 = new UserMessageComponent(
        "哦 subagent 在界面底部常驻的运行状态是没问题的",
        getMarkdownTheme(),
        1,
        [],
        "u2",
        new Date(T0 + 7_200_000).toISOString(),
      );
      chat.addChild(user2);

      const collapsedRaw = chat.render(100);
      const collapsedPlain = collapsedRaw.map((l) => stripTerminalSequences(l).trimEnd());
      // Lines: [0..2] user1 bubble, [3] blank, [4] rollup row, [5] Spacer(1) blank, [6..8] user2 bubble
      assert.equal(collapsedPlain[3], "");
      assert.equal(
        collapsedPlain[4],
        "  ◇ Thought · Read 3 files, Ran 1 command · 1 failed · 10m 4s",
      );
      assert.equal(collapsedPlain[5], "");
      assert.match(collapsedPlain[7], /哦 subagent/);

      const heightSumCollapsed = chat.mouseLayout.children.reduce((s, c) => s + c.height, 0);
      assert.equal(heightSumCollapsed, collapsedRaw.length);

      // Click rollup header -> expands between user1 and user2, with codemode in 1-line state!
      const rId = rollupFoldId(user2);
      assert.equal(parseFoldMarker(collapsedRaw[4]), rId);
      assert.equal(dispatchGrokFoldUrl(foldUrl(rId)), true);

      const expandedRaw = chat.render(100);
      const expandedPlain = expandedRaw.map((l) => stripTerminalSequences(l).trimEnd());
      assert.deepEqual(expandedPlain.slice(3, 10), [
        "",
        "  ◇ Thought · Read 3 files, Ran 1 command · 1 failed · 10m 4s",
        "  ◆ Thought",
        "  ◇ Read 2 files, Ran 1 command · 1 failed",
        "  ◆ Thought",
        "  ◆ Read `c.ts`",
        "",
      ]);
      assert.match(expandedPlain[11], /哦 subagent/);
      const heightSumExpanded = chat.mouseLayout.children.reduce((s, c) => s + c.height, 0);
      assert.equal(heightSumExpanded, expandedRaw.length);

      // Click rollup header again -> folds back to 1 line!
      assert.equal(dispatchGrokFoldUrl(foldUrl(rId)), true);
      assert.equal(plainLines(chat).length, 9);

      // Now add a second turn after user2 that ends with a standalone error AssistantMessage
      const T1 = T0 + 7_205_000;
      chat.addChild(
        makeAssistant(
          [
            { type: "thinking", thinking: "Trying reconnect" },
            { type: "toolCall", id: "err-r1", name: "read", arguments: { path: "z.ts" } },
          ],
          { timestamp: T1, stopReason: "toolUse" },
        ),
      );
      chat.addChild(
        makeTool("read", "err-r1", { path: "z.ts" }, {
          timestamp: T1 + 12_400,
          content: [{ type: "text", text: "z" }],
        }),
      );
      const errMsg = makeAssistant([], {
        timestamp: T1 + 12_420,
        stopReason: "error",
      });
      errMsg.lastMessage.errorMessage = "WebSocket error";
      errMsg.updateContent(errMsg.lastMessage, false);
      chat.addChild(errMsg);

      const withErrPlain = plainLines(chat);
      assert.ok(withErrPlain.includes("  ◇ Thought · Read 1 file · 12.4s"));
      assert.ok(withErrPlain.some((l) => l.includes("Error: WebSocket error")));
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });

  it("formats rollup durations cleanly and freezes live prose-closed rollup duration at thinking end", async () => {
    assert.equal(formatRollupDuration(undefined), undefined);
    assert.equal(formatRollupDuration(0), undefined);
    assert.equal(formatRollupDuration(420), "420ms");
    assert.equal(formatRollupDuration(5000), "5s");
    assert.equal(formatRollupDuration(12_400), "12.4s");
    assert.equal(formatRollupDuration(59_960), "1m");
    assert.equal(formatRollupDuration(134_000), "2m 14s");
    assert.equal(formatRollupDuration(3_720_000), "1h 2m");

    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installUserMessageStylePatch(),
      await installWorkRollupPatch(),
    ];
    try {
      resetFoldHandlers();
      resetClickFoldSession();
      Object.assign(getState(), {
        globalExpanded: false,
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
      });

      const chat = new Container();
      chat.addChild(new UserMessageComponent("Live timing test", getMarkdownTheme(), 1, []));

      const base = 1_795_000_000_000;
      chat.addChild(
        makeAssistant(
          [
            { type: "thinking", thinking: "Step 1" },
            { type: "toolCall", id: "lt-1", name: "read", arguments: { path: "a.ts" } },
          ],
          { timestamp: base, stopReason: "toolUse" },
        ),
      );
      chat.addChild(
        makeTool("read", "lt-1", { path: "a.ts" }, {
          timestamp: base + 3200,
          content: [{ type: "text", text: "a" }],
        }),
      );

      // Final assistant message starts at base + 3250, finishes thinking at base + 8600 (total 8.6s)
      const proseTs = base + 3250;
      recordThinkingEnd(proseTs, base + 8600);
      chat.addChild(
        makeAssistant(
          [
            { type: "thinking", thinking: "Final thought" },
            { type: "text", text: "完成。" },
          ],
          { timestamp: proseTs },
        ),
      );

      const lines = plainLines(chat);
      assert.ok(lines.includes("  ◇ Thought · Read 1 file · 8.6s"), lines.join("\n"));
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });

  it("keeps mid-turn codemode body expand open while executing, rolls up on answer, and resets codemode to 1-line when rollup expands", async () => {
    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installUserMessageStylePatch(),
      await installWorkRollupPatch(),
    ];
    try {
      resetFoldHandlers();
      resetClickFoldSession();
      Object.assign(getState(), {
        globalExpanded: false,
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
      });

      const chat = new Container();
      chat.addChild(new UserMessageComponent("执行多步 codemode", getMarkdownTheme(), 1, []));

      chat.addChild(
        makeAssistant(
          [
            { type: "thinking", thinking: "Step 1" },
            { type: "toolCall", id: "ov-cm1", name: "codemode", arguments: { code: 'const alpha = 42;' } },
          ],
          { timestamp: 8101, stopReason: "toolUse" },
        ),
      );
      const cm1 = makeTool(
        "codemode",
        "ov-cm1",
        { code: "const alpha = 42;\nawait tools.read({ path: '/proj/one.ts' });" },
        {
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: { calls: [{ id: "1", name: "read", args: '{"path":"/proj/one.ts"}', status: "ok", durationMs: 5 }] },
        },
      );
      chat.addChild(cm1);

      // User clicks cm1's lower zone during execution to inspect full JS
      assert.equal(dispatchGrokFoldUrl(foldUrl(codemodeBodyFoldId(cm1))), true);
      assert.ok(plainLines(chat).some((l) => l.includes("const alpha = 42;")));

      // Step 2 arrives while turn is still executing -> cm1 stays open in full JS!
      chat.addChild(
        makeAssistant(
          [
            { type: "thinking", thinking: "Step 2" },
            { type: "toolCall", id: "ov-cm2", name: "codemode", arguments: { code: "..." } },
          ],
          { timestamp: 8102, stopReason: "toolUse" },
        ),
      );
      const cm2 = makeTool(
        "codemode",
        "ov-cm2",
        { code: "await tools.read({ path: '/proj/two.ts' });" },
        {
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: { calls: [{ id: "2", name: "read", args: '{"path":"/proj/two.ts"}', status: "ok", durationMs: 6 }] },
        },
      );
      chat.addChild(cm2);
      assert.ok(plainLines(chat).some((l) => l.includes("const alpha = 42;")));
      assert.ok(plainLines(chat).some((l) => l.includes("└─ ✓ Read `two.ts` 6ms")));

      // Assistant finishes answering -> entire turn collapses into 1 rollup line!
      const prose = makeAssistant([{ type: "text", text: "回答完毕。" }], { timestamp: 8103 });
      chat.addChild(prose);
      assert.deepEqual(plainLines(chat).slice(3), [
        "",
        "  ◇ Thought · Read 2 files",
        "",
        "  回答完毕。",
      ]);

      // User expands the rollup -> both cm1 and cm2 are now in 1-line state!
      assert.equal(dispatchGrokFoldUrl(foldUrl(rollupFoldId(prose))), true);
      assert.deepEqual(plainLines(chat).slice(3), [
        "",
        "  ◇ Thought · Read 2 files",
        "  ◆ Thought",
        "  ◆ Read `one.ts`",
        "  ◆ Thought",
        "  ◆ Read `two.ts`",
        "",
        "  回答完毕。",
      ]);
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });
});
