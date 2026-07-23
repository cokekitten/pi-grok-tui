# Design: Compact thinking title + collapsed tool titles

**Date:** 2026-07-24  
**Repo:** `pi-thinking-scroll`  
**Status:** Approved for planning  

## Goal

Make pi’s TUI denser after reasoning and tool work finish, while keeping expansion explicit:

1. **Thinking:** while streaming, show at most 3 lines; when finished, collapse to a single title row with an expand hint.
2. **Tools:** while running, keep live output; when finished and collapsed, show only a Grok-style rule-based title row; expand via pi’s existing tool expand binding.

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
| Tool when finished + collapsed | Title-only row + muted `(Ctrl+O)` |
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

### Grok Build reference (title templates only)

Grok builds ACP tool titles from parsed args in `send_tool_call_start` (rule templates, not LLM). Bash also has a model `description` used as UI chrome when present. Pi bash has **no** `description` field — titles come from args only.

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

| State | Render |
|-------|--------|
| In progress (`isPartial` / no final result yet) | Unchanged native call + streaming result |
| Finished + `expanded === false` | Single line: `{GrokStyleTitle} (Ctrl+O)` |
| Finished + `expanded === true` | Native call + full result (pi default expand behavior) |
| Error | Title row may include a muted error mark (e.g. `✗`); full error body only when expanded |

Hint text on the collapsed tool line: muted `(Ctrl+O)` (not Alt+T).

### Tool title rules (English, Grok-aligned)

| pi tool | Collapsed title |
|---------|-----------------|
| `read` | `Read \`{path}\`` |
| `edit` | `Edit \`{path}\`` |
| `write` | `Write \`{path}\`` |
| `bash` | `Execute \`{command}\`` — peel redundant `cd <cwd> &&` / `;` when safe; truncate long commands for one-line width |
| `grep` | Prefer bare `pattern`, or `Search \`{pattern}\`` if we need a verb for consistency |
| `find` | `Find \`{pattern}\`` |
| `ls` | `List \`{path}\`` (default `.` if missing) |
| Other / MCP | Title-case or raw tool name; optional short arg preview if cheap (path/query/url) |

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
   - Patch `ToolExecutionComponent` methods used after result settles, e.g. `updateDisplay` and/or `setExpanded` / `updateResult`, so that when `!isPartial && result && !expanded`, the container shows a single title `Text` instead of call+truncated result.  
   - When `expanded` or still partial, call through to original behavior.  
   - Read `toolName`, `args`, `cwd`, `result.isError` from the instance (same fields as current class).

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
- Unknown tools: generic name title, still title-only when collapsed finished.

## Testing

Prefer pure unit tests for titles (no TUI):

- `tool-titles.ts`: matrix for read/edit/write/bash/grep/find/ls/MCP-ish names; path/command edge cases; empty args; long bash truncation; optional cd peel.  
- Thinking collapsed/active line budgets: if practical without full pi, small pure helpers; otherwise manual checklist.

Manual checklist:

1. Reasoning model: live thinking ≤3 lines; end → `已思考 (Alt+T)` only.  
2. `Alt+T` expands/collapses all thinking; tools unaffected.  
3. Bash run: streaming output visible; on complete → `Execute \`…\` (Ctrl+O)`.  
4. `Ctrl+O` expands tool bodies; thinking stays collapsed unless `Alt+T`.  
5. Read/edit/write/grep titles match rules.  
6. Failed tool still one-line title; expand shows error.  
7. Session reload/quit: patches released cleanly (existing lifecycle).

## Implementation notes

- Prefer extracting pure title builders so Grok parity can be adjusted without touching patch code.  
- Truncate titles with existing pi-tui width helpers (`truncateToWidth` / `visibleWidth`) so one-line chrome never wraps aggressively.  
- Do not invent bash `description` from the model; pi schema has no such field.  
- Keep monkey-patch refcounting pattern (`retainPatch` / session_start / session_shutdown) for both thinking and tool patches.

## Open follow-ups (out of scope unless requested)

- Package rename / marketplace blurb update.  
- Optional first-line heuristic title for thinking (still non-LLM).  
- Matching Grok “Run {description}” for bash if pi ever adds a description arg.
