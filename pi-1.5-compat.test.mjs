import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageComponent, ToolExecutionComponent, UserMessageComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { installThinkingPatch } from "./extensions/thinking-patch.ts";
import { installToolCollapsePatch } from "./extensions/tool-collapse.ts";
import { installUserMessageStylePatch } from "./extensions/user-message-style.ts";
import { installParentStamp } from "./extensions/parent-stamp.ts";
import { ThinkingScrollComponent } from "./extensions/thinking-render.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

initTheme("dark");
let undo;
before(async () => {
  const cleanup = [installParentStamp(), await installThinkingPatch(), await installToolCollapsePatch(), await installUserMessageStylePatch()];
  undo = () => cleanup.reverse().forEach(fn => fn());
});
after(() => undo());
beforeEach(() => {
  resetClickFoldSession();
  Object.assign(getState(), { toolViewMode: "chrome", globalExpanded: false, tuiMode: "regular" });
  getState().activeByTimestamp.clear();
});
const message = content => ({ role: "assistant", content, timestamp: 123, stopReason: "stop" });
const prose = text => ({ type: "text", text });
const thought = thinking => ({ type: "thinking", thinking });
const plain = component => component.render(80).map(stripTerminalSequences).join("\n");
const body = component => component.contentContainer.children.find(c => c instanceof Markdown);
const thinking = component => component.contentContainer.children.find(c => c instanceof ThinkingScrollComponent);
function countingTheme() {
  let calls = 0;
  const native = getMarkdownTheme();
  return { theme: { ...native, highlightCode: (...args) => { calls++; return native.highlightCode(...args); } }, count: () => calls };
}
// Use a literal complete code block; only the following paragraph changes.
const source = "```js\nconst a = 1;\n```\n\n";

describe("Pi 1.5 streaming renderer compatibility", () => {
  it("reuses assistant Markdown and completed code highlighting across streamed frames", () => {
    const h = countingTheme();
    const c = new AssistantMessageComponent(undefined, false, h.theme);
    c.updateContent(message([prose(source + "hello")]), true);
    const first = body(c); plain(c);
    for (let i = 0; i < 4; i++) {
      c.updateContent(message([prose(source + "hello " + i)]), true);
      plain(c);
      assert.equal(body(c), first, "keep the Markdown instance and its block cache");
    }
    assert.equal(h.count(), 1);
    assert.equal(c.isStreaming, true);
    c.invalidate(); plain(c);
    assert.equal(h.count(), 2, "theme invalidation must recolor cached code");
    c.updateContent(message([prose(source.replace("a = 1", "b = 2") + "changed")]), true);
    assert.match(plain(c), /b = 2/);
    assert.doesNotMatch(plain(c), /a = 1/);
    assert.equal(h.count(), 3, "changed code cannot reuse stale highlights");
  });

  it("reuses thinking and its Markdown while later paragraphs stream", () => {
    const h = countingTheme();
    getState().activeByTimestamp.set(123, {});
    const c = new AssistantMessageComponent(undefined, false, h.theme);
    c.updateContent(message([thought(source + "hello")]), true);
    const first = thinking(c); plain(c);
    for (let i = 0; i < 4; i++) {
      c.updateContent(message([thought(source + "hello " + i)]), true);
      plain(c);
      assert.equal(thinking(c), first);
    }
    assert.equal(h.count(), 1);
    c.invalidate(); plain(c);
    assert.equal(h.count(), 2);
  });

  it("keeps streamed text correct when block kinds, pad and message identity change", () => {
    const c = new AssistantMessageComponent();
    c.updateContent(message([prose("FIRST"), thought("THINK"), prose("LAST")]), true);
    const first = body(c); plain(c);
    c.updateContent(message([prose("REPLACED")]), false);
    assert.match(plain(c), /REPLACED/);
    assert.doesNotMatch(plain(c), /FIRST|LAST|THINK/);
    assert.equal(body(c), first);
    c.setOutputPad(3);
    assert.match(plain(c), /REPLACED/);
    c.updateContent({ ...message([prose("NEW MESSAGE")]), timestamp: 456 });
    assert.match(plain(c), /NEW MESSAGE/);
    assert.doesNotMatch(plain(c), /REPLACED/);
  });
});

describe("Pi 1.5 deferred tool argument batches", () => {
  function tool(id) {
    return new ToolExecutionComponent("bash", id, { command: "echo old" }, {}, undefined, { requestRender() {} }, "/tmp");
  }
  for (const mode of ["chrome", "truncated", "full"]) {
    it("consumes a batch once in " + mode + " mode", () => {
      getState().toolViewMode = mode;
      const c = tool("single");
      let calls = 0;
      const update = c.updateDisplay;
      c.updateDisplay = function() { calls++; return update.call(this); };
      c.updateArgs({ command: "echo first" });
      c.updateArgs({ command: "echo last" });
      plain(c);
      assert.equal(c.argsPending, false);
      assert.equal(calls, 1);
      plain(c); assert.equal(calls, 1, "a repaint without new args does no work");
    });
  }
  it("consumes batches for both collapsed group headers and hidden members", () => {
    const parent = new Container(), a = tool("a"), b = tool("b");
    parent.addChild(a); parent.addChild(b);
    a.updateArgs({ command: "echo a" }); b.updateArgs({ command: "echo b" });
    parent.render(80);
    assert.equal(a.argsPending, false);
    assert.equal(b.argsPending, false);
    assert.equal(b.hideComponent, true);
    let calls = 0;
    for (const c of [a, b]) {
      const update = c.updateDisplay;
      c.updateDisplay = function() { calls++; return update.call(this); };
    }
    parent.render(80);
    assert.equal(calls, 0);
  });
});

describe("thinking lifecycle and cache boundaries", () => {
  it("keeps the three-line live tail, collapsed chrome and expanded body at narrow widths", () => {
    const c = new AssistantMessageComponent();
    const input = message([thought("LINE1\nLINE2\nLINE3\nLINE4")]);
    getState().activeByTimestamp.set(123, {});
    c.updateContent(input, true);
    assert.match(plain(c), /Thinking/);
    assert.doesNotMatch(plain(c), /LINE1/);
    assert.match(plain(c), /LINE4/);
    getState().activeByTimestamp.clear();
    c.updateContent(input, false);
    assert.match(plain(c), /Thought/);
    assert.doesNotMatch(plain(c), /LINE[1-4]/);
    getState().globalExpanded = true;
    assert.match(plain(c), /LINE1/);
    assert.match(plain(c), /LINE4/);
    for (const width of [6, 12, 24]) {
      const lines = c.render(width);
      assert.ok(lines.length > 0);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    c.updateContent(message([]));
    assert.doesNotMatch(plain(c), /Thought|LINE/);
  });

  it("does not reuse a thinking component for a different message or Markdown theme", () => {
    const c = new AssistantMessageComponent();
    c.updateContent(message([thought("FIRST")]));
    const first = thinking(c);
    c.updateContent({ ...message([thought("SECOND")]), timestamp: 456 });
    assert.notEqual(thinking(c), first);
    const second = thinking(c);
    c.markdownTheme = { ...getMarkdownTheme() };
    c.updateContent(c.lastMessage);
    assert.notEqual(thinking(c), second);
  });
});

describe("Markdown transformer interoperability", () => {
  it("forwards saved user context and exact bubble width in load order without mutating text", () => {
    const seen = [];
    const transforms = [
      (text, ctx) => { seen.push({ text, ...ctx }); return text.replace("ORIGINAL", "FIRST"); },
      () => { throw new Error("broken extension"); },
      () => undefined,
      text => text.replace("FIRST", "FINAL"),
    ];
    const c = new UserMessageComponent("ORIGINAL", getMarkdownTheme(), 1, transforms, "saved-user", "2026-11-04T00:00:00Z");
    assert.match(plain(c), /FINAL/);
    assert.equal(c.text, "ORIGINAL");
    assert.deepEqual(seen[0], { text: "ORIGINAL", messageType: "user", isStreaming: false, availableWidth: 76, messageId: "saved-user", timestamp: "2026-11-04T00:00:00Z" });
    c.render(24);
    assert.equal(seen.at(-1).availableWidth, 20);
  });

  it("refreshes assistant transforms when identical text transitions from streaming to final", () => {
    const seen = [];
    const transform = (text, ctx) => { seen.push(ctx); return ctx.isStreaming ? "STREAMING" : "FINAL"; };
    const c = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, [transform], "saved-a", "2026-11-04T00:00:00Z");
    const input = message([prose("ORIGINAL")]);
    c.updateContent(input, true); assert.match(plain(c), /STREAMING/);
    c.updateContent(input, false); assert.match(plain(c), /FINAL/);
    assert.deepEqual(seen.map(x => x.isStreaming), [true, false]);
    assert.equal(seen[0].messageType, "assistant");
    assert.equal(seen[0].availableWidth, 76);
    assert.equal(seen[0].messageId, "saved-a");
    assert.equal(seen[0].timestamp, "2026-11-04T00:00:00Z");
    assert.equal(input.content[0].text, "ORIGINAL");
  });

  it("chains assistant transforms safely and passes persisted thinking metadata at resized widths", () => {
    const seen = [];
    const transforms = [
      (text, ctx) => { seen.push({ text, ...ctx }); return text.replace("ORIGINAL", "FIRST"); },
      () => { throw new Error("broken extension"); },
      () => null,
      text => text.replace("FIRST", "FINAL"),
    ];
    const c = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, transforms, "saved-think", "2026-11-04T00:00:00Z");
    getState().globalExpanded = true;
    c.updateContent(message([prose("ORIGINAL BODY"), thought("ORIGINAL THINKING")]));
    assert.match(plain(c), /FINAL BODY/);
    assert.match(plain(c), /FINAL THINKING/);
    assert.equal(seen.find(x => x.messageType === "assistant-thinking").messageId, "saved-think");
    assert.equal(seen.find(x => x.messageType === "assistant-thinking").timestamp, "2026-11-04T00:00:00Z");
    c.render(24);
    assert.equal(seen.at(-1).availableWidth, 20);
  });

  it("keeps live user/assistant metadata undefined and forwards empty transformer output", () => {
    const seen = [];
    const transform = (text, ctx) => { seen.push(ctx); return ""; };
    const a = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, [transform]);
    const u = new UserMessageComponent("ORIGINAL", getMarkdownTheme(), 1, [transform]);
    a.updateContent(message([prose("ORIGINAL")]), true);
    assert.doesNotMatch(plain(a), /ORIGINAL/);
    assert.doesNotMatch(plain(u), /ORIGINAL/);
    assert.equal(seen.length, 2);
    for (const context of seen) {
      assert.equal(context.messageId, undefined);
      assert.equal(context.timestamp, undefined);
    }
  });

  it("transforms original thinking source before adding display-only hard breaks", () => {
    const seen = [];
    const transform = (text, ctx) => { seen.push({ text, ...ctx }); return text.replace("ORIGINAL", ctx.isStreaming ? "LIVE THINKING" : "DONE THINKING"); };
    const c = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, [transform]);
    const input = message([thought("ORIGINAL\nNEXT")]);
    getState().activeByTimestamp.set(123, {});
    c.updateContent(input, true); assert.match(plain(c), /LIVE THINKING/);
    assert.equal(seen[0].text, "ORIGINAL\nNEXT");
    assert.equal(seen[0].messageType, "assistant-thinking");
    assert.equal(seen[0].availableWidth, 76);
    assert.equal(seen[0].messageId, undefined);
    assert.equal(seen[0].timestamp, undefined);
    getState().activeByTimestamp.clear(); getState().globalExpanded = true;
    c.updateContent(input, false); assert.match(plain(c), /DONE THINKING/);
    assert.equal(input.content[0].thinking, "ORIGINAL\nNEXT");
    assert.equal(seen.at(-1).isStreaming, false);
  });
});
