import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Container, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import {
  editorDockFillRows,
  installEditorDockPatch,
  isEditorDockEnabled,
} from "./extensions/editor-dock.ts";

class FakeTerminal {
  columns = 80;
  rows = 20;
}

class FakeMainEditor {
  actionHandlers = new Map();

  constructor(tui) {
    this.tui = tui;
  }

  getText() {
    return "";
  }

  setText() {}

  handleInput() {}

  render() {
    return ["editor-top", "editor-body", "editor-bottom"];
  }
}

function editorIndexOnScreen(lines, terminalRows) {
  const logical = lines.indexOf("editor-top");
  const viewportTop = Math.max(0, lines.length - terminalRows);
  return logical - viewportTop;
}

describe("editorDockFillRows", () => {
  it("fills only an under-height root", () => {
    assert.equal(editorDockFillRows(5, 20), 15);
    assert.equal(editorDockFillRows(20, 20), 0);
    assert.equal(editorDockFillRows(25, 20), 0);
  });

  it("fails closed on invalid dimensions", () => {
    assert.equal(editorDockFillRows(Number.NaN, 20), 0);
    assert.equal(editorDockFillRows(5, Number.POSITIVE_INFINITY), 0);
  });
});

describe("installEditorDockPatch", () => {
  it("keeps the main editor at the same screen row through Pi's stable TUI reference", () => {
    const terminal = new FakeTerminal();
    const tui = new TuiMainScreen(terminal);
    // Pi 0.84 gives components a stable proxy while render() runs on the
    // replaceable concrete renderer, so object identity intentionally differs.
    const stableTuiReference = new Proxy(tui, {});
    const chat = new Container();
    const editorContainer = new Container();
    const editor = new FakeMainEditor(stableTuiReference);

    chat.addChild(new Text("hello", 0, 0));
    editorContainer.addChild(editor);
    tui.addChild(chat);
    tui.addChild(editorContainer);
    tui.addChild(new Text("footer", 0, 0));

    const cleanup = installEditorDockPatch();
    try {
      const short = tui.render(terminal.columns);
      assert.equal(short.length, terminal.rows);
      assert.equal(editorIndexOnScreen(short, terminal.rows), 16);

      chat.addChild(new Text("1\n2\n3\n4\n5", 0, 0));
      const medium = tui.render(terminal.columns);
      assert.equal(medium.length, terminal.rows);
      assert.equal(editorIndexOnScreen(medium, terminal.rows), 16);

      chat.addChild(
        new Text(
          Array.from({ length: 20 }, (_, i) => `overflow-${i}`).join("\n"),
          0,
          0,
        ),
      );
      const overflow = tui.render(terminal.columns);
      assert.ok(overflow.length > terminal.rows);
      assert.equal(editorIndexOnScreen(overflow, terminal.rows), 16);
      assert.equal(overflow.at(-1)?.trimEnd(), "footer");
    } finally {
      cleanup();
    }

    // Native inline layout is restored exactly after cleanup.
    assert.equal(tui.render(terminal.columns).length, 30);
  });

  it("preserves native rendering when the main editor is absent", () => {
    const terminal = new FakeTerminal();
    const tui = new TuiMainScreen(terminal);
    tui.addChild(new Text("selector\nwithout editor", 0, 0));
    const expected = tui.render(terminal.columns);

    const cleanup = installEditorDockPatch();
    try {
      assert.deepEqual(tui.render(terminal.columns), expected);
    } finally {
      cleanup();
    }
  });
});

describe("isEditorDockEnabled", () => {
  it("accepts an environment escape hatch", () => {
    const previous = process.env.PI_GROK_TUI_DOCK_EDITOR;
    try {
      process.env.PI_GROK_TUI_DOCK_EDITOR = "0";
      assert.equal(isEditorDockEnabled(), false);
      process.env.PI_GROK_TUI_DOCK_EDITOR = "false";
      assert.equal(isEditorDockEnabled(), false);
      process.env.PI_GROK_TUI_DOCK_EDITOR = "1";
      assert.equal(isEditorDockEnabled(), true);
    } finally {
      if (previous === undefined) delete process.env.PI_GROK_TUI_DOCK_EDITOR;
      else process.env.PI_GROK_TUI_DOCK_EDITOR = previous;
    }
  });

  it("leaves TuiMainScreen.render untouched when disabled", () => {
    const previous = process.env.PI_GROK_TUI_DOCK_EDITOR;
    const originalRender = TuiMainScreen.prototype.render;
    try {
      process.env.PI_GROK_TUI_DOCK_EDITOR = "0";
      const cleanup = installEditorDockPatch();
      assert.equal(TuiMainScreen.prototype.render, originalRender);
      cleanup();
      assert.equal(TuiMainScreen.prototype.render, originalRender);
    } finally {
      if (previous === undefined) delete process.env.PI_GROK_TUI_DOCK_EDITOR;
      else process.env.PI_GROK_TUI_DOCK_EDITOR = previous;
    }
  });
});
