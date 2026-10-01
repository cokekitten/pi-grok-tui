import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageComponent, UserMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion, ScrollView, Text, TuiAltScreen, VStack, stripTerminalSequences } from "@earendil-works/pi-tui";
import { installClickFoldPatch, resetFoldHandlers } from "./extensions/click-fold.ts";
import { parseFoldMarker } from "./extensions/fold-body.ts";
import { installPromptJumpPatch } from "./extensions/prompt-jump.ts";
import { installUserMessageStylePatch } from "./extensions/user-message-style.ts";
import { resetClickFoldSession } from "./extensions/state.ts";

// Only terminal I/O is replaced. Messages, layout, scrolling, paint, and SGR
// mouse dispatch all run through pi's real components (no hand-built layout).
class MemoryTerminal {
  columns = 64;
  rows = 20;
  kittyProtocolActive = false;
  start(onInput) { this.input = onInput; }
  stop() {}
  async drainInput() {}
  write() {}
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
}
const plain = (s) => stripTerminalSequences(s ?? "").trim();
const answer = (name) => new AssistantMessageComponent({
  role: "assistant", content: [{ type: "text", text: Array.from({ length: 40 }, (_, i) => `${name} line ${i}`).join("\n") }],
  stopReason: "stop",
}, false);
let cleanup, tui, restoreUser;
beforeEach(async () => {
  initTheme("dark", false);
  resetClickFoldSession();
  resetFoldHandlers();
  const click = installClickFoldPatch();
  restoreUser = await installUserMessageStylePatch();
  const jump = installPromptJumpPatch();
  cleanup = () => { jump(); restoreUser(); click(); };
});
afterEach(() => {
  tui?.stop({ output: "none" });
  tui = undefined;
  cleanup?.();
  resetFoldHandlers();
});
function createView(onBodyMouse, existingUser) {
  const terminal = new MemoryTerminal();
  const first = new UserMessageComponent("FIRST USER");
  const firstAnswer = answer("FIRST ASSISTANT");
  const second = existingUser ?? new UserMessageComponent("SECOND USER\n\nSecond user continuation");
  const secondAnswer = answer("SECOND ASSISTANT");
  const doc = new Container();
  for (const component of [first, firstAnswer, second, onBodyMouse ? new MouseRegion(secondAnswer, onBodyMouse) : secondAnswer]) doc.addChild(component);
  const scroll = new ScrollView(doc, { primary: true, follow: "end", scrollbar: "always" });
  const root = new VStack([
    { component: new Text("HEADER", 0, 0), basis: 1, shrink: 0 },
    { component: scroll, grow: 1, minSize: 1 },
    { component: new Text("EDITOR\nFOOTER", 0, 0), basis: 2, shrink: 0 },
  ]);
  tui = new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false, scrollToEndIndicator: () => "LATEST" });
  tui.setLayoutRoot(root);
  tui.start();
  tui.renderNow();
  const draw = () => { tui.renderNow(); return tui.previousScreen; };
  const input = (data) => { terminal.input(data); return draw(); };
  const wheelUp = () => input("\x1b[<64;4;5M");
  const clickTop = () => { input("\x1b[<0;4;2M"); return input("\x1b[<0;4;2m"); };
  const secondRow = first.render(63).length + firstAnswer.render(63).length;
  return { terminal, scroll, draw, input, wheelUp, clickTop, secondRow, doc };
}

describe("prompt jump with real fullscreen components", () => {
  it("paints user text after a wheel-up despite OSC 133 being on blank padding", () => {
    const v = createView();
    assert.equal(tui.isFollowingOutput, true);
    assert.ok(!tui.previousScreen.some(r => parseFoldMarker(r) === "prompt-jump"));
    const screen = v.wheelUp();
    assert.equal(tui.isFollowingOutput, false);
    assert.equal(plain(screen[0]), "HEADER");
    assert.equal(parseFoldMarker(screen[1]), "prompt-jump");
    assert.match(plain(screen[1]), /^❯ SECOND USER/);
    assert.ok(!plain(screen[1]).includes("ASSISTANT"));
    assert.equal(screen.filter(r => parseFoldMarker(r) === "prompt-jump").length, 1);
  });

  it("clicks step through users while leaving the landed message below the single strip", () => {
    const v = createView();
    v.wheelUp();
    let screen = v.clickTop();
    assert.equal(v.scroll.scrollTop, v.secondRow);
    assert.equal(parseFoldMarker(screen[1]), "prompt-jump");
    assert.match(plain(screen[1]), /^❯ FIRST USER/);
    assert.match(plain(screen[2]), /^❯ SECOND USER/);
    assert.ok(screen.some(r => plain(r).includes("Second user continuation")));
    screen = v.clickTop();
    assert.equal(v.scroll.scrollTop, 0);
    assert.ok(!screen.some(r => parseFoldMarker(r) === "prompt-jump"));
    assert.match(plain(screen[2]), /^❯ FIRST USER/);
  });

  it("still marks and prefixes a user built before extension reload", async () => {
    restoreUser();
    const existing = new UserMessageComponent("BEFORE_RELOAD");
    restoreUser = await installUserMessageStylePatch();
    const v = createView(undefined, existing);
    const screen = v.wheelUp();
    assert.equal(parseFoldMarker(screen[1]), "prompt-jump");
    assert.match(plain(screen[1]), /^❯ BEFORE_RELOAD/);
    v.clickTop();
    assert.equal(v.scroll.scrollTop, v.secondRow);
  });

  it("clicks the strip instead of a mouse-aware tool/body underneath", () => {
    let bodyPresses = 0;
    const v = createView(event => {
      if (event.type === "press") { bodyPresses++; return { handled: true }; }
    });
    v.wheelUp();
    v.clickTop();
    assert.equal(bodyPresses, 0);
    assert.equal(v.scroll.scrollTop, v.secondRow);
  });

  it("leaves secondary clicks to pi's native mouse routing", () => {
    let secondary = 0;
    const v = createView(event => {
      if (event.type === "press" && event.button === "right") {
        secondary++;
        return { handled: true };
      }
    });
    v.wheelUp();
    const top = v.scroll.scrollTop;
    v.input("\x1b[<2;8;2M");
    assert.equal(secondary, 1);
    assert.equal(v.scroll.scrollTop, top);
  });

  it("brightens on real mouse motion and clears hover when the pointer leaves", () => {
    const v = createView();
    v.wheelUp();
    const hover = v.input("\x1b[<35;8;2M");
    assert.ok(hover[1].includes("48;2;44;44;44"));
    const away = v.input("\x1b[<35;8;3M");
    assert.ok(!away[1].includes("48;2;44;44;44"));
    assert.equal(parseFoldMarker(away[1]), "prompt-jump");
  });

  it("does not activate on drag and keeps the scrollbar cell intact", () => {
    const v = createView();
    let screen = v.wheelUp();
    assert.ok(/[│┃]/u.test(plain(screen[1]).at(-1)));
    const top = v.scroll.scrollTop;
    v.input("\x1b[<0;4;2M");
    v.input("\x1b[<32;8;2M");
    screen = v.input("\x1b[<0;8;2m");
    assert.equal(v.scroll.scrollTop, top);
    assert.equal(parseFoldMarker(screen[1]), "prompt-jump");
  });

  it("yields to dialogs, then resumes the strip when they close", () => {
    const v = createView();
    v.wheelUp();
    const overlay = tui.showOverlay(new Text("DIALOG", 0, 0), { anchor: "top-left", width: 20 });
    const screen = v.draw();
    assert.ok(screen.some(r => plain(r).includes("DIALOG")));
    assert.ok(!screen.some(r => parseFoldMarker(r) === "prompt-jump"));
    overlay.hide();
    assert.equal(parseFoldMarker(v.draw()[1]), "prompt-jump");
  });

  it("recomputes positions after resize instead of jumping to a stale row", () => {
    const v = createView();
    v.wheelUp();
    v.terminal.columns = 24;
    v.draw();
    // Reflow makes the earlier answer taller. Navigate back to the end so
    // SECOND USER is above the viewport again, then use the newly painted link.
    v.input("\x1b[F");
    v.wheelUp();
    v.clickTop();
    const screen = v.draw();
    assert.match(plain(screen[1]), /^❯ FIRST USER/);
    assert.match(plain(screen[2]), /^❯ SECOND USER/);
  });

  it("hides again at the bottom and preserves the native jump-to-end label", () => {
    const v = createView();
    const screen = v.wheelUp();
    assert.ok(screen.some(r => plain(r).includes("LATEST")));
    assert.equal(parseFoldMarker(screen[1]), "prompt-jump");
    const bottom = v.input("\x1b[F");
    assert.equal(tui.isFollowingOutput, true);
    assert.ok(!bottom.some(r => parseFoldMarker(r) === "prompt-jump"));
  });
});
