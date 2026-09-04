import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Box, MouseRegion, Text } from "@earendil-works/pi-tui";
import { stripBgDeep } from "./extensions/flat-style.ts";

describe("stripBgDeep", () => {
  it("clears background through a pi 0.85 MouseRegion wrapper", () => {
    const box = new Box(0, 0, (text) => `\x1b[48;2;34;49;34m${text}\x1b[49m`);
    box.addChild(new Text("edit path.ts", 0, 0));
    const region = new MouseRegion(box, () => undefined);
    const before = region.render(24).join("\n");
    assert.ok(before.includes("48;2;34;49;34"), before);
    stripBgDeep({ children: [region] });
    const after = region.render(24).join("\n");
    assert.equal(after.includes("48;2;34;49;34"), false, after);
  });
});
