# Design: Compact thinking title + collapsed tool titles

**Date:** 2026-07-24  
**Repo:** `pi-thinking-scroll`  
**Status:** Approved for planning  

## Goal

Make pi’s TUI denser after reasoning and tool work finish, while keeping expansion explicit:

1. **Thinking:** while streaming, show at most 3 lines; when finished, collapse to a single title row with an expand hint.
2. **Tools:** while running, keep live output; when finished, **most** tools collapse to a Grok-style title row (expand via `Ctrl+O`). **File mutation tools (`edit` / `write`) stay expanded by default**, matching Grok Build’s Edit policy.

Display-only. Do not change session files, model requests/responses, context construction, or tool execution.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Thinking title source | Static `已思考` — no LLM / `session_summary` (that is session-level, not per-thinking) |
| Thinking live height | Max **3** lines while active |
| Thinking finished | Always fully collapsed (no “≤3 lines stay open” special case) |
| Thinking expand key | **`Alt+T`** only toggles thinking expand/collapse |
| Tool expand key | Keep pi native **`Ctrl+O`** (`app.tools.expand`) |
| Tool while running | Full live output (native render) |
| Tool when finished (collapsible) | Title-only row + muted `(Ctrl+O)` when not expanded |
| File mutations (`edit` / `write`) | **Always use native expanded render** after finish (default open diffs/content). Do **not** force title-only. Aligns with Grok: `collapsed_edit_blocks` defaults **off** → Edit starts expanded. |
| Title language | Mixed: thinking Chinese; tool titles English (Grok-style) |
| Implementation style | Monkey-patch pi internal TUI components (same approach as today) |

## Non-goals

- Summarizing thinking with an LLM or reusing session title generation.
- Unifying `Alt+T` and `Ctrl+O` into one global chrome toggle.
- Forking `pi-mono` / changing pi core as the primary approach.
- Changing tool schemas (e.g. adding bash `description` fields).
- Persisting expand/collapse state across sessions.

## Current baseline

### This plugin (`thinking-scroll.ts`)

- Monkey-patches `AssistantMessageComponent.prototype.updateContent`.
- Live thinking: up to **5** lines + spinner.
- Finished: ≤3 lines stay inline; longer → 3-line markdown preview.
- `Alt+T` toggles `globalExpanded` for thinking only.

### pi native tools

- `ToolExecutionComponent` with `expanded` flag; default `toolOutputExpanded = false`.
- `Ctrl+O` → `setToolsExpanded` walks chat children and calls `setExpanded`.
- Collapsed still shows `renderCall` and a **truncated** result (not title-only).
- Built-ins: `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls` (plus MCP/custom).

### Grok Build reference

**Title templates:** ACP titles from parsed args in `send_tool_call_start` (rule templates, not LLM). Bash may also show model `description` as chrome; pi bash has **no** `description` field — titles come from args only.

**Default fold policy (display modes):**

| Block | Default | Notes |
|-------|---------|--------|
| Edit | **Expanded** | Flag `collapsed_edit_blocks` defaults **false** → `effective_expanded = true`. Optional one-liner `+N/-M` when flag is on. Failed edits force Collapsed. |
| Read / Search / List / WebSearch / Execute (agent) | **Collapsed** | Title / summary chrome |
| Thinking | Truncated while live → **Collapsed** when finished | |
| User `!` bash | Truncated live → **Expanded** when finished | Interactive terminal feel |

This plugin mirrors that split: collapse non-mutation tools; leave `edit`/`write` expanded.

## UX specification

### Thinking

| State | Render |
|-------|--------|
| Active (`thinking_start` / `thinking_delta`) | Spinner header + last ≤3 markdown-rendered lines |
| Finished, collapsed (default) | One line: `│ 已思考 (Alt+T)` (thinking/dim styling) |
| Finished, expanded (`Alt+T`) | Full thinking markdown (same as today’s expanded path) |
| Short thinking after finish | Still collapsed to the title line (no exception) |

Notify on toggle (existing): “All thinking expanded” / “All thinking collapsed”.

### Tools

**Collapsible tools** = all built-ins and MCP **except** `edit` and `write`.

| State | Collapsible tools | `edit` / `write` |
|-------|-------------------|------------------|
| In progress | Native call + streaming result | Native (unchanged) |
| Finished + not expanded | One line: `{GrokStyleTitle} (Ctrl+O)` | **Native full render** (diff/content); ignore title-only path |
| Finished + expanded (`Ctrl+O`) | Native call + full result | Native full render (same) |
| Error | Title may show muted `✗`; body on expand | Native error/diff path (stay expanded unless pi itself collapses) |

Hint on collapsed **collapsible** rows: muted `(Ctrl+O)` (not Alt+T).

`Ctrl+O` continues to set `expanded` on all `ToolExecutionComponent`s (pi native). For `edit`/`write`, our patch **does not switch to title-only** when `expanded === false`; they always take the native render path so diffs stay visible by default even though pi’s global flag starts false.

### Tool title rules (English, Grok-aligned)

Used only when a **collapsible** tool is finished and collapsed.

| pi tool | Collapsed title | Title-only after finish? |
|---------|-----------------|--------------------------|
| `read` | `Read \`{path}\`` | Yes |
| `bash` | `Execute \`{command}\`` — peel redundant `cd <cwd>`; truncate for width | Yes |
| `grep` | Prefer bare `pattern`, or `Search \`{pattern}\`` | Yes |
| `find` | `Find \`{pattern}\`` | Yes |
| `ls` | `List \`{path}\`` (default `.`) | Yes |
| `edit` | `Edit \`{path}\`` (for completeness / future) | **No — always native expanded** |
| `write` | `Write \`{path}\`` (for completeness / future) | **No — always native expanded** |
| Other / MCP | Title-case or raw name; optional path/query/url preview | Yes |

Missing args: fall back to tool name only (never blank row).

## Architecture

### Approach

Extend the existing extension with additional display patches. Keep one entrypoint for session lifecycle and shortcuts.

### Suggested layout

```
extensions/
  thinking-scroll.ts    # entry: shortcuts, events, retain/release patches
  thinking-render.ts    # ThinkingScrollComponent + collapsed title row
  tool-collapse.ts      # patch ToolExecutionComponent display path
  tool-titles.ts        # pure functions: name + args + cwd → title string
```

Optional later: rename package description to “compact thinking + collapsed tool titles”; keep install path/name unless we explicitly rebrand.

### Patch surfaces

1. **Thinking (existing, tightened)**  
   - Continue patching `AssistantMessageComponent.updateContent`.  
   - `MAX_VISIBLE_LINES = 3`.  
   - Collapsed finished path: only title row, no 3-line preview.  
   - Force-hide native hide-thinking label path still overridden so our chrome wins.

2. **Tools (new)**  
   - Patch `ToolExecutionComponent` methods used after result settles, e.g. `updateDisplay` and/or `setExpanded` / `updateResult`.  
   - Title-only when: `!isPartial && result && !expanded && isCollapsibleTool(toolName)` where `isCollapsibleTool` is false for `edit` and `write` (case-sensitive pi built-in names).  
   - `edit` / `write`: always call through to original behavior (native expanded chrome).  
   - When `expanded` or still partial, call through for all tools.  
   - Read `toolName`, `args`, `cwd`, `result.isError` from the instance.

3. **No change to pi keybindings registry**  
   - `Alt+T` stays extension-registered.  
   - `Ctrl+O` stays pi `app.tools.expand`.

### State

| State | Scope | Default |
|-------|--------|---------|
| `globalExpanded` (thinking) | Extension global | `false` |
| `activeByTimestamp` | Extension global | empty |
| Tool `expanded` | Per `ToolExecutionComponent` / session `toolOutputExpanded` | pi default `false` |

Thinking and tools do **not** share one expand flag.

### Failure modes

- If internal module path / prototype shape changes: degrade gracefully (warn once, leave native render).  
- Tool patch errors on a single update: fall back to original `updateDisplay` for that call.  
- Unknown tools: treat as collapsible; generic name title when finished and collapsed.  
- `edit`/`write` never enter title-only path even if `expanded === false`.

## Testing

Prefer pure unit tests for titles (no TUI):

- `tool-titles.ts`: matrix for read/bash/grep/find/ls/MCP-ish names; path/command edge cases; empty args; long bash truncation; optional cd peel.  
- `isCollapsibleTool`: true for read/bash/…; false for edit/write.  
- Thinking collapsed/active line budgets: if practical without full pi, small pure helpers; otherwise manual checklist.

Manual checklist:

1. Reasoning model: live thinking ≤3 lines; end → `已思考 (Alt+T)` only.  
2. `Alt+T` expands/collapses all thinking; tools unaffected.  
3. Bash run: streaming output visible; on complete → `Execute \`…\` (Ctrl+O)`.  
4. `Ctrl+O` expands collapsible tool bodies; thinking stays collapsed unless `Alt+T`.  
5. Read/grep/find/ls titles match rules when collapsed.  
6. **Edit/write after finish show full native diff/content by default** (not title-only), even when global tool expand is off.  
7. Failed collapsible tool: one-line title with error mark; expand shows error.  
8. Session reload/quit: patches released cleanly (existing lifecycle).

## Implementation notes

- Prefer extracting pure title builders + `isCollapsibleTool()` so Grok parity can be adjusted without touching patch code.  
- Truncate titles with existing pi-tui width helpers (`truncateToWidth` / `visibleWidth`) so one-line chrome never wraps aggressively.  
- Do not invent bash `description` from the model; pi schema has no such field.  
- Keep monkey-patch refcounting pattern (`retainPatch` / session_start / session_shutdown) for both thinking and tool patches.  
- Optional: if pi renames built-ins, keep a single allow/deny list next to titles.

## Open follow-ups (out of scope unless requested)

- Package rename / marketplace blurb update.  
- Optional first-line heuristic title for thinking (still non-LLM).  
- Matching Grok “Run {description}” for bash if pi ever adds a description arg.  
- Optional Grok-style `collapsed_edit_blocks` for edit/write one-liner `+N/-M` (default remains expanded).
