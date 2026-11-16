# Codemode Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Pi 1.5+ `codemode` tool executions transparently in `pi-grok-tui` — single-line inner tool titles for 1-call scripts, aggregated Grok headers with `├─ / └─` nested call trees for multi-call or errored scripts, and a 3-state fullscreen click cycle (`collapsed` → `calls` → `full`).

**Architecture:** Add a pure helper module `extensions/codemode-style.ts` that parses `result.details.calls` (including 200-char truncated JSON args and `models.*` refs), formats nested titles/verb summaries/trees, and resolves the 3-level display state against `state.ts`. Wire `codemode` into `click-fold-core.ts`, `tool-click.ts`, `parent-stamp.ts`, and `tool-collapse.ts` (preserving `CodeHighlighter` ANSI highlights in `full` mode and preventing cross-tool `◇ Ran N tools` grouping).

**Tech Stack:** TypeScript (Node `--experimental-transform-types`), `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-15-codemode-transparency-design.md`

## Global Constraints

- Display-only inside `pi-grok-tui`; never mutate Pi's `codemode` execution, `result.details`, or session entries.
- Per-instance override state must live on `globalThis` via `state.ts` (`viewOverrides`).
- Handle `ARGS_PREVIEW_CHARS = 200` truncated JSON strings in `CodemodeNestedCall.args` without throwing.
- Preserve `CodeHighlighter` JS syntax highlighting and status/error foreground colors in `full` mode while stripping background boxes and duplicate `codemode` headings.
- Never merge `codemode` with sibling tools into `◇ Ran N tools`.

## Review Focus

- `CodemodeNestedCall.args` truncated mid-string at 200 chars with escaped quotes/newlines still extracts `path`/`command` cleanly without throwing.
- Absolute paths inside `cwd` or `$HOME` shorten so 60-char truncation does not clip filenames off the right edge.
- Script-level error after `ok` nested calls (e.g. `ReferenceError` after `read` succeeded) displays ` · script failed` and a `└─ ✗ <error>` row rather than an unexplained red header over all-green checkmarks.
- Clicking an auto-expanded multi-call block in default `chrome` mode advances directly to `full` on the 1st click (no no-op click), then `collapsed` on the 2nd, then `calls` on the 3rd.
- Pre-patch `ToolExecutionComponent` instances rebuilt during `/reload` restyle lazily on their first `render()` frame.

---

### Task 1: Pure `codemode-style.ts` formatting, lenient JSON parser & state machine

**Files:**
- Create: `extensions/codemode-style.ts`
- Create: `codemode-collapse.test.mjs`

- [x] **Step 1: Write failing unit tests in `codemode-collapse.test.mjs` for `codemode-style.ts`**
- [x] **Step 2: Run `node --experimental-transform-types --import ./scripts/test-register.mjs --test codemode-collapse.test.mjs` to verify failure**
- [x] **Step 3: Implement `extensions/codemode-style.ts`**
- [x] **Step 4: Re-run `codemode-collapse.test.mjs` and verify unit tests pass**

### Task 2: 3-state fold routing, non-grouping & spacing (`click-fold-core.ts`, `tool-click.ts`, `parent-stamp.ts`)

**Files:**
- Modify: `extensions/click-fold-core.ts`
- Modify: `extensions/tool-click.ts`
- Modify: `extensions/parent-stamp.ts`
- Test: `codemode-collapse.test.mjs`, `click-fold-core.test.mjs`, `tool-click.test.mjs`

- [x] **Step 1: Add failing tests for `codemode` 3-state click cycle, auto-tree no-wasted-click, non-grouping, and `shouldGapAfter`**
- [x] **Step 2: Run tests to verify failure**
- [x] **Step 3: Implement `isGroupableTool`, `nextToolFoldMode("codemode")`, `effectiveToolMode(target, "codemode")`, and `shouldGapAfter` updates**
- [x] **Step 4: Run tests to verify pass**

### Task 3: `ToolExecutionComponent` `codemode` rendering (`collapsed` / `calls` / `full`) & `/reload` lazy restyle

**Files:**
- Modify: `extensions/tool-collapse.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: `codemode-collapse.test.mjs`

- [x] **Step 1: Add failing integration tests with real `ToolExecutionComponent` and `codemode` renderers (live streaming, hover/click on tree rows, `full` syntax highlight preservation, narrow widths, scroll cache reuse, and `/reload` lazy restyle)**
- [x] **Step 2: Run tests to verify failure**
- [x] **Step 3: Implement `codemode` branches and `PATCHED_GEN` lazy restyle in `extensions/tool-collapse.ts`, wire test into `package.json`, and update `README.md` / `CHANGELOG.md`**
- [x] **Step 4: Run full `npm test` suite and verify 0 failures**
