import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCollapsibleTool,
  formatToolTitle,
  formatCollapsedToolLabel,
  formatVerbGroupLabel,
  stripRedundantSessionCd,
  flattenOneLine,
  verbKindForTool,
} from "./extensions/tool-titles.ts";

describe("isCollapsibleTool", () => {
  it("keeps edit and write expanded", () => {
    assert.equal(isCollapsibleTool("edit"), false);
    assert.equal(isCollapsibleTool("write"), false);
  });

  it("collapses other tools", () => {
    for (const n of ["read", "bash", "grep", "find", "ls", "mcp__x__y", "unknown"]) {
      assert.equal(isCollapsibleTool(n), true, n);
    }
  });
});

describe("flattenOneLine", () => {
  it("collapses newlines and spaces", () => {
    assert.equal(flattenOneLine("a\n\nb  c"), "a b c");
  });
});

describe("stripRedundantSessionCd", () => {
  it("peels matching absolute cd &&", () => {
    assert.equal(
      stripRedundantSessionCd("cd /proj && cargo test", "/proj"),
      "cargo test",
    );
  });

  it("peels matching cd ;", () => {
    assert.equal(stripRedundantSessionCd("cd /proj; ls", "/proj"), "ls");
  });

  it("does not peel mismatch or relative", () => {
    assert.equal(stripRedundantSessionCd("cd /other && ls", "/proj"), "cd /other && ls");
    assert.equal(stripRedundantSessionCd("cd proj && ls", "/proj"), "cd proj && ls");
  });
});

describe("formatToolTitle", () => {
  it("formats read/edit/write", () => {
    assert.equal(formatToolTitle("read", { path: "src/a.ts" }), "Read `src/a.ts`");
    assert.equal(formatToolTitle("edit", { path: "src/a.ts" }), "Edit `src/a.ts`");
    assert.equal(formatToolTitle("write", { path: "src/a.ts" }), "Write `src/a.ts`");
  });

  it("flattens multiline bash to one line", () => {
    const title = formatToolTitle("bash", {
      command: "python - <<'PY'\nimport json\nprint(1)\nPY",
    });
    assert.ok(title.startsWith("Execute `"));
    assert.equal(title.includes("\n"), false, title);
    assert.ok(title.includes("python"));
  });

  it("formats bash with peel and truncate", () => {
    assert.equal(
      formatToolTitle("bash", { command: "cd /proj && echo hi" }, { cwd: "/proj" }),
      "Execute `echo hi`",
    );
    const long = "x".repeat(200);
    const title = formatToolTitle("bash", { command: long });
    assert.ok(title.startsWith("Execute `"));
    assert.ok(title.includes("…"));
    assert.ok([...title].length < 100);
  });

  it("formats grep/find/ls", () => {
    assert.equal(formatToolTitle("grep", { pattern: "foo" }), "foo");
    assert.equal(formatToolTitle("find", { pattern: "**/*.ts" }), "Find `**/*.ts`");
    assert.equal(formatToolTitle("ls", {}), "List `.`");
    assert.equal(formatToolTitle("ls", { path: "src" }), "List `src`");
  });

  it("formats unknown / mcp with preview", () => {
    assert.equal(formatToolTitle("web_search", { query: "pi" }), "Web Search `pi`");
    assert.equal(
      formatToolTitle("mcp__github__list_issues", { path: "x" }),
      "Github · List Issues `x`",
    );
  });

  it("keeps the MCP server in the title", () => {
    assert.equal(formatToolTitle("mcp__browse__execute", {}), "Browse · Execute");
    assert.equal(formatToolTitle("mcp__browse__click", {}), "Browse · Click");
    assert.equal(formatToolTitle("mcp__browse", {}), "Browse");
    assert.equal(formatToolTitle("mcp__browse__webmcp", {}), "Browse · Webmcp");
  });

  it("previews MCP code / element arguments instead of a bare verb", () => {
    assert.equal(
      formatToolTitle("mcp__browse__execute", {
        code: "await page.click('.x')",
        timeoutMs: 5000,
        tab: "1079474953",
      }),
      "Browse · Execute `await page.click('.x')`",
    );
    assert.equal(
      formatToolTitle("mcp__browse__fill", { ref: "e12", text: "hello" }),
      "Browse · Fill `e12`",
    );
    assert.equal(
      formatToolTitle("mcp__browse__click", { selector: ".submit" }),
      "Browse · Click `.submit`",
    );
  it("previews extension tool arguments (subagent / supervisor / memory / background / ask_user)", () => {
    assert.equal(
      formatToolTitle("subagent", { agent: "researcher", task: "查一下 sunrise MR 的审核意见" }),
      "Subagent `researcher`",
    );
    assert.equal(
      formatToolTitle("subagent_supervisor", { action: "reply", replyTo: "r1" }),
      "Subagent Supervisor `reply`",
    );
    assert.equal(
      formatToolTitle("contact_supervisor", { reason: "need_decision", message: "blocking?" }),
      "Contact Supervisor `need_decision`",
    );
    assert.equal(
      formatToolTitle("memory_write", { target: "daily", content: "x" }),
      "Memory Write `daily`",
    );
    assert.equal(
      formatToolTitle("memory_forget", { match: "stale fact", target: "long_term" }),
      "Memory Forget `stale fact`",
    );
    assert.equal(
      formatToolTitle("get_background_output", { id: "bg-7", tail: 4000 }),
      "Get Background Output `bg-7`",
    );
    assert.equal(
      formatToolTitle("wait_tasks", { task_ids: ["bg-1", "bg-2", "bg-3"] }),
      "Wait Tasks `bg-1 +2`",
    );
    assert.equal(
      formatToolTitle("ask_user", { question: "要修吗？" }),
      "Ask User `要修吗？`",
    );
    // action wins over the free-text body on scratchpad-style tools
    assert.equal(
      formatToolTitle("scratchpad", { action: "done", text: "runner 待办" }),
      "Scratchpad `done`",
    );
  });

    // Multi-line code collapses to one line and truncates.
    const title = formatToolTitle("mcp__browse__execute", {
      code: "const tab = await pages.open();\nawait tab.goto('https://example.com/very/long/path')",
    });
    assert.equal(title.includes("\n"), false, title);
    assert.ok(title.startsWith("Browse · Execute `"));
  });
});

describe("formatCollapsedToolLabel", () => {
  it("does not prefix error mark (dots handle status)", () => {
    assert.equal(
      formatCollapsedToolLabel("read", { path: "a" }, { isError: true }),
      "Read `a`",
    );
  });
});

describe("verbKindForTool + formatVerbGroupLabel", () => {
  it("maps common tools", () => {
    assert.equal(verbKindForTool("read"), "file");
    assert.equal(verbKindForTool("bash"), "command");
    assert.equal(verbKindForTool("grep"), "search");
    assert.equal(verbKindForTool("ls"), "dir");
    assert.equal(verbKindForTool("todo"), "todo");
    assert.equal(verbKindForTool("TodoWrite"), "todo");
  });

  it("formats multi-tool group like Grok", () => {
    assert.equal(
      formatVerbGroupLabel([
        { toolName: "todo" },
        { toolName: "todo" },
        { toolName: "todo" },
      ]),
      "Updated 3 todos",
    );
    assert.equal(
      formatVerbGroupLabel([
        { toolName: "read" },
        { toolName: "read" },
      ]),
      "Read 2 files",
    );
    assert.equal(
      formatVerbGroupLabel([
        { toolName: "bash", isError: true },
      ]),
      "Ran 1 command · 1 failed",
    );
    assert.equal(
      formatVerbGroupLabel([
        { toolName: "read" },
        { toolName: "bash" },
        { toolName: "bash", isError: true },
      ]),
      "Read 1 file, Ran 2 commands · 1 failed",
    );
    assert.equal(
      formatVerbGroupLabel([
        { toolName: "Get Search Content" },
        { toolName: "Get Search Content" },
        { toolName: "Get Search Content" },
      ]),
      "Called 3 MCP tools",
    );
  });
});
