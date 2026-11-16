# Design: Transparent `codemode` rendering in `pi-grok-tui`

**Date:** 2026-11-15
**Repo:** `pi-grok-tui`
**Size:** Small change (localized to `codemode` display inside `pi-grok-tui`)

## Intent & Why

When `codemode` is active in Pi 1.5+, almost all tool work (`read`, `bash`, `write`, `edit`, `memory_*`, `models.*`) runs as nested calls inside `codemode` scripts. `pi-grok-tui` previously treated `codemode` as an unknown generic tool with no recognized preview field (`args` only has `{ code }`), rendering every turn as an opaque wall of `◆ Codemode` rows — hiding which files were read or modified, which commands ran, what is currently executing, and which nested step failed.

The goal is to make `codemode` visually transparent in Grok style without changing LLM payloads, session storage, or Pi core.

## Goals, Non-Goals & Anti-Goals

- **Goals:**
  - Surface actual inner tool actions instead of bare `Codemode` labels, live during `onUpdate` streaming and in history/resume.
  - Keep 1-call scripts compact (1 line) while automatically listing nested calls when a script batches multiple calls, modifies files inside a batch, or errors.
  - Support a 3-state fullscreen click cycle (`collapsed` → `calls` → `full` → `collapsed`) and `Ctrl+O` global cycling.
- **Non-Goals:**
  - Modifying Pi's `codemode` sandbox, schema, or stored `toolResult` content/details.
  - Full JS AST evaluation of `args.code`.
- **Anti-Goals:**
  - Dumping raw `Promise.allSettled` glue JS on the first click when the user only wants to inspect what tools ran.
  - Duplicating identical lines (e.g. printing both `◆ Write \`foo.ts\`` and an identical single child `└─ ✓ Write \`foo.ts\`` when a script only made that one `ok` call), or wiping JS syntax highlighting in `full` mode.

## Constraints

- `result.details.calls` (`CodemodeNestedCall[]`) stores `args` as compact JSON **truncated to 200 chars** (`ARGS_PREVIEW_CHARS = 200`, ending in `...`), and `models.*` calls store `"provider/id"`. Standard `JSON.parse` fails on any `bash`/`write` call over 200 chars; a lenient partial-JSON string-field extractor is required so `path`/`command`/`query` still format cleanly.
- `ToolExecutionComponent` patches are process-global across `/reload` and `jiti` specifier splits; any per-instance override state must live on `globalThis` via `state.ts`.
- `full` mode must preserve `CodeHighlighter` ANSI colors on the JS script and colored status icons (`✓`/`✗`/`…`/`⊘`), while stripping background blocks and dropping the native renderer's duplicate bold `codemode` heading.
- `codemode` rows must not merge across sibling `ToolExecutionComponent` runs into `◇ Ran N tools`, which would re-hide nested calls and conflict with `codemode`'s 3-state click.

## Approaches Considered

1. **Dedicated `codemode` 3-level branch in `tool-collapse` + pure `codemode-style.ts` helper (Selected)**
   - Reads `result.details.calls` live and falls back to a 1-line `args.code` statement preview only when `calls.length === 0`. Reuses `ToolViewMode` (`"chrome"` / `"truncated"` / `"full"` plus an explicit collapsed override for auto-expanded rows) and OSC 9999 fold markers.
   - *Trade-off:* Slightly extends `tool-collapse.ts` and `tool-click.ts`, but keeps 100% compatibility with live updates, `/reload`, hover rectangles, and `Ctrl+O`.
2. **Patching `codemode`'s `ToolDefinition.renderCall` / `renderResult`**
   - *Rejected:* `tool-collapse.ts` replaces `contentBox` in `chrome` mode and strips ANSI via `dimBodyTexts` in expanded mode, so renderer-level changes alone still break under Grok collapsing.
3. **Static regex parsing of `args.code` as primary source**
   - *Rejected:* Blind to loops, helper functions, per-call durations, live running progress, and per-call error statuses that `result.details.calls` already records accurately.

## User Decisions & Builder Calls

### Decided by user
1. **Default compact (`chrome`) display:**
   - **Single normal subcall (`calls.length === 1`, no error):** Renders as a single Grok chrome row using that tool's formatted title (e.g. `◆ Read \`extensions/tool-collapse.ts\``, `◆ Write \`extensions/codemode-titles.ts\``, `◆ Execute \`git status --short\``), with no `Codemode` label.
   - **Multi-call (`calls.length >= 2`) or error:** Renders an aggregated header (`◇ Read 2 files, Ran 1 command`, plus `(done/total)` while running and red ` · N failed` / ` · script failed` on error) with `├─ / └─` nested call rows directly underneath (`✓`/`✗`/`…`/`⊘`, formatted tool title, duration, and 1-line error snippet on failure).
2. **Three-state click cycle:**
   - Every `codemode` block cycles through 3 levels on click:
     1. **Collapsed (收起):** Single-line title/summary only.
     2. **Subcall list (子调用清单):** Header + nested call rows (`✓ Title  duration`, full error lines if failed; no JS source or script output).
     3. **Full (完整源码与输出):** Header + syntax-highlighted JS source + nested calls + full script output + `Elapsed`/`Took` timer + any `image()` output.

### Builder calls (explicit defaults to confirm)
- **No wasted 1st click on auto-expanded rows:** When a multi-call or errored `codemode` block is *already* displaying Level 2 (subcall list) by default in compact mode, clicking it once advances directly to **Level 3 (full JS + output)**, clicking a 2nd time folds to **Level 1 (single-line summary)**, and clicking a 3rd time returns to **Level 2 (subcall list)**. Single-call blocks start at Level 1, so clicks go **Level 1 → Level 2 → Level 3 → Level 1**.
- **Verb buckets for `write` / `edit` / `models.*`:** Add `Wrote N file(s)`, `Edited N file(s)`, `Classified N item(s)`, and `Generated N image(s)` to nested aggregation so batches with `write`/`edit` say `◇ Wrote 1 file, Ran 1 command` rather than `Ran 1 tool`.
- **Zero-call scripts & pre-call streaming:** When `calls.length === 0` (streaming `args.code`, pure `load()`/`store()` calculation, or early syntax/timeout error before any tool ran), format the title from the first non-comment statement of `args.code` (`◆ Script \`const m = load(...)\``, falling back to `◆ Codemode` while empty); if `result.isError` is true, auto-attach a `└─ ✗ <first error line>` row.
- **Large loops in compact tree:** Cap default compact auto-tree to 8 rows (matching Pi's `CALL_PREVIEW_COUNT = 8`, showing `… +N earlier calls` above when >8); explicit Level 2 (`calls`) shows all nested calls uncapped.
- **Whole-block hover & click:** Header and `├─ / └─` subcall rows share the same fold ID so hovering highlights the whole block and clicking anywhere in the block advances the 3-state cycle; compact spacing stays tight (0 blank lines between adjacent chrome blocks), while `full` mode adds 1-line breathing room above and below.
