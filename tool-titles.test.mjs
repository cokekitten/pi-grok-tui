import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCollapsibleTool,
  formatToolTitle,
  formatCollapsedToolLabel,
  stripRedundantSessionCd,
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

  it("formats bash with peel and truncate", () => {
    assert.equal(
      formatToolTitle("bash", { command: "cd /proj && echo hi" }, { cwd: "/proj" }),
      "Execute `echo hi`",
    );
    const long = "x".repeat(200);
    const title = formatToolTitle("bash", { command: long });
    assert.ok(title.startsWith("Execute `"));
    assert.ok(title.endsWith("…`") || title.includes("…"));
    assert.ok([...title].length < 120);
  });

  it("formats grep/find/ls", () => {
    assert.equal(formatToolTitle("grep", { pattern: "foo" }), "foo");
    assert.equal(formatToolTitle("find", { pattern: "**/*.ts" }), "Find `**/*.ts`");
    assert.equal(formatToolTitle("ls", {}), "List `.`");
    assert.equal(formatToolTitle("ls", { path: "src" }), "List `src`");
  });

  it("formats unknown / mcp with preview", () => {
    assert.equal(formatToolTitle("web_search", { query: "pi" }), "Web Search `pi`");
    assert.equal(formatToolTitle("mcp__github__list_issues", { path: "x" }), "List Issues `x`");
  });
});

describe("formatCollapsedToolLabel", () => {
  it("adds error mark", () => {
    assert.equal(
      formatCollapsedToolLabel("read", { path: "a" }, { isError: true }),
      "✗ Read `a`",
    );
  });
});
