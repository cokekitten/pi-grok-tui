/**
 * Regression: collapsing an image-bearing tool must not desync Pi's image caches.
 *
 * Pi 1.5's ToolExecutionComponent.updateDisplay() re-adds images with
 *   imageComponent = previous ? previousImages[index] : new Image(...)
 * where `previous` comes from imageSources[index]. Dropping imageComponents
 * while leaving imageSources behind makes it addChild(undefined), and the next
 * paint dies with "Cannot read properties of undefined (reading 'render')"
 * inside Container.render.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { installToolCollapsePatch } from "./extensions/tool-collapse.ts";
import { getState, resetClickFoldSession } from "./extensions/state.ts";

initTheme("dark");

let undo;
before(async () => {
  undo = await installToolCollapsePatch();
});
after(() => {
  undo();
});

beforeEach(() => {
  resetClickFoldSession();
  Object.assign(getState(), { toolViewMode: "full", globalExpanded: false, tuiMode: "regular" });
});

// 1x1 transparent PNG
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const stub = (label) => ({
  text: "",
  render: () => [label],
  invalidate() {},
  setText(text) {
    this.text = text;
    return this;
  },
  handleMouse() {},
  setBgFn() {},
  setCustomBgFn() {},
  setPaddingX() {},
});

const definition = {
  renderShell: "default",
  renderCall: () => stub("call"),
  renderResult: () => stub("result"),
};

const ui = { requestRender() {}, children: [] };

function makeImageTool() {
  const component = new ToolExecutionComponent(
    "read",
    "call-image",
    { path: "/tmp/pasted.png" },
    { showImages: true, imageWidthCells: 40, outputPad: 1 },
    definition,
    ui,
    "/tmp",
  );
  component.updateResult(
    {
      content: [
        { type: "text", text: "Read image file [image/png]" },
        { type: "image", data: PNG, mimeType: "image/png" },
      ],
      details: {},
      isError: false,
      durationMs: 3,
    },
    false,
  );
  return component;
}

describe("image tool collapse", () => {
  it("keeps children renderable across full -> chrome -> full", () => {
    const component = makeImageTool();
    component.updateDisplay();
    assert.equal(
      component.imageComponents.length,
      1,
      "test host must support image components",
    );

    // chrome view strips the image children
    getState().toolViewMode = "chrome";
    component.updateDisplay();
    assert.equal(component.imageComponents.length, 0, "chrome view removes image children");

    // re-expanding repaints them from Pi's previous* caches
    getState().toolViewMode = "full";
    component.updateDisplay();
    assert.equal(
      component.children.filter((child) => child === undefined).length,
      0,
      "no undefined child may be pushed into the chat container",
    );
    assert.equal(component.imageComponents.length, 1, "images come back on expand");
    assert.doesNotThrow(() => component.render(80));
  });
});
