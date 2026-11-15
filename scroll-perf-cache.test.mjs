import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Text, TuiAltScreen, ScrollView, Container, VStack } from "@earendil-works/pi-tui";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  clickableChromeChild,
} from "./extensions/tool-click.ts";
import {
  dispatchGrokFoldUrl,
  idForTarget,
  installClickFoldPatch,
  resetFoldHandlers,
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
import { installUserMessageStylePatch } from "./extensions/user-message-style.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

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
