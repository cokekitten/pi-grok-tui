# Fullscreen previous-message jump float — Implementation Plan

> **2026-10-02 correction:** This original plan's OSC 133 assumption was wrong: pi marks the blank padding of both user and assistant blocks. The updated spec supersedes that identification/preview design. The shipped fix marks real `UserMessageComponent.render()` boundaries, reads body previews, preserves the landing text/scrollbar, and routes float clicks ahead of covered MouseRegions. Verification now includes `prompt-jump-integration.test.mjs` (real components and SGR input) and `npm run test:prompt-jump-pty` (actual CLI/jiti/PTY, wheel/click/End/reload, synthetic data only). The old fake-layout smoke is not acceptance evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In pi fullscreen TUI, float a single one-line strip at the top of the transcript viewport showing the most recent user message scrolled past; click jumps to it (first row top-aligned), and the strip updates to the next older message.

**Architecture:** Pure row-scan/selection helpers in `prompt-jump-core.ts`; one `TuiAltScreen.prototype.applySearchHighlights` wrapper paints the strip before overlay compositing and reuses grok-tui's OSC 9999 hit-marker + fold-handler click path (`registerFoldHandler` / `withFoldMarker` / `injectFoldRow`). Display-only prototype monkey-patch, fail-soft on any missing seam.

**Tech Stack:** TypeScript (ESM, `.ts` specifier imports), pi-tui 0.99.x internals, `node --experimental-strip-types --test`.

**Spec:** `docs/superpowers/specs/2026-10-01-prompt-jump-float-design.md`

## Global Constraints

- Fullscreen only (`TuiAltScreen`); regular TUI unchanged.
- Exactly **one** strip at a time; one line only; truncated with `…`.
- User-message row = `scrollContentLines` row matching `^\x1b\]133;A` (BEL or ST).
- Jump: `scrollView.scrollTo(promptRow, { disableFollow: true })` (first row top-aligned).
- Paint **before** overlay compositing (inside `applySearchHighlights`), so dialogs cover the strip.
- Fail-soft: never throw out of render/patch; missing seam ⇒ feature absent, nothing else breaks.
- No new dependencies; no pi core changes.

## Review Focus

- Strip hidden whenever `isFollowingOutput` is true (bottom) — must not cover the live view.
- Click regression risk on covered content rows: the strip row carries exactly one fold marker (ours); covered-row markers vanish with the replaced row.
- jiti `.js`/`.ts` specifier split: only globalThis-backed registries (`foldRegistry`, `state`) cross module instances — do not add module-local mutable state on the hot path.
- Restore on uninstall must return the exact original prototype method.

---

## Task 1 — Pure core + tests (`prompt-jump-core.ts`)

File: `extensions/prompt-jump-core.ts` (new), `prompt-jump.test.mjs` (new).

Interface (locked):

```ts
export const PROMPT_ROW_RE: RegExp;               // /^\x1b\]133;A(?:\x07|\x1b\\)/
export function findPromptRows(lines: readonly string[]): number[];
export function pickFloatTarget(
  promptRows: readonly number[],
  scrollTop: number,
): number | undefined;                            // largest row strictly < scrollTop
export function formatStrip(rawRow: string, width: number): string;
// strip OSC/ANSI via pi-tui stripTerminalSequences, then truncateToWidth(text, width, "…")
```

- [ ] Write `prompt-jump.test.mjs`: `findPromptRows` (BEL vs ST terminators; `133;B`/`133;C` ignored; marker not at line start ignored; blank/ANSI-only rows ignored). `pickFloatTarget` (none→undefined; all ≥ scrollTop→undefined; largest < scrollTop wins; prompt exactly at scrollTop excluded → the previous one wins; scrollTop 0→undefined). `formatStrip` (OSC 133 prefix + SGR removed; CJK truncation with `…`; exact fit keeps text untouched; empty→"").
- [ ] Run `node --experimental-strip-types --test prompt-jump.test.mjs` — fails (module missing).
- [ ] Implement `prompt-jump-core.ts` minimally (imports: `stripTerminalSequences`, `truncateToWidth` from `@earendil-works/pi-tui`).
- [ ] Run the test file — passes.
- [ ] Commit `feat: prompt-jump core helpers (prompt row scan, float target, strip format)`.

## Task 2 — Paint + click patch (`prompt-jump.ts`), wiring

Files: `extensions/prompt-jump.ts` (new), `extensions/grok-tui.ts` (wire install + cleanup), `package.json` (add `prompt-jump.test.mjs` to `test` script).

Behavior (locked):

- Constant fold id `"prompt-jump"`. Per paint: `registerFoldHandler("prompt-jump", () => { scrollView.scrollTo(target, { disableFollow: true }); self.requestRender?.(); })` — re-registered every frame with a fresh closure (registry is a global Map; same-key overwrite).
- Strip row = `withFoldMarker(line, "prompt-jump", width)`; `line` = faint fg on `USER_MESSAGE_BG` (`#0f1217`, from `user-message-style.ts`) padded to the viewport width; when `getState().hoveredFoldId === "prompt-jump"` use `HOVER_BG` (from `fold-body.ts`) and drop the faint attribute. `❯` keeps `USER_MESSAGE_ARROW_FG` (`#c4a7e7`).
- Paint target screen row = `max(box.rect.y, box.clip.y)` of the **primary scroll view's** LayoutBox (found by walking `layout.root` for `box.scrollView === layout.primaryScrollView`; local walk, no pi-tui private imports).
- Show conditions (all must hold): `getState().tuiMode === "fullscreen"`; `this.isFollowingOutput === false`; `pickFloatTarget` returns a row; strip row inside the box clip and `0 <= row < screen.length`; `width >= 4`.
- [ ] Implement `extensions/prompt-jump.ts` with `installPromptJumpPatch(): () => void` wrapping `TuiAltScreen.prototype.applySearchHighlights` (call original first, then paint into its return value; guard `typeof original !== "function"` → no-op cleanup).
- [ ] Wire into `extensions/grok-tui.ts` `installPatch()` (try/catch + `console.warn` like the others; cleanup in the returned disposer).
- [ ] Add `prompt-jump.test.mjs` to the `test` script; run `npm test` — all suites pass.
- [ ] Commit `feat: fullscreen previous-message jump float (paint + click)`.

## Task 3 — README

- [ ] Update `README.md`: Features bullet (strip behavior, fullscreen-only, fail-soft note) + Usage table row `Click the top float strip (fullscreen) | Jump to that user message (first row top-aligned)`.
- [ ] Commit `docs: document the previous-message jump float`.
