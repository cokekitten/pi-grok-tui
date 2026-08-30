# Design: Fullscreen click-to-expand for thinking and tool chrome

**Date:** 2026-08-25  
**Repo:** `pi-grok-tui`  
**Status:** Approved for planning  
**Depends on:** [2026-07-24 thinking/tool collapse](2026-07-24-pi-thinking-tool-collapse-design.md)

## Goal

In pi **fullscreen** TUI, let the user expand and collapse grok-tui chrome by clicking the title row, matching Grok Build’s *per-block fold semantics* while using a *single click on chrome* (not Grok’s double-click on the whole block).

Display-only. Keyboard shortcuts stay. Regular TUI mode is unchanged except that it keeps the existing `(⌥T)` / `(Ctrl+O)` hints.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Gesture | **Single click** on the chrome title row (`◆` / `◇` line). Not the body. |
| Why not Grok’s double-click | Pi fullscreen already uses double-click for word selection and has no “single-click selects the block” layer. |
| Scope | **Point-at-what-you-open**: one thinking block, one tool, one custom-message row, or one verb group. |
| Grok fold mapping (finished) | Thought: collapsed ↔ full. Read: chrome ↔ truncated. Other collapsible tools + custom messages: chrome ↔ full. `write`: native 10-line preview ↔ full (never title-only). `edit`: always full, not clickable. |
| Verb groups | Click collapsed group header → split into per-member chrome rows (bodies still collapsed). Click expanded group header → fold the group. Click a member row → fold that member only. |
| Hints | Fullscreen: **no** trailing `(⌥T)` / `(Ctrl+O)` on chrome. Regular: keep them. |
| Regular mode | No custom OSC 8. No mouse fold. Keyboard only. |
| Keyboard | `Alt+T` / `⌥T` / `Ctrl+Shift+H` still toggle **all** thinking. `Ctrl+O` still cycles **all** tools (chrome → truncated → full). |
| Override reset | `Alt+T` clears thinking overrides. `Ctrl+O` clears tool/custom overrides **and** expanded-group state. |
| Click vs drag | Dragging chrome still selects text (pi already suppresses OSC 8 activation after motion). |
| Persistence | Session-scoped only. No session-file / cross-session memory. |
| Active thinking | Live 3-line thinking is **not** clickable. |

## Non-goals

- Regular-mode mouse fold or hover.
- Double-click parity with Grok (including triple-click scroll-to-top).
- Changing `Alt+T` / `Ctrl+O` themselves into per-row actions.
- Patching pi core / forking `pi-mono`.
- Persisting fold state across sessions.
- Making `edit` / `write` title-only.
- Clicking assistant prose / user bubbles / footer / editor.

## Current baseline

- Thinking: `ThinkingScrollComponent` renders a finished title `◆ Thought (⌥T)` and an expanded header with the same hint. `state.globalExpanded` is process-global.
- Tools: `tool-collapse.ts` title-only when `getToolViewMode() === "chrome"` and `isCollapsibleTool`. Consecutive title-only tools merge; non-header members set `hideComponent = true`.
- Tool cycle: `Ctrl+O` → `cycleToolViewMode()` then `applyToolViewMode` on every tool/custom component.
- Custom messages: chrome line with `(Ctrl+O)` when mode is chrome.
- Pi 0.84 fullscreen (`TuiAltScreen`) captures SGR mouse, handles wheel/scrollbar/selection, and on an unmoved primary click calls `openUrl(getOsc8LinkAtColumn(...))` with `openBrowser`.
- Pi `Component` has no `handleClick`. Fullscreen `handleViewportInput` **consumes** all mouse sequences before extension `onTerminalInput` listeners.
- Regular (`TuiMainScreen`) does not capture mouse.

## UX specification

### When a chrome row is clickable

Only if **all** of:

1. Interactive TUI is currently **fullscreen** (`TuiAltScreen` is painting).
2. The row is grok-tui chrome (thinking title, tool title, custom-message title, or group header).
3. For thinking: the block is **finished** (not in `activeByTimestamp`).

Otherwise the row is ordinary text.

### Thinking

| State | Click | Result |
|-------|-------|--------|
| Live (`Thinking...` + ≤3 lines) | none | No OSC 8. |
| Finished, collapsed | chrome | Expand **this** message’s thinking to full markdown. |
| Finished, expanded | header chrome | Collapse **this** message’s thinking to one line. |

`Alt+T` (and Option+T / Ctrl+Shift+H): toggle `globalExpanded`, **clear all thinking overrides**. Rows with no override follow the global flag.

### Tools (collapsible)

Effective mode for a tool instance:

1. If it has a local override → use that.
2. Else follow global `toolViewMode` (`chrome` / `truncated` / `full`).

Click uses the **currently displayed** mode, not the global flag:

| Displayed now | Read | Other collapsible (`bash`, `grep`, `find`, `ls`, MCP, …) |
|---------------|------|----------------------------------------------------------|
| chrome (one line) | truncated | full |
| truncated | chrome | chrome |
| full | chrome | chrome |

`write`: no grok title-only chrome. Default (and global compact) is native 10-line preview (`truncated`). Click **anywhere in the write block** (fullscreen) → full; click again → preview. `edit`: no click target; native full diff unchanged.

Running collapsible tools that are already title-only **are** clickable (peek output). Failure chrome is clickable the same way.

### Verb groups

A **group run** is two or more consecutive collapsible tool components, ignoring spacers. Group membership is computed from tool identity (`isCollapsibleTool`), **not** from local expand overrides. A locally expanded member does not split the run.

| Chrome | Click | Result |
|--------|-------|--------|
| Collapsed group (`◇ Read 2 files`) | that one line | Expand the group: synthetic group header + each member as its own row. Member bodies stay chrome unless that member already has a local override (preserved, now visible). |
| Expanded group header | header line | Collapse the group back to one header. Member overrides are **kept** but hidden until the group is expanded again or `Ctrl+O` resets. |
| Expanded member row | that member’s chrome | Fold only that member (Read ↔ truncated, others ↔ full). Group stays expanded. |

A lone collapsible tool is not a group: click folds the tool itself.

`Ctrl+O` clears expanded-group ids as well as per-tool overrides, so the transcript returns to global density (default chrome grouping).

### Custom messages

Same as “other collapsible tools”: chrome ↔ full. Fullscreen chrome is clickable; hint hidden in fullscreen.

### Hints

| Mode | Chrome suffix |
|------|----------------|
| Fullscreen | omitted (`◆ Thought`, `◆ Read \`foo.ts\``, `◇ Read 2 files`) |
| Regular | current: ` (⌥T)` / ` (Alt+T)` / ` (Ctrl+O)` |

`/settings` TUI mode switches take effect on the next paint. Footer toasts from keyboard toggles may still mention shortcuts; those are not chrome.

### Selection and accidental no-ops

- Drag on a chrome row: text selection + clipboard copy; **no** fold (pi requires an unmoved press/release to fire `openUrl`).
- Double-click chrome: pi’s second press becomes word-select (OSC 8 is not activated once a word range is taken), so the typical result is **one** fold toggle plus a selected title word — not two fold toggles. Word-select the **body**, not the title.
- Clicking empty gutter / assistant prose / user bubble: unchanged (selection only).

## Architecture

### Approach

Stay an extension. Monkey-patch pi-tui internals already imported by grok-tui. Do not wrap `createInteractiveTui` (it is a bundle-local closure; the InteractiveMode constructor call cannot be intercepted from the package export). Do not wrap `openBrowser`.

### Suggested files

```
extensions/
  click-fold.ts      # URI, registry, TuiAltScreen/TuiMainScreen patches
  state.ts           # tuiMode, thinkingOverrides, toolOverrides, expandedGroups
  chrome.ts          # hint omitted when clickable
  thinking-render.ts # wrap finished/expanded header; register think-<ts>
  thinking-patch.ts  # pass timestamp (already does)
  tool-collapse.ts   # wrap chrome; group expand; per-instance mode
  custom-message-collapse.ts
  grok-tui.ts        # install/release click-fold patch; reset registry on session
```

Tests (pure, no TUI): URI parse/reject, next-fold-mode matrix, hint policy, group-run independence from local overrides.

### Seam 1 — consume only our links

Patch `TuiAltScreen.prototype.handleSelectionMouseEvent`.

Around the original call, temporarily replace `this.openUrl`:

```ts
const previous = this.openUrl;
this.openUrl = (url: string) => {
  if (dispatchGrokFoldUrl(url)) return;
  previous?.(url);
};
try {
  originalHandleSelectionMouseEvent.call(this, event);
} finally {
  this.openUrl = previous;
}
```

- Consume any URL whose scheme is `pi-grok-tui:` (valid fold, stale id, or malformed path). Never pass those to `openBrowser`.
- Every other scheme (https, file, …) goes to the previous handler (`openBrowser`).
- If dispatch throws, swallow; still do not open a browser for `pi-grok-tui:` URLs.

Do not patch `createInteractiveTui`. Do not patch `openBrowser`.

### Seam 2 — know which TUI is painting

Patch `TuiAltScreen.prototype.doRender` and `TuiMainScreen.prototype.doRender`:

- Alt-screen: set `state.tuiMode = "fullscreen"` then call through.
- Main-screen: set `state.tuiMode = "regular"` then call through.

Chrome render reads `state.tuiMode` for that paint. Custom OSC 8 and hidden hints are **fullscreen-only**. Regular paint emits no custom link.

### Seam 3 — click-target registry

Central registry in `click-fold.ts`:

| Piece | Role |
|-------|------|
| Opaque id | `v1` path segment, unguessable enough (monotonic counter or random). |
| `WeakMap<object, id>` | Stable id for a live `ToolExecution` / `CustomMessage` instance. |
| Session map `id → handler` | What a click does. |
| Thinking | No WeakMap. Id derived from message timestamp (`think-<timestamp>`). Component rebuilds; timestamp does not. |

`session_start` / `session_shutdown`: clear the handler map, thinking overrides, tool/custom overrides, expanded-group set. WeakMap entries vanish with GC.

Handlers are registered during render (idempotent replace). Stale ids after reset no-op.

### URI

```
pi-grok-tui://v1/fold/<id>
```

`dispatchGrokFoldUrl(url)`:

- Scheme is not `pi-grok-tui:` → return `false` (caller forwards to `openBrowser`).
- Scheme is `pi-grok-tui:` → return `true` after handling or no-op. **Never** forward to `openBrowser`, including stale ids and malformed paths.
- Never emit this URI in regular mode.

If the mouse-intercept patch fails to install, **do not emit** custom links (even in fullscreen) and **keep keyboard hints**. Fail-soft: keyboard still works; no `open pi-grok-tui://` accidents.

### OSC 8 wrapping

1. Build styled chrome (`formatChromeLine`).
2. Truncate to width (`truncateToWidth`).
3. **Then** wrap the whole visible string with `hyperlink(text, uri)`.

Do not wrap the body. Do not truncate after wrapping (pi `truncateToWidth` is ANSI-aware but OSC 8 must stay intact).

Pi documents that each rendered line is closed with OSC 8 reset; wrapping a single line is enough.

### Per-row state

| Kind | Key | Default (no override) |
|------|-----|------------------------|
| Thinking | message `timestamp` | `state.globalExpanded` |
| Tool | component instance (WeakMap) | `state.toolViewMode` mapped onto that tool (`edit` ignored / always full; `write` maps global `chrome` → `truncated`) |
| Custom message | component instance | chrome iff `toolViewMode === "chrome"` |
| Group expanded | group id (first member’s instance id, or ordered member-id tuple) | collapsed |

**Thinking click:** set `thinkingOverrides.set(ts, !currentlyExpanded)`.

**Tool/custom click:** set override to the next mode in the matrix above.

**Alt+T:** `globalExpanded = !globalExpanded`; `thinkingOverrides.clear()`.

**Ctrl+O:** existing `cycleToolViewMode` + `applyToolViewMode`; also `toolOverrides.clear()`, custom overrides clear, `expandedGroups.clear()`.

### Group rendering

Today: header member paints the group line; other members `hideComponent = true`.

Keep that for a **collapsed** group.

**Expanded** group:

1. Header member paints a **synthetic** clickable group header line (`◇ Read 2 files`, no hint in fullscreen), then its own row (chrome or local override).
2. Other members unhide and paint themselves.
3. Group header click target is distinct from member 0’s fold target.

Collapsed-group click expands the group; it does **not** fold member 0’s body.

### Failure modes

| Failure | Behavior |
|---------|----------|
| `handleSelectionMouseEvent` missing / patch throws | No custom links, hints stay, keyboard works. |
| `doRender` patch missing | Treat as regular: no custom links, hints stay. |
| Unknown / stale fold id | No-op. |
| OSC 8 wrap error | Paint unwrapped chrome (still readable). |
| Group computation error | Fall back to per-tool chrome (today’s single-member path). |

## Testing

Pure unit tests (node:test, no pi TUI):

- URI accept `pi-grok-tui://v1/fold/abc`; reject `https://…`, `file://…`, empty id, wrong path.
- Next-mode: thought collapsed↔full; read chrome↔truncated↔chrome (full also → chrome); bash chrome↔full; truncated bash → chrome.
- Hint: fullscreen + patch ok → `undefined`; regular → existing strings; fullscreen + patch failed → existing strings.
- Group run: two reads + spacer still one run when the second has a local `full` override.
- Dispatch: our URL consumed; foreign URL not claimed.

Manual checklist (fullscreen):

1. Finished Thought: one click expands only that block; second click on header collapses it. Other Thought rows unchanged.
2. Live thinking: click does nothing.
3. `Alt+T` expands/collapses all thinking and forgets per-row thought clicks.
4. Single bash chrome: click → full; click header → chrome.
5. Single read chrome: click → truncated preview, not full.
6. Two consecutive reads: first click splits to two chrome rows; click a member to preview that file; click group header to merge.
7. `Ctrl+O` restores global cycle and re-collapses groups.
8. Drag chrome copies text, does not fold.
9. https links in the transcript still open in the browser.
10. `/settings` → regular: hints return, custom links gone; back to fullscreen: hints gone, clicks work.
11. `write` defaults to native 10-line preview (not title-only); fullscreen click anywhere toggles preview ↔ full. `edit` stays full and is not clickable.

## Implementation notes

- `TuiAltScreen` / `TuiMainScreen` / `hyperlink` are public `@earendil-works/pi-tui` exports — same import style as `editor-dock.ts`.
- `handleSelectionMouseEvent` and `doRender` are TypeScript-private/protected; they still exist on the JS prototype and can be patched at runtime. If a future pi build inlines or drops them, take the fail-soft path (no custom links, keep hints).
- `openUrl` is an instance field assigned in the constructor (`this.openUrl = options.openUrl`). Temporary swap inside `handleSelectionMouseEvent` is enough; no need to replace the field for the object’s lifetime.
- Register click targets every chrome render so resume rebuild stays correct.
- Keep monkey-patch refcounting (`retainPatch` / session_start / session_shutdown) for the new patches.
- Do not invent hover/underline; Ghostty already documents missing native link chrome while pi captures mouse.

## Open follow-ups (out of scope)

- Per-row fold in regular mode (needs a different seam; mouse is not captured).
- Debouncing double-click on chrome so the second click does not re-collapse.
- Optional truncated step for non-Read tools on click.
- Click-to-fold `edit` (native diff has no truncated step).
