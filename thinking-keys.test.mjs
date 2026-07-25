import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load via jiti-less: compile with dynamic import of TS through node --experimental?
// The package is loaded by pi via jiti; for tests import the .ts through a thin re-export.
// Use dynamic import of the built logic by evaluating the pure functions.

const require = createRequire(import.meta.url);
// Resolve pi-tui the same way the extension does
const piTuiPath = require.resolve("@earendil-works/pi-tui", {
  paths: [
    dirname(fileURLToPath(import.meta.url)),
    "/Users/cokekitten/.nvm/versions/node/v24.13.1/lib/node_modules/@earendil-works/pi-coding-agent",
  ],
});

const { matchesKey, Key } = await import(pathToFileURL(piTuiPath).href);

// Inline mirror of isThinkingExpandInput to avoid TS loader in node:test
const MAC_OPTION_T = "†";
function isThinkingExpandInput(data) {
  if (!data) return false;
  if (data === MAC_OPTION_T) return true;
  if (data === "\u2020") return true;
  try {
    if (matchesKey(data, Key.alt("t"))) return true;
    if (matchesKey(data, Key.ctrlShift("h"))) return true;
    if (matchesKey(data, Key.ctrlShift("t"))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

describe("isThinkingExpandInput", () => {
  it("matches macOS Option+T dagger character", () => {
    assert.equal(isThinkingExpandInput("†"), true);
    assert.equal(isThinkingExpandInput("\u2020"), true);
  });

  it("matches alt+t escape sequence", () => {
    assert.equal(isThinkingExpandInput("\x1bt"), true);
  });

  it("matches ctrl+shift+h kitty sequence", () => {
    // h = 104
    assert.equal(isThinkingExpandInput("\x1b[104;6u"), true);
  });

  it("does not match plain t or unrelated keys", () => {
    assert.equal(isThinkingExpandInput("t"), false);
    assert.equal(isThinkingExpandInput("T"), false);
    assert.equal(isThinkingExpandInput("\x1ba"), false);
    assert.equal(isThinkingExpandInput(""), false);
  });

  it("documents that matchesKey cannot match dagger", () => {
    // This is why registerShortcut("†") was a no-op
    assert.equal(matchesKey("†", "†"), false);
  });
});
