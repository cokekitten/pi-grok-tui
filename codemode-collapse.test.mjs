import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  isCodemodeTool,
  extractCodemodeCalls,
  parseLenientJsonRecord,
  shortenPathForDisplay,
  formatCodemodeCallTitle,
  formatCodemodeGroupSummary,
  extractCodePreviewStatement,
  extractCodemodeScriptError,
  isCodemodeAutoTree,
  resolveCodemodeDisplay,
  summarizeCodemodeChrome,
  formatCodemodeTreeLines,
} from "./extensions/codemode-style.ts";
import { nextToolFoldMode, groupRunRange, foldUrl } from "./extensions/click-fold-core.ts";
import {
  codemodeBodyFoldId,
  collapsibleRun,
  effectiveToolMode,
  toggleToolAt,
  toggleToolTitleAt,
} from "./extensions/tool-click.ts";
import { shouldGapAfter, installParentStamp } from "./extensions/parent-stamp.ts";
import { clearToolFoldOverrides, getState, resetClickFoldSession } from "./extensions/state.ts";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  InteractiveMode,
  createCodemodeExtension,
  getMarkdownTheme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { installToolCollapsePatch } from "./extensions/tool-collapse.ts";
import { installFoldBodyTextPatch, HOVER_BG, parseFoldMarker } from "./extensions/fold-body.ts";
import { dispatchGrokFoldUrl, resetFoldHandlers } from "./extensions/click-fold.ts";
import { installToolViewCyclePatch } from "./extensions/tool-view-cycle.ts";

initTheme("dark", false);

const plainTheme = {
  fg(_color, text) {
    return text;
  },
};

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
  assert.ok(captured, "expected createCodemodeExtension to register codemode tool");
  return captured;
}

const codemodeDef = getRealCodemodeDefinition();
const plainLines = (comp, width = 80) => comp.render(width).map(stripTerminalSequences);

describe("codemode-style: parseLenientJsonRecord", () => {
  it("parses complete JSON objects", () => {
    assert.deepEqual(parseLenientJsonRecord('{"path":"src/a.ts","limit":50}'), {
      path: "src/a.ts",
      limit: 50,
    });
  });

  it("extracts fields from 200-char truncated write/bash JSON previews", () => {
    const fullWrite = JSON.stringify({
      path: "/home/u/proj/extensions/codemode-style.ts",
      content: "export const x = " + "a".repeat(500),
    });
    const previewWrite = fullWrite.slice(0, 197) + "...";
    const parsedWrite = parseLenientJsonRecord(previewWrite);
    assert.equal(parsedWrite?.path, "/home/u/proj/extensions/codemode-style.ts");
    assert.equal(typeof parsedWrite?.content, "string");

    const fullBash = JSON.stringify({
      command: 'cd /home/u/proj && node -e "console.log(\"hi\")\n" && ' + "echo ok && ".repeat(30),
    });
    const previewBash = fullBash.slice(0, 197) + "...";
    const parsedBash = parseLenientJsonRecord(previewBash);
    assert.ok(parsedBash?.command.startsWith('cd /home/u/proj && node -e "console.log(\"hi\")'));
    assert.ok(parsedBash?.command.endsWith("…"));
  });

  it("skips nested objects/arrays before later string fields in truncated JSON", () => {
    const raw = '{"opts":{"nested":[1,2,{"k":"v"}]},"path":"src/target.ts","content":"unclosed...';
    const parsed = parseLenientJsonRecord(raw);
    assert.equal(parsed?.path, "src/target.ts");
  });

  it("returns undefined safely on bare model strings or empty input", () => {
    assert.equal(parseLenientJsonRecord("sc/deepseek-v4.1-flash"), undefined);
    assert.deepEqual(parseLenientJsonRecord(""), {});
  });
});

describe("codemode-style: path shortening & call titles", () => {
  it("shortens paths under cwd and HOME", () => {
    assert.equal(
      shortenPathForDisplay("/home/u/proj/src/index.ts", "/home/u/proj", "/home/u"),
      "src/index.ts",
    );
    assert.equal(
      shortenPathForDisplay("/home/u/proj", "/home/u/proj", "/home/u"),
      ".",
    );
    assert.equal(
      shortenPathForDisplay("/home/u/.agents/skills/pdf/SKILL.md", "/home/u/proj", "/home/u"),
      "~/.agents/skills/pdf/SKILL.md",
    );
    assert.equal(
      shortenPathForDisplay("/etc/hosts", "/home/u/proj", "/home/u"),
      "/etc/hosts",
    );
  });

  it("formats read/write/edit/bash/models/custom nested calls", () => {
    const opts = { cwd: "/home/u/proj", home: "/home/u" };
    assert.equal(
      formatCodemodeCallTitle(
        { name: "read", args: '{"path":"/home/u/proj/extensions/a.ts"}', status: "ok" },
        opts,
      ),
      "Read `extensions/a.ts`",
    );
    assert.equal(
      formatCodemodeCallTitle(
        {
          name: "write",
          args: ('{"path":"/home/u/proj/extensions/b.ts","content":"' + "x".repeat(250)).slice(0, 197) + "...",
          status: "ok",
        },
        opts,
      ),
      "Write `extensions/b.ts`",
    );
    assert.equal(
      formatCodemodeCallTitle(
        { name: "bash", args: '{"command":"cd /home/u/proj && npm test"}', status: "ok" },
        opts,
      ),
      "Execute `npm test`",
    );
    assert.equal(
      formatCodemodeCallTitle(
        { name: "models.classify", args: "sc/deepseek-v4.1-flash", status: "ok" },
        opts,
      ),
      "Classify `sc/deepseek-v4.1-flash`",
    );
    assert.equal(
      formatCodemodeCallTitle(
        { name: "models.generateImages", args: "sc/seedream-5", status: "ok" },
        opts,
      ),
      "Generate Image `sc/seedream-5`",
    );
    assert.equal(
      formatCodemodeCallTitle(
        { name: "memory_write", args: '{"target":"daily","content":"note"}', status: "ok" },
        opts,
      ),
      "Memory Write `daily`",
    );
    assert.equal(
      formatCodemodeCallTitle(
        { name: "scratchpad", args: '{"action":"list"}', status: "ok" },
        opts,
      ),
      "Scratchpad `list`",
    );
  });
});

describe("codemode-style: group summary, code preview & error extraction", () => {
  it("recognizes codemode tool name only", () => {
    assert.equal(isCodemodeTool("codemode"), true);
    assert.equal(isCodemodeTool("bash"), false);
  });

  it("aggregates verb buckets including write/edit/models and live progress for >=1 calls", () => {
    assert.equal(
      formatCodemodeGroupSummary([{ name: "bash", status: "running" }], { running: true }),
      "Ran 1 command (0/1)",
    );
    const calls = [
      { name: "read", status: "ok" },
      { name: "write", status: "ok" },
      { name: "edit", status: "ok" },
      { name: "bash", status: "running" },
      { name: "models.classify", status: "ok" },
      { name: "models.generateImages", status: "running" },
    ];
    assert.equal(
      formatCodemodeGroupSummary(calls, { running: true }),
      "Read 1 file, Wrote 1 file, Edited 1 file, Ran 1 command, Classified 1 item, Generated 1 image (4/6)",
    );
    assert.equal(
      formatCodemodeGroupSummary(calls, { running: false }),
      "Read 1 file, Wrote 1 file, Edited 1 file, Ran 1 command, Classified 1 item, Generated 1 image",
    );
  });

  it("extracts first non-comment statement from args.code", () => {
    const code = `// @options: {"timeout_ms": 60000}
/* helper comment */
// another comment
const [a, b] = await Promise.all([tools.read({ path: "foo" })]);
return a;`;
    assert.equal(
      extractCodePreviewStatement(code),
      'const [a, b] = await Promise.all([tools.read({ path: "f…',
    );
    assert.equal(extractCodePreviewStatement("// only comments\n   "), undefined);
    assert.equal(extractCodePreviewStatement(""), undefined);
  });

  it("extracts clean script error message without header/footer boilerplate", () => {
    const result = {
      isError: true,
      content: [
        { type: "text", text: "Script failed\nWall time 0.2 seconds\nOutput:\n" },
        {
          type: "text",
          text: "Script error:\nReferenceError: foo is not defined\n    at <anonymous>:3:1\n\nTool calls made before the failure (they are not undone): read (ok)",
        },
      ],
    };
    assert.equal(
      extractCodemodeScriptError(result),
      "ReferenceError: foo is not defined\n    at <anonymous>:3:1",
    );
  });
});

describe("codemode-style: live calls while running -> single-line collapsed when finished", () => {
  it("shows subcall list while running (capping compact preview at 8 calls) and collapses to 1 line when finished", () => {
    const tenCalls = Array.from({ length: 10 }, (_, i) => ({
      name: "read",
      args: JSON.stringify({ path: `f${i + 1}.ts` }),
      status: i === 9 ? "running" : "ok",
      durationMs: i === 9 ? undefined : 12,
    }));

    // While running: autoTree is true -> level === "calls" with autoCompact: true
    const runningSummary = summarizeCodemodeChrome(
      { code: "..." },
      { details: { calls: tenCalls } },
      { running: true },
    );
    assert.equal(runningSummary.kind, "group");
    assert.equal(runningSummary.label, "Read 10 files (9/10)");
    assert.equal(runningSummary.autoTree, true);
    assert.deepEqual(
      resolveCodemodeDisplay({
        globalMode: "chrome",
        override: undefined,
        autoTree: runningSummary.autoTree,
      }),
      { level: "calls", autoCompact: true },
    );

    const liveLines = formatCodemodeTreeLines(plainTheme, runningSummary.calls, {
      autoCompact: true,
      isError: false,
      running: true,
    }).map(stripTerminalSequences);
    assert.equal(liveLines.length, 9); // "+2 earlier" + 8 calls
    assert.match(liveLines[0], /\+2 earlier calls/);
    assert.match(liveLines[8], /└─ … Read `f10\.ts`/);

    // When finished (even with multi-call + error): autoTree is false -> level === "collapsed"
    const finishedCalls = tenCalls.map((c, i) =>
      i === 9 ? { ...c, status: "error", durationMs: 12, error: "ENOENT: no such file\nmore detail" } : c,
    );
    const finishedSummary = summarizeCodemodeChrome(
      { code: "..." },
      { isError: true, details: { calls: finishedCalls } },
      { running: false },
    );
    assert.equal(finishedSummary.kind, "group_err");
    assert.equal(finishedSummary.label, "Read 10 files");
    assert.equal(finishedSummary.failedSuffix, " · 1 failed");
    assert.equal(finishedSummary.autoTree, false);
    assert.deepEqual(
      resolveCodemodeDisplay({
        globalMode: "chrome",
        override: undefined,
        autoTree: finishedSummary.autoTree,
      }),
      { level: "collapsed", autoCompact: false },
    );

    // Explicit click into calls view (autoCompact: false) shows all 10 calls + multiline error
    const explicitLines = formatCodemodeTreeLines(plainTheme, finishedSummary.calls, {
      autoCompact: false,
      isError: true,
      running: false,
      scriptError: finishedSummary.scriptError,
    }).map(stripTerminalSequences);
    assert.ok(explicitLines.some((l) => l.includes("f1.ts")));
    assert.ok(explicitLines.some((l) => l.includes("more detail")));
  });

  it("uses group progress header while 1st call is running, then collapses to single-tool chrome on finish", () => {
    const running1 = summarizeCodemodeChrome(
      { code: "await tools.write(...)" },
      { details: { calls: [{ name: "write", args: '{"path":"src/new.ts","content":"1"}', status: "running" }] } },
      { running: true, cwd: "/proj" },
    );
    assert.equal(running1.kind, "group");
    assert.equal(running1.label, "Wrote 1 file (0/1)");
    assert.equal(running1.autoTree, true);

    const finished1 = summarizeCodemodeChrome(
      { code: "await tools.write(...)" },
      {
        isError: false,
        details: { calls: [{ name: "write", args: '{"path":"src/new.ts","content":"1"}', status: "ok", durationMs: 8 }] },
      },
      { running: false, cwd: "/proj" },
    );
    assert.equal(finished1.kind, "tool_ok");
    assert.equal(finished1.label, "Write `src/new.ts`");
    assert.equal(finished1.autoTree, false);
  });

  it("shows trailing script error row in calls view when nested call succeeded but JS threw", () => {
    const result = {
      isError: true,
      content: [
        { type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\n" },
        {
          type: "text",
          text: "Script error:\nTypeError: x is not a function\n\nTool calls made before the failure (they are not undone): read (ok)",
        },
      ],
      details: {
        calls: [{ name: "read", args: '{"path":"a.ts"}', status: "ok", durationMs: 5 }],
      },
    };
    const summary = summarizeCodemodeChrome({ code: "..." }, result, { running: false });
    assert.equal(summary.kind, "tool_err");
    assert.equal(summary.label, "Read `a.ts`");
    assert.equal(summary.failedSuffix, " · script failed");
    assert.equal(summary.autoTree, false);

    const lines = formatCodemodeTreeLines(plainTheme, summary.calls, {
      autoCompact: false,
      isError: true,
      running: false,
      scriptError: summary.scriptError,
    }).map(stripTerminalSequences);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^├─ ✓ Read `a\.ts` 5ms$/);
    assert.match(lines[1], /^└─ ✗ TypeError: x is not a function$/);
  });
});

describe("codemode 3-state fold cycle, non-grouping & spacing", () => {
  it("cycles codemode chrome -> truncated -> full -> chrome in nextToolFoldMode", () => {
    assert.equal(nextToolFoldMode("codemode", "chrome"), "truncated");
    assert.equal(nextToolFoldMode("codemode", "truncated"), "full");
    assert.equal(nextToolFoldMode("codemode", "full"), "chrome");
  });

  it("cycles finished single-call and multi-call codemode collapsed -> calls -> full -> collapsed", () => {
    resetClickFoldSession();
    getState().toolViewMode = "chrome";
    for (const calls of [
      [{ name: "read", args: '{"path":"a.ts"}', status: "ok" }],
      [
        { name: "read", args: '{"path":"a.ts"}', status: "ok" },
        { name: "bash", args: '{"command":"ls"}', status: "ok" },
      ],
    ]) {
      const finished = {
        toolName: "codemode",
        isPartial: false,
        result: { details: { calls } },
        updateDisplay() {},
      };
      assert.equal(effectiveToolMode(finished, "codemode"), "chrome");
      assert.equal(toggleToolAt(finished, "codemode"), "truncated");
      assert.equal(effectiveToolMode(finished, "codemode"), "truncated");
      assert.equal(toggleToolAt(finished, "codemode"), "full");
      assert.equal(effectiveToolMode(finished, "codemode"), "full");
      assert.equal(toggleToolAt(finished, "codemode"), "chrome");
      assert.equal(effectiveToolMode(finished, "codemode"), "chrome");
    }
  });

  it("skips empty calls state on finished 0-call non-error codemode, but keeps calls state on 0-call error", () => {
    resetClickFoldSession();
    getState().toolViewMode = "chrome";
    const zeroOk = {
      toolName: "codemode",
      isPartial: false,
      result: { isError: false, details: { calls: [] } },
      updateDisplay() {},
    };
    assert.equal(effectiveToolMode(zeroOk, "codemode"), "chrome");
    assert.equal(toggleToolAt(zeroOk, "codemode"), "full");
    assert.equal(toggleToolAt(zeroOk, "codemode"), "chrome");

    const zeroErr = {
      toolName: "codemode",
      isPartial: false,
      result: { isError: true, details: { calls: [] } },
      updateDisplay() {},
    };
    assert.equal(toggleToolAt(zeroErr, "codemode"), "truncated");
    assert.equal(toggleToolAt(zeroErr, "codemode"), "full");
    assert.equal(toggleToolAt(zeroErr, "codemode"), "chrome");
  });

  it("starts running codemode in calls ('truncated') and advances to full on 1st click", () => {
    resetClickFoldSession();
    getState().toolViewMode = "chrome";
    const running = {
      toolName: "codemode",
      isPartial: true,
      result: { details: { calls: [{ name: "bash", args: '{"command":"ls"}', status: "running" }] } },
      updateDisplay() {},
    };
    assert.equal(effectiveToolMode(running, "codemode"), "truncated");
    assert.equal(toggleToolAt(running, "codemode"), "full");
    clearToolFoldOverrides();
    assert.equal(effectiveToolMode(running, "codemode"), "truncated");
  });

  it("never merges codemode with consecutive tools in groupRunRange or collapsibleRun", () => {
    resetClickFoldSession();
    getState().toolViewMode = "chrome";
    const siblings = [
      { kind: "tool", toolName: "codemode" },
      { kind: "gap" },
      { kind: "tool", toolName: "codemode" },
      { kind: "tool", toolName: "read" },
      { kind: "tool", toolName: "read" },
    ];
    assert.equal(groupRunRange(siblings, 0, true), undefined);
    assert.equal(groupRunRange(siblings, 2, true), undefined);
    assert.deepEqual(groupRunRange(siblings, 3, true), { start: 3, end: 4 });

    const cm1 = { toolName: "codemode", updateDisplay() {} };
    const cm2 = { toolName: "codemode", updateDisplay() {} };
    assert.equal(collapsibleRun([cm1, cm2], 0).members.length, 1);
  });

  it("leaves trailing gap only when codemode is in full mode", () => {
    resetClickFoldSession();
    getState().toolViewMode = "chrome";
    const multi = {
      toolName: "codemode",
      isPartial: false,
      expanded: false,
      result: {
        details: {
          calls: [
            { name: "read", args: '{"path":"a.ts"}', status: "ok" },
            { name: "read", args: '{"path":"b.ts"}', status: "ok" },
          ],
        },
      },
      updateDisplay() {},
    };
    // Collapsed ("chrome") stays tight
    assert.equal(shouldGapAfter(multi), false);
    // Calls ("truncated") stays tight
    toggleToolAt(multi, "codemode");
    assert.equal(shouldGapAfter(multi), false);
    // Full adds breathing room
    toggleToolAt(multi, "codemode");
    assert.equal(shouldGapAfter(multi), true);
    // Back to collapsed ("chrome") stays tight
    toggleToolAt(multi, "codemode");
    assert.equal(shouldGapAfter(multi), false);
  });
});

describe("ToolExecutionComponent codemode integration", () => {
  it("shows subcall list while running, auto-collapses to 1 line on finish, and supports 3-state click, hover, syntax highlight, non-grouping & /reload", async () => {
    // 1. Construct a pre-patch codemode instance to verify /reload lazy restyle later
    const prePatch = new ToolExecutionComponent(
      "codemode",
      "cm-pre",
      { code: 'await tools.read({ path: "/proj/a.ts" });' },
      {},
      codemodeDef,
      { requestRender() {} },
      "/proj",
    );
    prePatch.updateResult(
      {
        content: [
          { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
          { type: "text", text: "hi" },
        ],
        details: { calls: [{ id: "1", name: "read", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 4 }] },
      },
      false,
    );
    assert.match(plainLines(prePatch).join("\n"), /codemode/);

    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installToolCollapsePatch(),
    ];
    try {
      resetFoldHandlers();
      resetClickFoldSession();
      Object.assign(getState(), {
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
        hoveredFoldId: undefined,
      });

      // Verify pre-patch instance lazily restyles on its first render() after /reload
      const healed = plainLines(prePatch);
      assert.deepEqual(healed.filter((l) => l.trim().length > 0).map((l) => l.trim()), [
        "◆ Read `a.ts`",
      ]);

      // 2. Single-call: live subcall list while running -> auto-collapses to 1-line chrome on finish!
      const longWriteArgs =
        JSON.stringify({
          path: "/proj/src/new.ts",
          content: 'const msg = "hello";\n' + "x".repeat(300),
        }).slice(0, 197) + "...";

      const singleWrite = new ToolExecutionComponent(
        "codemode",
        "cm-write",
        { code: 'const msg = "hello";\nawait tools.write({ path: "/proj/src/new.ts", content: msg });\ntext("wrote ok");' },
        {},
        codemodeDef,
        { requestRender() {} },
        "/proj",
      );

      // While running (1 call in progress): shows ◇ progress header + └─ subcall row
      singleWrite.updateResult(
        {
          content: [],
          details: { calls: [{ id: "w1", name: "write", args: longWriteArgs, status: "running" }] },
        },
        true,
      );
      assert.deepEqual(
        plainLines(singleWrite).filter((l) => l.trim().length > 0).map((l) => l.trim()),
        [
          "◇ Wrote 1 file (0/1)",
          "└─ … Write `src/new.ts`",
        ],
      );

      // Even if user clicked lower subcall zone to inspect full JS while running, standalone completion auto-collapses to 1 line!
      const runningRaw = singleWrite.render(80).filter((l) => stripTerminalSequences(l).trim().length > 0);
      const runningTitleId = parseFoldMarker(runningRaw[0]);
      const runningBodyId = parseFoldMarker(runningRaw[1]);
      assert.notEqual(runningBodyId, runningTitleId, "title and lower tree must use distinct fold IDs");
      assert.equal(dispatchGrokFoldUrl(foldUrl(runningBodyId)), true);
      assert.ok(plainLines(singleWrite).some((l) => l.includes('const msg = "hello";')));

      // Finish execution (standalone) -> automatically collapses to single-line ◆ Write `src/new.ts`!
      singleWrite.updateResult(
        {
          content: [
            { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
            { type: "text", text: "wrote ok" },
          ],
          details: {
            calls: [{ id: "w1", name: "write", args: longWriteArgs, status: "ok", durationMs: 9 }],
          },
        },
        false,
      );

      const s1 = plainLines(singleWrite).filter((l) => l.trim().length > 0);
      assert.equal(s1.length, 1);
      assert.equal(s1[0].trim(), "◆ Write `src/new.ts`");

      // Click 1 on collapsed title: expands to subcall list (with 2 independent click zones)
      const singleTitleLine = singleWrite.render(80).find((l) => stripTerminalSequences(l).trim().length > 0);
      const singleId = parseFoldMarker(singleTitleLine);
      assert.ok(singleId);
      assert.equal(dispatchGrokFoldUrl(foldUrl(singleId)), true);
      const s2Raw = singleWrite.render(80).filter((l) => stripTerminalSequences(l).trim().length > 0);
      const s2 = s2Raw.map((l) => stripTerminalSequences(l).trim());
      assert.equal(s2.length, 2);
      assert.equal(s2[0], "◆ Write `src/new.ts`");
      assert.equal(s2[1], "└─ ✓ Write `src/new.ts` 9ms");

      // Clicking the TITLE zone while in subcall list directly collapses back to 1 line!
      assert.equal(dispatchGrokFoldUrl(foldUrl(singleId)), true);
      assert.equal(plainLines(singleWrite).filter((l) => l.trim().length > 0).length, 1);

      // Re-open subcall list via title, then click LOWER zone to advance 3-state cycle to FULL!
      assert.equal(dispatchGrokFoldUrl(foldUrl(singleId)), true);
      const singleTreeFoldId = parseFoldMarker(
        singleWrite.render(80).find((l) => stripTerminalSequences(l).includes("└─ ✓ Write")),
      );
      assert.equal(singleTreeFoldId, codemodeBodyFoldId(singleWrite));
      assert.equal(dispatchGrokFoldUrl(foldUrl(singleTreeFoldId)), true);
      const rawFull = singleWrite.render(80);
      const plainFull = rawFull.map(stripTerminalSequences);
      assert.ok(plainFull.some((l) => l.includes('const msg = "hello";')));
      assert.ok(plainFull.some((l) => l.includes("wrote ok")));
      assert.ok(!plainFull.some((l) => l.trim() === "codemode"), "must drop duplicate codemode heading");
      assert.ok(!plainFull.some((l) => l.includes("Script completed")), "must strip Script completed header");
      const jsAnsiLine = rawFull.find((l) => stripTerminalSequences(l).includes("const msg"));
      assert.ok(jsAnsiLine && !jsAnsiLine.includes("38;2;74;74;74m"), "JS syntax highlight must not be dimmed to BODY_FG");

      // Lower body carries body fold ID; clicking it completes 3-state cycle back to 1-line chrome
      const bodyMarker = parseFoldMarker(jsAnsiLine);
      assert.equal(bodyMarker, codemodeBodyFoldId(singleWrite));
      assert.equal(dispatchGrokFoldUrl(foldUrl(bodyMarker)), true);
      assert.equal(plainLines(singleWrite).filter((l) => l.trim().length > 0).length, 1);

      // 3. Multi-call: live subcall list while running -> auto-collapses to 1-line ◇ summary on finish!
      const chat = new Container();
      const multi = new ToolExecutionComponent(
        "codemode",
        "cm-multi",
        { code: '// @options: {}\nconst [a, b] = await Promise.all([tools.read({ path: "/proj/x.ts" }), tools.bash({ command: "cd /proj && npm test" })]);\ntext("batch output");' },
        {},
        codemodeDef,
        { requestRender() {} },
        "/proj",
      );
      const secondCm = new ToolExecutionComponent(
        "codemode",
        "cm-second",
        { code: 'await tools.read({ path: "/proj/y.ts" });' },
        {},
        codemodeDef,
        { requestRender() {} },
        "/proj",
      );
      secondCm.updateResult(
        {
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: { calls: [{ id: "r2", name: "read", args: '{"path":"/proj/y.ts"}', status: "ok", durationMs: 3 }] },
        },
        false,
      );
      chat.addChild(multi);
      chat.addChild(secondCm);

      // Before nested calls start: 0-call streaming preview
      assert.ok(plainLines(multi).join("\n").includes("◆ Script `const [a, b] = await Promise.all"));

      // Nested calls running (1/2): shows live subcall list!
      multi.updateResult(
        {
          content: [],
          details: {
            calls: [
              { id: "c1", name: "read", args: '{"path":"/proj/x.ts"}', status: "ok", durationMs: 6 },
              { id: "c2", name: "bash", args: '{"command":"cd /proj && npm test"}', status: "running" },
            ],
          },
        },
        true,
      );
      const runningView = plainLines(multi).join("\n");
      assert.ok(runningView.includes("◇ Read 1 file, Ran 1 command (1/2)"), runningView);
      assert.match(runningView, /├─ ✓ Read `x\.ts` 6ms/);
      assert.match(runningView, /└─ … Execute `npm test`/);

      // Two independent hover/click zones: title row vs lower subcall tree rows
      const multiRunningRaw = multi.render(80).filter((l) => stripTerminalSequences(l).trim().length > 0);
      const headerFoldId = parseFoldMarker(multiRunningRaw[0]);
      const treeFoldId = parseFoldMarker(multiRunningRaw[1]);
      assert.ok(headerFoldId);
      assert.equal(treeFoldId, codemodeBodyFoldId(multi));
      assert.notEqual(treeFoldId, headerFoldId, "title and tree zones must have distinct fold IDs");

      getState().hoveredFoldId = headerFoldId;
      const hoveredTitleOnly = multi.render(80).filter((l) => stripTerminalSequences(l).trim().length > 0);
      assert.ok(hoveredTitleOnly[0].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      assert.ok(!hoveredTitleOnly[1].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));

      getState().hoveredFoldId = treeFoldId;
      const hoveredTreeOnly = multi.render(80).filter((l) => stripTerminalSequences(l).trim().length > 0);
      assert.ok(!hoveredTreeOnly[0].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      assert.ok(hoveredTreeOnly[1].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      assert.ok(hoveredTreeOnly[2].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      getState().hoveredFoldId = undefined;

      // Nested calls finish -> automatically collapses to single-line ◇ summary!
      multi.updateResult(
        {
          content: [
            { type: "text", text: "Script completed\nWall time 0.3 seconds\nOutput:\n" },
            { type: "text", text: "batch output" },
          ],
          details: {
            calls: [
              { id: "c1", name: "read", args: '{"path":"/proj/x.ts"}', status: "ok", durationMs: 6 },
              { id: "c2", name: "bash", args: '{"command":"cd /proj && npm test"}', status: "ok", durationMs: 210 },
            ],
          },
        },
        false,
      );

      // Sibling non-grouping & tight 1-line collapsed stacking in chat container
      const chatPlain = plainLines(chat);
      assert.ok(!chatPlain.some((l) => l.includes("Ran 2 tools")), "must never merge sibling codemode rows");
      assert.deepEqual(
        chatPlain.map((l) => l.trim()),
        [
          "◇ Read 1 file, Ran 1 command",
          "◆ Read `y.ts`",
        ],
      );

      // Narrow width safety
      for (const w of [8, 16, 28]) {
        const narrow = multi.render(w);
        assert.ok(narrow.every((l) => visibleWidth(l) <= w), `width <= ${w}`);
      }

      // Click 1 on finished multi-call -> expands subcall list (3 lines)
      assert.equal(dispatchGrokFoldUrl(foldUrl(headerFoldId)), true);
      assert.deepEqual(
        plainLines(multi).filter((l) => l.trim().length > 0).map((l) => l.trim()),
        [
          "◇ Read 1 file, Ran 1 command",
          "├─ ✓ Read `x.ts` 6ms",
          "└─ ✓ Execute `npm test` 210ms",
        ],
      );

      // Click 2 on subcall tree row -> opens FULL JS + output (with 1-line breathing gap before secondCm)
      const expandedTreeFoldId = parseFoldMarker(multi.render(80)[2]);
      assert.equal(dispatchGrokFoldUrl(foldUrl(expandedTreeFoldId)), true);
      const multiFullPlain = plainLines(multi).join("\n");
      assert.match(multiFullPlain, /batch output/);
      assert.ok(multiFullPlain.includes("Promise.all"));
      const chatFullPlain = plainLines(chat);
      const secondIdx = chatFullPlain.findIndex((l) => l.includes("◆ Read `y.ts`"));
      assert.equal(chatFullPlain[secondIdx - 1]?.trim(), "", "expected 1 blank line after full codemode");

      // In FULL mode, title and body ALSO have independent hover washes
      getState().hoveredFoldId = headerFoldId;
      const fullHoveredTitle = multi.render(80).filter((l) => stripTerminalSequences(l).trim().length > 0);
      assert.ok(fullHoveredTitle[0].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      assert.ok(!fullHoveredTitle[1].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));

      getState().hoveredFoldId = codemodeBodyFoldId(multi);
      const fullHoveredBody = multi.render(80).filter((l) => stripTerminalSequences(l).trim().length > 0);
      assert.ok(!fullHoveredBody[0].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      assert.ok(fullHoveredBody[1].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
      getState().hoveredFoldId = undefined;

      // Clicking TITLE directly from FULL mode collapses straight to 1-line chrome (and removes trailing gap)
      assert.equal(dispatchGrokFoldUrl(foldUrl(headerFoldId)), true);
      assert.deepEqual(
        plainLines(chat).map((l) => l.trim()),
        [
          "◇ Read 1 file, Ran 1 command",
          "◆ Read `y.ts`",
        ],
      );

      // 4. Inside a real chatContainer turn, finished codemode keeps its subcall list until prose arrives!
      const liveChat = new Container();
      liveChat.addChild(new UserMessageComponent("查一下文件", getMarkdownTheme(), 1, []));
      const callWrapper = new AssistantMessageComponent(
        {
          role: "assistant",
          timestamp: 9001,
          stopReason: "toolUse",
          content: [{ type: "toolCall", id: "live-cm", name: "codemode", arguments: { code: "..." } }],
        },
        false,
        getMarkdownTheme(),
        "Thinking...",
        1,
        [],
      );
      liveChat.addChild(callWrapper);
      const liveCm = new ToolExecutionComponent(
        "codemode",
        "live-cm",
        { code: 'await Promise.all([tools.read({ path: "/proj/a.ts" }), tools.read({ path: "/proj/b.ts" })]);' },
        {},
        codemodeDef,
        { requestRender() {} },
        "/proj",
      );
      liveChat.addChild(liveCm);
      liveCm.updateResult(
        {
          content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
          details: {
            calls: [
              { id: "1", name: "read", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 4 },
              { id: "2", name: "read", args: '{"path":"/proj/b.ts"}', status: "ok", durationMs: 5 },
            ],
          },
        },
        false,
      );

      // Turn still executing (no prose yet) -> subcall list remains visible!
      const duringTurn = plainLines(liveChat);
      assert.ok(duringTurn.some((l) => l.includes("├─ ✓ Read `a.ts` 4ms")));
      assert.ok(duringTurn.some((l) => l.includes("└─ ✓ Read `b.ts` 5ms")));

      // Assistant finishes answering -> lone codemode automatically collapses to 1 line!
      liveChat.addChild(
        new AssistantMessageComponent(
          {
            role: "assistant",
            timestamp: 9002,
            stopReason: "stop",
            content: [{ type: "text", text: "文件已检查完毕。" }],
          },
          false,
          getMarkdownTheme(),
          "Thinking...",
          1,
          [],
        ),
      );
      const afterAnswer = plainLines(liveChat);
      assert.ok(!afterAnswer.some((l) => l.includes("├─ ✓ Read `a.ts`")));
      assert.ok(afterAnswer.some((l) => l.trim() === "◇ Read 2 files"));
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });
});

describe("Codemode Ctrl+O cycle & scroll render cache", () => {
  it("cycles codemode through compact -> calls -> full -> compact via Ctrl+O and reuses cached tree lines", async () => {
    const cleanups = [
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installToolCollapsePatch(),
      await installToolViewCyclePatch(),
    ];
    try {
      resetFoldHandlers();
      resetClickFoldSession();
      Object.assign(getState(), {
        toolViewMode: "chrome",
        tuiMode: "fullscreen",
        clickFoldReady: true,
        hoveredFoldId: undefined,
      });

      const single = new ToolExecutionComponent(
        "codemode",
        "cm-ctrlo-1",
        { code: 'const v = await tools.read({ path: "/proj/a.ts" });\ntext("out1");' },
        {},
        codemodeDef,
        { requestRender() {} },
        "/proj",
      );
      single.updateResult(
        {
          content: [
            { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
            { type: "text", text: "out1" },
          ],
          details: { calls: [{ id: "1", name: "read", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 3 }] },
        },
        false,
      );

      const multi = new ToolExecutionComponent(
        "codemode",
        "cm-ctrlo-2",
        { code: 'await Promise.all([tools.read({ path: "/proj/a.ts" }), tools.read({ path: "/proj/b.ts" })]);\ntext("out2");' },
        {},
        codemodeDef,
        { requestRender() {} },
        "/proj",
      );
      multi.updateResult(
        {
          content: [
            { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
            { type: "text", text: "out2" },
          ],
          details: {
            calls: [
              { id: "1", name: "read", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 3 },
              { id: "2", name: "read", args: '{"path":"/proj/b.ts"}', status: "ok", durationMs: 4 },
            ],
          },
        },
        false,
      );

      // Both finished blocks start collapsed to 1 line in compact ("chrome") mode
      assert.equal(plainLines(single).filter((l) => l.trim()).length, 1);
      assert.equal(plainLines(multi).filter((l) => l.trim()).length, 1);

      // Local click override on single & multi before Ctrl+O; verify tree child render cache
      toggleToolAt(single, "codemode");
      toggleToolAt(multi, "codemode");
      const treeChild = multi.contentBox.children[1];
      const firstLines = treeChild.render(80);
      const secondLines = treeChild.render(80);
      assert.equal(secondLines, firstLines, "tree child must reuse cached array");
      getState().hoveredFoldId = "other-id";
      assert.equal(treeChild.render(80), firstLines);
      getState().hoveredFoldId = undefined;

      const chat = new Container();
      chat.addChild(single);
      chat.addChild(multi);
      const im = {
        toolOutputExpanded: false,
        chatContainer: chat,
        ui: { requestRender() {} },
        showStatus() {},
      };

      // Ctrl+O #1: chrome -> truncated (both single and multi show subcall tree, no JS/output)
      InteractiveMode.prototype.toggleToolOutputExpansion.call(im);
      assert.equal(getState().toolViewMode, "truncated");
      assert.equal(plainLines(single).filter((l) => l.trim()).length, 2);
      assert.ok(!plainLines(single).join("\n").includes("out1"));
      assert.equal(plainLines(multi).filter((l) => l.trim()).length, 3);

      // Ctrl+O #2: truncated -> full (both show JS + output)
      InteractiveMode.prototype.toggleToolOutputExpansion.call(im);
      assert.equal(getState().toolViewMode, "full");
      assert.ok(plainLines(single).join("\n").includes("out1"));
      assert.ok(plainLines(multi).join("\n").includes("out2"));

      // Ctrl+O #3: full -> chrome (both collapse back to 1 line!)
      InteractiveMode.prototype.toggleToolOutputExpansion.call(im);
      assert.equal(getState().toolViewMode, "chrome");
      assert.equal(plainLines(single).filter((l) => l.trim()).length, 1);
      assert.equal(plainLines(multi).filter((l) => l.trim()).length, 1);
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });
});
