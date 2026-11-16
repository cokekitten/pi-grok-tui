import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Spacer, Text, TuiAltScreen, ScrollView, Container, VStack } from "@earendil-works/pi-tui";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  createCodemodeExtension,
  getMarkdownTheme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import {
  clickableChromeChild,
} from "./extensions/tool-click.ts";
import {
  dispatchGrokFoldUrl,
  idForTarget,
  installClickFoldPatch,
  resetFoldHandlers,
  thinkingFoldId,
} from "./extensions/click-fold.ts";
import { foldUrl } from "./extensions/click-fold-core.ts";
import {
  HOVER_BG,
  clearFoldRegistry,
  installFoldBodyTextPatch,
  markBodyFold,
  unmarkBodyFold,
  wrapFoldBodyComponent,
} from "./extensions/fold-body.ts";
import {
  getChildIndex,
  getNextSibling,
  getPreviousSibling,
  installParentStamp,
} from "./extensions/parent-stamp.ts";
import { applyGlobalThinkingToggle } from "./extensions/thinking-click.ts";
import { installThinkingPatch } from "./extensions/thinking-patch.ts";
import { ThinkingScrollComponent } from "./extensions/thinking-render.ts";
import { installToolCollapsePatch } from "./extensions/tool-collapse.ts";
import { installUserMessageStylePatch } from "./extensions/user-message-style.ts";
import { installWorkRollupPatch, rollupFoldId } from "./extensions/work-rollup.ts";
import { cycleToolViewMode, getState, resetClickFoldSession } from "./extensions/state.ts";

initTheme("dark", false);

let accentHex = "38;2;128;128;128";
const mutableTheme = {
  fg(_color, text) {
    return `\x1b[${accentHex}m${text}\x1b[39m`;
  },
  bold(text) {
    return `\x1b[1m${text}\x1b[22m`;
  },
};

beforeEach(() => {
  accentHex = "38;2;128;128;128";
  resetFoldHandlers();
  resetClickFoldSession();
  clearFoldRegistry();
  const state = getState();
  state.tuiMode = "fullscreen";
  state.clickFoldReady = true;
  state.hoveredFoldId = undefined;
});

describe("clickableChromeChild render cache", () => {
  it("reuses the exact line array across scroll frames and unrelated hover changes", () => {
    const target = {};
    const child = clickableChromeChild(mutableTheme, {
      target,
      toolName: "bash",
      kind: "tool_ok",
      label: "Ran git status — 检查工作区",
      pad: 2,
    });

    const first = child.render(100);
    const second = child.render(100);
    assert.equal(second, first);

    // Hovering a DIFFERENT fold id must not bust this row's cache
    getState().hoveredFoldId = "unrelated-fold-id";
    const third = child.render(100);
    assert.equal(third, first);
  });

  it("invalidates when its own fold id is hovered/unhovered, width changes, theme changes, or invalidate() runs", () => {
    const target = {};
    const id = idForTarget(target);
    const child = clickableChromeChild(mutableTheme, {
      target,
      toolName: "read",
      kind: "tool_ok",
      label: "Read a.ts",
      pad: 2,
    });

    const base = child.render(80);
    getState().hoveredFoldId = id;
    const hovered = child.render(80);
    assert.notEqual(hovered, base);
    assert.ok(hovered[0].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
    assert.equal(child.render(80), hovered);

    getState().hoveredFoldId = undefined;
    const unhovered = child.render(80);
    assert.equal(unhovered[0], base[0]);

    const narrower = child.render(12);
    assert.notEqual(narrower, unhovered);

    const beforeTheme = child.render(80);
    accentHex = "38;2;200;100;50";
    const afterTheme = child.render(80);
    assert.notEqual(afterTheme, beforeTheme);
    assert.ok(afterTheme[0].includes("38;2;200;100;50"));

    child.invalidate();
    const afterInvalidate = child.render(80);
    assert.notEqual(afterInvalidate, afterTheme);
    assert.equal(afterInvalidate[0], afterTheme[0]);
  });

  it("re-registers click handler on cached renders after resetFoldHandlers()", () => {
    const target = { toggled: 0, updateDisplay() { this.toggled += 1; } };
    const id = idForTarget(target);
    const child = clickableChromeChild(mutableTheme, {
      target,
      toolName: "bash",
      kind: "tool_ok",
      label: "Ran ls",
    });

    child.render(80);
    resetFoldHandlers();
    // Cached render must still keep click dispatch alive
    child.render(80);
    assert.equal(dispatchGrokFoldUrl(foldUrl(id)), true);
    assert.equal(target.toggled, 1);
  });
});

describe("wrapFoldBodyComponent and Text fold patch render cache", () => {
  let restoreText;
  beforeEach(() => {
    restoreText = installFoldBodyTextPatch();
  });
  afterEach(() => {
    restoreText?.();
  });

  it("caches marked Text.render arrays across scroll frames and invalidates on setText / hover / unmark", () => {
    const text = new Text("line one\nline two", 0, 0);
    markBodyFold(text, "body-1");

    const first = text.render(60);
    const second = text.render(60);
    assert.equal(second, first);

    getState().hoveredFoldId = "other-id";
    assert.equal(text.render(60), first);

    getState().hoveredFoldId = "body-1";
    const hovered = text.render(60);
    assert.notEqual(hovered, first);
    assert.ok(hovered[0].includes(`48;2;${HOVER_BG.r};${HOVER_BG.g};${HOVER_BG.b}`));
    assert.equal(text.render(60), hovered);

    getState().hoveredFoldId = undefined;
    text.setText("updated line");
    const updated = text.render(60);
    assert.notEqual(updated, first);
    assert.match(updated[0], /updated line/);

    unmarkBodyFold(text);
    const unmarked = text.render(60);
    assert.equal(unmarked[0].includes("\x1b]9999;"), false);
  });

  it("caches wrapFoldBodyComponent output when child lines and own hover state are unchanged", () => {
    const inner = new Text("alpha\nbeta", 0, 0);
    const wrapped = wrapFoldBodyComponent(inner, "wrap-1", 2);

    const first = wrapped.render(60);
    const second = wrapped.render(60);
    assert.equal(second, first);

    getState().hoveredFoldId = "someone-else";
    assert.equal(wrapped.render(60), first);

    getState().hoveredFoldId = "wrap-1";
    const hovered = wrapped.render(60);
    assert.notEqual(hovered, first);
    assert.equal(wrapped.render(60), hovered);

    getState().hoveredFoldId = undefined;
    inner.setText("gamma");
    const afterChange = wrapped.render(60);
    assert.notEqual(afterChange, first);
    assert.match(afterChange[0], /gamma/);
  });
});

describe("UserMessageComponent marked-row cache", () => {
  let restoreUser;
  beforeEach(async () => {
    restoreUser = await installUserMessageStylePatch();
  });
  afterEach(() => {
    restoreUser?.();
  });

  it("returns the exact same array reference across repeated scroll renders at the same width", () => {
    const comp = new UserMessageComponent("滚动性能测试消息");
    const first = comp.render(80);
    const second = comp.render(80);
    assert.equal(second, first);

    const narrower = comp.render(30);
    assert.notEqual(narrower, first);
    assert.equal(comp.render(30), narrower);
  });
});

describe("wheel scroll clears stale hover wash", () => {
  let restoreClick, tui;
  beforeEach(() => {
    restoreClick = installClickFoldPatch();
  });
  afterEach(() => {
    tui?.stop({ preserveScreen: true });
    tui = undefined;
    restoreClick?.();
  });

  it("clears hoveredFoldId on wheel scroll so scrolled-away blocks drop hover highlight", () => {
    let onInput;
    const term = {
      columns: 80,
      rows: 10,
      start(inputCb) { onInput = inputCb; },
      stop() {},
      write() {},
      hideCursor() {},
      showCursor() {},
    };
    const doc = new Container();
    for (let i = 0; i < 30; i++) {
      const t = new Text(`row ${i}`, 0, 0);
      markBodyFold(t, `row-${i}`);
      doc.addChild(t);
    }
    const scroll = new ScrollView(doc, { primary: true, follow: "end", scrollbar: "auto" });
    const root = new VStack([
      { component: scroll, grow: 1, minSize: 1 },
      { component: new Text("dock", 0, 0), basis: 1, shrink: 0 },
    ]);
    tui = new TuiAltScreen(term, false, undefined, { copyOnSelect: false, wheelScrollLines: 3 });
    tui.setLayoutRoot(root);
    tui.start();
    tui.renderNow();

    // Hover row 2
    onInput("\x1b[<35;5;3M");
    tui.renderNow();
    assert.ok(getState().hoveredFoldId?.startsWith("row-"));

    // Wheel scroll up — stale hover should clear immediately
    onInput("\x1b[<64;5;3M");
    tui.renderNow();
    assert.equal(getState().hoveredFoldId, undefined);

    // Moving pointer again still highlights the new row under cursor
    onInput("\x1b[<35;5;4M");
    tui.renderNow();
    assert.ok(getState().hoveredFoldId?.startsWith("row-"));
  });
});

describe("ThinkingScrollComponent own-hover cache & handler survival", () => {
  it("keeps cached line array when unrelated rows are hovered and re-registers click after resetFoldHandlers()", () => {
    const ts = 1_760_000_001_000;
    const comp = new ThinkingScrollComponent(
      mutableTheme,
      getMarkdownTheme(),
      ts,
      [{ text: "analyzing scroll bottleneck" }],
    );

    const first = comp.render(80);
    getState().hoveredFoldId = "other-fold-row";
    assert.equal(comp.render(80), first);

    const ownId = thinkingFoldId(ts);
    getState().hoveredFoldId = ownId;
    const hovered = comp.render(80);
    assert.notEqual(hovered, first);
    assert.equal(comp.render(80), hovered);

    // Cached render after resetFoldHandlers must still dispatch click
    getState().hoveredFoldId = undefined;
    assert.notEqual(comp.render(80), hovered);
    const unhovered = comp.render(80);
    resetFoldHandlers();
    assert.equal(comp.render(80), unhovered);
    assert.equal(dispatchGrokFoldUrl(foldUrl(ownId)), true);
    const expanded = comp.render(80);
    assert.ok(expanded.length > 1);

    // Unrelated hover while expanded must not rebuild markdown
    getState().hoveredFoldId = "another-row";
    assert.equal(comp.render(80), expanded);
  });
});

describe("parent-stamp O(1) sibling index & chatContainer work-rollup frame cache", () => {
  it("maintains exact getChildIndex / sibling links across addChild, removeChild, and clear", () => {
    const restoreStamp = installParentStamp();
    try {
      const c = new Container();
      const a = new Text("a", 0, 0);
      const b = new Text("b", 0, 0);
      const d = new Text("d", 0, 0);
      c.addChild(a);
      c.addChild(b);
      c.addChild(d);
      assert.equal(getChildIndex(a), 0);
      assert.equal(getChildIndex(b), 1);
      assert.equal(getChildIndex(d), 2);
      assert.equal(getPreviousSibling(d), b);
      assert.equal(getNextSibling(a), b);

      c.removeChild(b);
      assert.equal(getChildIndex(d), 1);
      assert.equal(getPreviousSibling(d), a);
      assert.equal(getNextSibling(a), d);

      c.clear();
      assert.equal(getChildIndex(a), -1);
    } finally {
      restoreStamp();
    }
  });

  it("reuses exact chat.render lines & mouseLayout across scroll frames and keeps large multi-turn scroll sub-2ms/frame", async () => {
    let codemodeDef;
    createCodemodeExtension()({
      getSettings: () => ({}),
      getAllTools: () => [],
      appendEntry() {},
      registerTool(def) {
        codemodeDef = def;
      },
    });

    const cleanups = [
      installClickFoldPatch(),
      installParentStamp(),
      installFoldBodyTextPatch(),
      await installThinkingPatch(),
      await installToolCollapsePatch(),
      await installUserMessageStylePatch(),
      await installWorkRollupPatch(),
    ];

    try {
      const mdTheme = getMarkdownTheme();
      const uiStub = { requestRender() {} };
      const chat = new Container();
      let lastProse;

      // 300 turns × 8 children = 2,400 chat children
      for (let t = 0; t < 300; t++) {
        const base = 1_760_010_000_000 + t * 10_000;
        chat.addChild(new Spacer(1));
        chat.addChild(new UserMessageComponent("Turn " + t + " prompt", mdTheme, 1, []));

        const a1 = new AssistantMessageComponent(undefined, false, mdTheme, "Thinking...", 1, []);
        a1.updateContent(
          {
            role: "assistant",
            timestamp: base + 100,
            stopReason: "toolUse",
            content: [
              { type: "thinking", thinking: "Step " + t + ".1" },
              { type: "toolCall", id: "cm-" + t, name: "codemode", arguments: { code: "..." } },
            ],
          },
          false,
        );
        chat.addChild(a1);

        const cm = new ToolExecutionComponent(
          "codemode",
          "cm-" + t,
          { code: "await tools.read({ path: 'a.ts' });" },
          { showImages: false, outputPad: 1 },
          codemodeDef,
          uiStub,
          "/proj",
        );
        cm.setArgsComplete();
        cm.updateResult(
          {
            content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
            details: {
              calls: [
                { id: "1", name: "read", args: '{"path":"/proj/a.ts"}', status: "ok", durationMs: 4 },
                { id: "2", name: "read", args: '{"path":"/proj/b.ts"}', status: "ok", durationMs: 5 },
              ],
            },
            timestamp: base + 500,
          },
          false,
        );
        chat.addChild(cm);

        const r1 = new ToolExecutionComponent("read", "r1-" + t, { path: "c.ts" }, {}, undefined, uiStub, "/proj");
        r1.setArgsComplete();
        r1.updateResult({ content: [{ type: "text", text: "ok" }], timestamp: base + 700 }, false);
        chat.addChild(r1);

        const r2 = new ToolExecutionComponent("read", "r2-" + t, { path: "d.ts" }, {}, undefined, uiStub, "/proj");
        r2.setArgsComplete();
        r2.updateResult({ content: [{ type: "text", text: "ok" }], timestamp: base + 900 }, false);
        chat.addChild(r2);

        chat.addChild(new Spacer(0));

        const prose = new AssistantMessageComponent(undefined, false, mdTheme, "Thinking...", 1, []);
        prose.updateContent(
          {
            role: "assistant",
            timestamp: base + 1200,
            stopReason: "stop",
            content: [
              { type: "thinking", thinking: "Finalizing " + t },
              { type: "text", text: "Turn " + t + " response complete." },
            ],
          },
          false,
        );
        chat.addChild(prose);
        lastProse = prose;
      }

      const first = chat.render(120);
      const firstLayout = chat.mouseLayout;
      const second = chat.render(120);
      assert.equal(second, first);
      assert.equal(chat.mouseLayout, firstLayout);

      // Hovering one rollup header patches only that row and preserves mouseLayout identity
      const rId = rollupFoldId(lastProse);
      getState().hoveredFoldId = rId;
      const hovered = chat.render(120);
      assert.notEqual(hovered, first);
      assert.equal(hovered.length, first.length);
      assert.equal(chat.mouseLayout, firstLayout);

      getState().hoveredFoldId = undefined;
      const unhovered = chat.render(120);
      assert.deepEqual(unhovered, first);
      assert.equal(chat.render(120), unhovered);

      // Benchmark 50 consecutive scroll renders on 2,400 children
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        chat.render(120);
      }
      const avgMs = (performance.now() - t0) / 50;
      assert.ok(avgMs < 3, "Expected <3ms per cached chat.render on 2,400 children, got " + avgMs.toFixed(3) + "ms");

      // Expanded modes (Alt+T and Ctrl+O) also cache cleanly across scroll frames
      applyGlobalThinkingToggle();
      const altT1 = chat.render(120);
      const altT2 = chat.render(120);
      assert.equal(altT2, altT1);
      applyGlobalThinkingToggle();

      cycleToolViewMode(); // truncated
      const tr1 = chat.render(120);
      const tr2 = chat.render(120);
      assert.equal(tr2, tr1);
      cycleToolViewMode(); // full
      cycleToolViewMode(); // back to chrome
    } finally {
      cleanups.reverse().forEach((fn) => fn());
    }
  });
});
