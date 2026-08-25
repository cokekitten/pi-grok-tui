# Fullscreen Click-to-Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. User authorized in-place work on `main` and forbade mid-task confirmation stops.

**Goal:** In pi fullscreen, clicking grok-tui thinking/tool/custom chrome folds that row (Grok per-block semantics); hide `(⌥T)` / `(Ctrl+O)` hints when clicks work.

**Architecture:** Pure fold/URI/hint helpers in `click-fold-core.ts`. Runtime OSC 8 registry + `TuiAltScreen`/`TuiMainScreen` patches in `click-fold.ts`. Existing thinking/tool/custom patches consume those helpers. Display-only monkey-patches; no pi core fork.

**Tech Stack:** TypeScript pi extension, node:test (`node --experimental-strip-types --test`).

## Global Constraints

- Display-only (no session files, model I/O, or tool execution changes)
- Gesture: single click on chrome title row only; body stays selectable
- Fullscreen-only custom OSC 8 (`pi-grok-tui://v1/fold/<id>`); regular mode never emits it
- Consume every `pi-grok-tui:` URL (valid, stale, malformed); never `openBrowser` those
- Hints omitted only when `tuiMode === "fullscreen"` **and** `clickFoldReady === true`
- `Alt+T` / `⌥T` / `Ctrl+Shift+H` still toggle all thinking and clear thinking overrides
- `Ctrl+O` still cycles all tools (chrome → truncated → full) and clears tool/custom overrides + expanded groups
- Finished Thought: collapsed ↔ full; live thinking is not clickable
- Read: chrome ↔ truncated; other collapsible tools/custom: chrome ↔ full
- `edit` / `write` stay native expanded (no title-only, no click target)
- Group membership = consecutive `isCollapsibleTool` siblings (spacers ignored) while global tool mode is chrome; independent of local member overrides
- Session-scoped state only; reset on `session_start` / `session_shutdown`
- Fail-soft: missing patch methods → `clickFoldReady = false`, no custom links, keep hints
- Do not wrap `createInteractiveTui` or `openBrowser`

---

### Task 1: Pure click-fold core + tests

**Files:**
- Create: `extensions/click-fold-core.ts`
- Create: `click-fold-core.test.mjs`
- Modify: `package.json` (add `click-fold-core.test.mjs` to `scripts.test`)
- Modify: `docs/superpowers/specs/2026-08-25-pi-grok-tui-click-to-expand-design.md` (double-click note)

**Interfaces:**
- Consumes: `THINKING_EXPAND_HINT` from `extensions/thinking-keys.ts`; `ToolViewMode` from `extensions/state.ts`; `isCollapsibleTool` from `extensions/tool-titles.ts`
- Produces:
  - `FOLD_SCHEME = "pi-grok-tui:"`
  - `foldUrl(id: string): string` → `pi-grok-tui://v1/fold/<id>`
  - `parseFoldId(url: string): string | undefined`
  - `isGrokFoldScheme(url: string): boolean` — true iff scheme is `pi-grok-tui:`
  - `chromeHint(kind: "thinking" | "tool", opts: { tuiMode: "fullscreen" | "regular"; clickFoldReady: boolean }): string | undefined`
  - `isThinkingExpanded(timestamp: number, globalExpanded: boolean, overrides: Map<number, boolean>): boolean`
  - `nextThinkingExpanded(currentlyExpanded: boolean): boolean`
  - `nextToolFoldMode(toolName: string, current: ToolViewMode): ToolViewMode`
  - `type GroupSibling = { kind: "tool"; toolName: string } | { kind: "gap" } | { kind: "other" }`
  - `groupRunRange(siblings: GroupSibling[], index: number, groupable: boolean): { start: number; end: number } | undefined` — range of consecutive groupable tools around `index`, crossing `gap`, stopping at `other` or non-groupable tool. `groupable` is global (chrome mode). Membership uses `isCollapsibleTool(toolName)` only.

- [ ] **Step 1: Write the failing tests**

`click-fold-core.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  foldUrl,
  parseFoldId,
  isGrokFoldScheme,
  chromeHint,
  isThinkingExpanded,
  nextThinkingExpanded,
  nextToolFoldMode,
  groupRunRange,
} from "./extensions/click-fold-core.ts";

describe("fold URI", () => {
  it("builds and parses v1 fold ids", () => {
    assert.equal(foldUrl("abc"), "pi-grok-tui://v1/fold/abc");
    assert.equal(parseFoldId("pi-grok-tui://v1/fold/abc"), "abc");
  });

  it("claims every pi-grok-tui URL and no other scheme", () => {
    assert.equal(isGrokFoldScheme("pi-grok-tui://v1/fold/abc"), true);
    assert.equal(isGrokFoldScheme("pi-grok-tui://v1/nope"), true);
    assert.equal(isGrokFoldScheme("pi-grok-tui://"), true);
    assert.equal(isGrokFoldScheme("https://example.com"), false);
    assert.equal(isGrokFoldScheme("file:///tmp/x"), false);
    assert.equal(parseFoldId("https://example.com"), undefined);
    assert.equal(parseFoldId("pi-grok-tui://v1/fold/"), undefined);
    assert.equal(parseFoldId("pi-grok-tui://v1/nope"), undefined);
  });
});

describe("chromeHint", () => {
  it("hides hints only in fullscreen when click-fold is ready", () => {
    assert.equal(
      chromeHint("thinking", { tuiMode: "fullscreen", clickFoldReady: true }),
      undefined,
    );
    assert.equal(
      chromeHint("tool", { tuiMode: "fullscreen", clickFoldReady: true }),
      undefined,
    );
  });

  it("keeps keyboard hints in regular mode and when the patch is not ready", () => {
    const thinking = chromeHint("thinking", {
      tuiMode: "regular",
      clickFoldReady: true,
    });
    assert.ok(thinking === " (⌥T)" || thinking === " (Alt+T)");
    assert.equal(
      chromeHint("tool", { tuiMode: "regular", clickFoldReady: true }),
      " (Ctrl+O)",
    );
    assert.equal(
      chromeHint("tool", { tuiMode: "fullscreen", clickFoldReady: false }),
      " (Ctrl+O)",
    );
  });
});

describe("fold modes", () => {
  it("toggles thinking against the current displayed state", () => {
    const overrides = new Map([[1, true]]);
    assert.equal(isThinkingExpanded(1, false, overrides), true);
    assert.equal(isThinkingExpanded(2, false, overrides), false);
    assert.equal(isThinkingExpanded(2, true, overrides), true);
    assert.equal(nextThinkingExpanded(false), true);
    assert.equal(nextThinkingExpanded(true), false);
  });

  it("maps read to truncated and other tools to full", () => {
    assert.equal(nextToolFoldMode("read", "chrome"), "truncated");
    assert.equal(nextToolFoldMode("read", "truncated"), "chrome");
    assert.equal(nextToolFoldMode("read", "full"), "chrome");
    assert.equal(nextToolFoldMode("bash", "chrome"), "full");
    assert.equal(nextToolFoldMode("bash", "truncated"), "chrome");
    assert.equal(nextToolFoldMode("bash", "full"), "chrome");
    assert.equal(nextToolFoldMode("grep", "chrome"), "full");
    assert.equal(nextToolFoldMode("edit", "chrome"), "chrome");
  });
});

describe("groupRunRange", () => {
  it("groups consecutive collapsible tools across spacers even when a member is locally expanded", () => {
    const siblings = [
      { kind: "other" },
      { kind: "tool", toolName: "read" },
      { kind: "gap" },
      { kind: "tool", toolName: "read" },
      { kind: "tool", toolName: "edit" },
    ];
    assert.deepEqual(groupRunRange(siblings, 1, true), { start: 1, end: 3 });
    assert.deepEqual(groupRunRange(siblings, 3, true), { start: 1, end: 3 });
    assert.equal(groupRunRange(siblings, 4, true), undefined);
    assert.equal(groupRunRange(siblings, 1, false), undefined);
  });
});
```

In the spec “Selection and accidental no-ops” bullet, replace the double-click claim with: Pi treats the second press as word-select (OSC 8 is not activated when a word range is taken), so a double-click on chrome typically folds once and selects a title word — not two fold toggles.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test click-fold-core.test.mjs`

Expected: FAIL (module not found / exports missing)

- [ ] **Step 3: Implement `extensions/click-fold-core.ts`**

```ts
import { THINKING_EXPAND_HINT } from "./thinking-keys.ts";
import type { ToolViewMode } from "./state.ts";
import { isCollapsibleTool } from "./tool-titles.ts";

export const FOLD_SCHEME = "pi-grok-tui:";
const FOLD_PREFIX = "pi-grok-tui://v1/fold/";

export function foldUrl(id: string): string {
  return `${FOLD_PREFIX}${id}`;
}

export function isGrokFoldScheme(url: string): boolean {
  return typeof url === "string" && url.startsWith(FOLD_SCHEME);
}

export function parseFoldId(url: string): string | undefined {
  if (!url.startsWith(FOLD_PREFIX)) return undefined;
  const id = url.slice(FOLD_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

export function chromeHint(
  kind: "thinking" | "tool",
  opts: { tuiMode: "fullscreen" | "regular"; clickFoldReady: boolean },
): string | undefined {
  if (opts.tuiMode === "fullscreen" && opts.clickFoldReady) return undefined;
  return kind === "thinking" ? THINKING_EXPAND_HINT : " (Ctrl+O)";
}

export function isThinkingExpanded(
  timestamp: number,
  globalExpanded: boolean,
  overrides: Map<number, boolean>,
): boolean {
  return overrides.has(timestamp) ? overrides.get(timestamp)! : globalExpanded;
}

export function nextThinkingExpanded(currentlyExpanded: boolean): boolean {
  return !currentlyExpanded;
}

export function nextToolFoldMode(
  toolName: string,
  current: ToolViewMode,
): ToolViewMode {
  if (!isCollapsibleTool(toolName)) return current;
  if (current === "chrome") return toolName === "read" ? "truncated" : "full";
  return "chrome";
}

export type GroupSibling =
  | { kind: "tool"; toolName: string }
  | { kind: "gap" }
  | { kind: "other" };

export function groupRunRange(
  siblings: GroupSibling[],
  index: number,
  groupable: boolean,
): { start: number; end: number } | undefined {
  if (!groupable) return undefined;
  const self = siblings[index];
  if (!self || self.kind !== "tool" || !isCollapsibleTool(self.toolName)) {
    return undefined;
  }
  const isMember = (c: GroupSibling | undefined) =>
    c?.kind === "tool" && isCollapsibleTool(c.toolName);
  let start = index;
  while (start > 0) {
    const prev = siblings[start - 1];
    if (prev?.kind === "gap") {
      start -= 1;
      continue;
    }
    if (isMember(prev)) {
      start -= 1;
      continue;
    }
    break;
  }
  let end = index;
  while (end + 1 < siblings.length) {
    const next = siblings[end + 1];
    if (next?.kind === "gap") {
      end += 1;
      continue;
    }
    if (isMember(next)) {
      end += 1;
      continue;
    }
    break;
  }
  const first = siblings.findIndex(
    (c, i) => i >= start && i <= end && isMember(c),
  );
  let last = first;
  for (let i = start; i <= end; i++) {
    if (isMember(siblings[i])) last = i;
  }
  if (first < 0 || last === first) return undefined;
  return { start: first, end: last };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test click-fold-core.test.mjs`

Expected: PASS

- [ ] **Step 5: Add the test file to `package.json` `scripts.test` and commit**

```bash
git add extensions/click-fold-core.ts click-fold-core.test.mjs package.json docs/superpowers/specs/2026-08-25-pi-grok-tui-click-to-expand-design.md
git commit -m "feat: add click-fold core helpers"
```

---

### Task 2: Session state for click-fold

**Files:**
- Modify: `extensions/state.ts`
- Create: `click-fold-state.test.mjs`
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `ToolViewMode` already in `state.ts`
- Produces: on `ThinkingScrollState`:
  - `tuiMode: "fullscreen" | "regular"`
  - `clickFoldReady: boolean`
  - `thinkingOverrides: Map<number, boolean>`
  - `viewOverrides: WeakMap<object, ToolViewMode>`
  - `expandedGroupHeaders: WeakSet<object>`
  - `resetClickFoldSession(): void` — clear thinkingOverrides; replace WeakMap/WeakSet with new empty ones. Does not change `tuiMode` / `clickFoldReady`.
  - `getViewOverride(target: object): ToolViewMode | undefined`
  - `setViewOverride(target: object, mode: ToolViewMode): void`
  - `isGroupExpanded(header: object): boolean`
  - `setGroupExpanded(header: object, expanded: boolean): void`

`getState()` must migrate missing fields on existing global state (same pattern as `toolViewMode`).

- [ ] **Step 1: Write failing tests** that import `getState`, `resetClickFoldSession`, override helpers; assert defaults; set a thinking override + fake object override; reset; thinking map empty and new object has no override.

- [ ] **Step 2: Run** `node --experimental-strip-types --test click-fold-state.test.mjs` — FAIL on missing exports.

- [ ] **Step 3: Implement state fields + `ensureClickFoldState(state)` used by `getState()` + helpers.**

- [ ] **Step 4: Tests PASS.**

- [ ] **Step 5: Commit** `feat: track click-fold session overrides`

---

### Task 3: Registry + runtime TUI patches

**Files:**
- Create: `extensions/click-fold.ts`
- Create: `click-fold.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `foldUrl`, `parseFoldId`, `isGrokFoldScheme`, `chromeHint` from `click-fold-core.ts`; `getState` from `state.ts`; `hyperlink`, `truncateToWidth`, `TuiAltScreen`, `TuiMainScreen` from `@earendil-works/pi-tui`; `formatChromeLine`, `ChromeKind`, `ChromeTheme` from `chrome.ts`
- Produces:
  - `resetFoldHandlers(): void`
  - `registerFoldHandler(id: string, handler: () => void): void`
  - `dispatchGrokFoldUrl(url: string): boolean` — `isGrokFoldScheme` → true after invoking handler if `parseFoldId` hits; swallow handler throws; non-scheme → false
  - `newFoldId(): string` — monotonic `f<n>`
  - `idForTarget(target: object): string` — WeakMap stable id
  - `thinkingFoldId(timestamp: number): string` — `think-<timestamp>`
  - `renderClickableChrome(width, theme, opts: { kind: ChromeKind; label: string; failedSuffix?: string; hintKind: "thinking" | "tool"; id?: string; onClick?: () => void }): string` — format → truncate(`width`, ellipsis `""`) → if fullscreen+ready+id+onClick: register + `hyperlink(...)`; on wrap throw, return truncated unwrapped
  - `installClickFoldPatch(): () => void` — patch `doRender` on both TUIs to set `tuiMode` then call through; patch `TuiAltScreen.prototype.handleSelectionMouseEvent` via `any` wrapping `this.openUrl`; if a required method is missing, `clickFoldReady = false` and return a no-op cleanup. Success sets `clickFoldReady = true`. Cleanup restores prototypes and sets `clickFoldReady = false`.

- [ ] **Step 1: Failing tests** for `dispatchGrokFoldUrl` (our URL consumed + handler called; https not claimed; stale/malformed `pi-grok-tui:` consumed and not thrown; handler throw still returns true). Do **not** instantiate a real TUI in unit tests.

- [ ] **Step 2: Run tests — FAIL.**

- [ ] **Step 3: Implement registry + `renderClickableChrome` + `installClickFoldPatch`.** `handleSelectionMouseEvent` wrap:

```ts
const proto = TuiAltScreen.prototype as any;
const original = proto.handleSelectionMouseEvent;
if (typeof original !== "function") { /* fail-soft */ }
proto.handleSelectionMouseEvent = function (event: unknown) {
  const self = this as { openUrl?: (url: string) => void };
  const previous = self.openUrl;
  self.openUrl = (url: string) => {
    if (dispatchGrokFoldUrl(url)) return;
    previous?.(url);
  };
  try {
    return original.call(this, event);
  } finally {
    self.openUrl = previous;
  }
};
```

`doRender` patches:

```ts
const wrapDoRender = (Ctor: { prototype: { doRender?: () => void } }, mode: "fullscreen" | "regular") => {
  const original = Ctor.prototype.doRender;
  if (typeof original !== "function") return false;
  Ctor.prototype.doRender = function () {
    getState().tuiMode = mode;
    return original.call(this);
  };
  return true;
};
```

Both must succeed plus `handleSelectionMouseEvent` present → `clickFoldReady = true`.

- [ ] **Step 4: Tests PASS.** Smoke: `installClickFoldPatch()` against real `TuiAltScreen.prototype` (method exists on this pi) then cleanup.

- [ ] **Step 5: Commit** `feat: intercept fullscreen chrome clicks`

---

### Task 4: Thinking chrome click + Alt+T reset

**Files:**
- Modify: `extensions/thinking-render.ts`
- Modify: `extensions/grok-tui.ts` (`toggleThinkingExpand` clears `thinkingOverrides`; `session_start`/`session_shutdown` call `resetClickFoldSession` + `resetFoldHandlers`)

**Interfaces:**
- Consumes: `isThinkingExpanded`, `nextThinkingExpanded`; `renderClickableChrome`, `thinkingFoldId`, `registerFoldHandler`; `getState().thinkingOverrides`
- Produces: finished/expanded Thought header is clickable in fullscreen; live header is not. Cache key includes per-timestamp expanded state.

Thinking click handler:

```ts
const state = getState();
const current = isThinkingExpanded(ts, state.globalExpanded, state.thinkingOverrides);
state.thinkingOverrides.set(ts, nextThinkingExpanded(current));
```

`toggleThinkingExpand`: flip `globalExpanded`; `thinkingOverrides.clear()`; existing notify.

- [ ] **Step 1: Extend `click-fold-core.test.mjs` or add a tiny thinking-expand unit** if needed (already covered). For render, add a test that `isThinkingExpanded` + cache-bust fields are the API thinking-render will use — already in Task 1.

- [ ] **Step 2: Implement thinking-render:** `const isExpanded = isThinkingExpanded(...)`. `buildFinishedTitle` / `buildExpanded` header use `renderClickableChrome` with `thinkingFoldId(ts)` and the toggle handler. `buildActive` stays unwrapped. Invalidate cache when override changes: include `isExpanded` (already cached as `cachedExpanded`).

- [ ] **Step 3: Wire reset in grok-tui session + Alt+T.** Install click-fold patch inside `installPatch()` (Task 6 also wires; do the thinking reset now, install in Task 6 if patch file exists — it does after Task 3).

- [ ] **Step 4: `npm test` PASS.**

- [ ] **Step 5: Commit** `feat: click Thought chrome to fold one block`

---

### Task 5: Tool grouping, per-row fold, custom messages, Ctrl+O reset

**Files:**
- Modify: `extensions/tool-collapse.ts`
- Modify: `extensions/custom-message-collapse.ts`
- Modify: `extensions/tool-view-cycle.ts`
- Create: `click-fold-groups.test.mjs` if grouping helper needs extra cases using `groupRunRange` + `nextToolFoldMode`

**Interfaces:**
- Consumes: `groupRunRange`, `nextToolFoldMode`, `getViewOverride`/`setViewOverride`, `isGroupExpanded`/`setGroupExpanded`, `idForTarget`, `newFoldId` (group header uses `idForTarget(header) + ":g"` or a dedicated `groupFoldId(header)` stored on register), `renderClickableChrome`
- Produces: chrome/group/member click behavior from the spec

Tool effective mode:

```ts
function effectiveToolMode(t: object, toolName: string): ToolViewMode {
  if (!isCollapsibleTool(toolName)) return "full";
  return getViewOverride(t) ?? getToolViewMode();
}
```

Replace `isTitleOnlyCandidate` display check with `effectiveToolMode(t, t.toolName) === "chrome" && isCollapsibleTool(t.toolName)`.

Grouping: map siblings to `GroupSibling` (`tool` / spacer=`gap` / else `other`); `groupRunRange(..., getToolViewMode() === "chrome")`. Header = first collapsible member in range. Group expanded iff `isGroupExpanded(headerMember)`.

Collapsed group (2+ members, not expanded): header paints one group chrome line (click toggles `setGroupExpanded(header, true)` — does **not** change member overrides). Non-headers `hideComponent = true`.

Expanded group: header paints synthetic group chrome (`◇` / `group` kind, click `setGroupExpanded(header, false)`) **plus** its own row from `effectiveToolMode`. Other members unhide and paint their own effective mode.

Own-row click: `setViewOverride(t, nextToolFoldMode(t.toolName, effectiveToolMode(t, t.toolName)))` then `t.updateDisplay()`.

When painting chrome (title-only) use `renderClickableChrome` instead of `formatChromeLine` + raw Text. For renderer-definition path, add a tiny component `{ render: (w) => [renderClickableChrome(w, ...)], invalidate() {} }` instead of `new Text(line)`.

Custom messages: chrome iff `getViewOverride(this) ?? (getToolViewMode() === "chrome" ? "chrome" : "full")` is chrome. Click sets override via `nextToolFoldMode("custom", current)` — treat custom like non-read (`chrome` ↔ `full`). Need `nextToolFoldMode` to accept non-read names; `"custom"` is collapsible (not edit/write). Pass `"custom"` or the customType.

`installToolViewCyclePatch` `toggleToolOutputExpansion` / `setToolsExpanded`: after cycling, `resetClickFoldSession()` is too broad (clears thinking too). Add `clearToolFoldOverrides()` in `state.ts`: replace `viewOverrides` and `expandedGroupHeaders` only.

- [ ] **Step 1: Tests** for `nextToolFoldMode("custom", "chrome") === "full"`; group range with local-override irrelevance (already Task 1). Add `clearToolFoldOverrides` test in `click-fold-state.test.mjs`.

- [ ] **Step 2: FAIL then implement state helper + tool-collapse/custom/cycle.**

- [ ] **Step 3: `npm test` PASS.**

- [ ] **Step 4: Commit** `feat: click tool and group chrome to fold locally`

---

### Task 6: Install patch, README, full test run

**Files:**
- Modify: `extensions/grok-tui.ts` (`installPatch` calls `installClickFoldPatch`; cleanup; session reset)
- Modify: `README.md`
- Modify: `package.json` if any test file missing from script

**README changes:**
- Thinking: fullscreen click the `◆ Thought` row to fold that block; regular still shows `(⌥T)` / `(Alt+T)`
- Tools: fullscreen click chrome / group header; `Ctrl+O` still global cycle
- Usage table: add a row for fullscreen click

- [ ] **Step 1: Wire `installClickFoldPatch` in `installPatch()` before thinking/tools so `clickFoldReady` is set before first paint. On failure, warn and continue (`clickFoldReady` already false).**

- [ ] **Step 2: `session_start`:** `resetClickFoldSession(); resetFoldHandlers();` then existing work. Same on shutdown before releasing patches.

- [ ] **Step 3: Update README.**

- [ ] **Step 4: Run `npm test` and `git diff --check`.**

- [ ] **Step 5: Commit** `feat: enable fullscreen click-to-expand`

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| URI consume/delegate | 1, 3 |
| Hint policy + fail-soft | 1, 3 |
| Thinking per-row + Alt+T reset | 4 |
| Tool matrix including Read truncated | 1, 5 |
| Groups independent of local mode | 1, 5 |
| Custom messages | 5 |
| Ctrl+O clears tool overrides + groups | 5 |
| Regular never emits OSC 8 | 3, 4, 5 (`renderClickableChrome`) |
| `edit`/`write` unchanged | 1 (`nextToolFoldMode` no-op), 5 (not groupable as header-only) |
| Double-click doc correction | 1 |
| README | 6 |

Manual fullscreen checklist in the spec is residual risk after unit tests (no PTY harness in this repo).
