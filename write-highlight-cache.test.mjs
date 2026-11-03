/**
 * Regression: stripBgDeep() must not wipe renderer-owned incremental caches.
 *
 * pi's write renderer keeps its syntax-highlight cache on
 * WriteCallRenderComponent.cache and only re-highlights appended lines when the
 * same object comes back. grok-tui repaints write calls on every streamed args
 * delta (restyleExpanded → stripBgDeep), so a blanket `cache = undefined` made
 * pi re-highlight the entire file each delta: highlight.js O(n²), worst frame
 * 2.8s for a 128KB write, i.e. a frozen TUI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ToolExecutionComponent,
  createWriteToolDefinition,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { stripBgDeep } from "./extensions/flat-style.ts";

initTheme("dark");

function writeComponent() {
  const toolDefinition = createWriteToolDefinition({});
  const ui = { requestRender() {} };
  return new ToolExecutionComponent(
    "write",
    "call-1",
    { file_path: "/tmp/streamed.ts", content: "" },
    {},
    toolDefinition,
    ui,
    "/tmp",
  );
}

const args = (content) => ({ file_path: "/tmp/streamed.ts", content });

describe("stripBgDeep vs write highlight cache", () => {
  it("keeps the incremental highlight cache across a streamed delta", () => {
    const component = writeComponent();

    component.updateArgs(args("const a = 1;"));
    component.render(80);
    const first = component.callRendererComponent?.cache;
    assert.ok(first, "write renderer should build a highlight cache");
    assert.ok(Array.isArray(first.highlightedLines), "cache should be a highlight cache");

    // Exactly what restyleExpanded() does on every streamed delta.
    stripBgDeep(component);

    component.updateArgs(args("const a = 1;\nconst b = 2;"));
    component.render(80);
    const second = component.callRendererComponent?.cache;
    assert.equal(second, first, "highlight cache must survive stripBgDeep");
    assert.equal(second.highlightedLines.length, 2, "second line highlighted incrementally");
    assert.equal(second.rawContent, "const a = 1;\nconst b = 2;");
  });

  it("still clears text render caches and plain render caches", () => {
    const highlightCache = { rawContent: "x", highlightedLines: ["x"], normalizedLines: ["x"] };
    const node = {
      cache: highlightCache,
      cachedText: "stale",
      cachedWidth: 80,
      cachedLines: ["stale"],
    };

    stripBgDeep(node);

    assert.equal(node.cache, highlightCache, "renderer-owned cache preserved");
    assert.equal(node.cachedText, undefined);
    assert.equal(node.cachedWidth, undefined);
    assert.equal(node.cachedLines, undefined);
  });

  it("falls back to dropping non-highlight caches when invalidateCache is absent", () => {
    const plain = { cache: { width: 10, lines: ["x"] } };
    stripBgDeep(plain);
    assert.equal(plain.cache, undefined);
  });
});
