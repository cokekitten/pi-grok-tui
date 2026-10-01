# Design: Fullscreen previous-message jump float

**Date:** 2026-10-01
**Repo:** `pi-grok-tui`
**Status:** Draft — pending user review

## Goal

In pi **fullscreen** TUI, while the transcript is scrolled away from the bottom, float a **single one-line strip** at the top of the transcript viewport showing the most recent user message that has been scrolled past (its first row is above the viewport top). Clicking the strip scrolls so that message's first row is top-aligned in the viewport; the strip then updates to show the next older user message. Regular TUI is unchanged.

Display-only. No pi core fork.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Scope | Fullscreen only (`TuiAltScreen`) |
| Shape | **One strip at a time** (a "deck" of stacked strips is explicitly out of scope; a jumped-to message sitting at the viewport top is real content, not a second strip) |
| Strip content | Exactly one line: the user message's rendered first row, ANSI-stripped, truncated to the viewport width with `…` (the row already carries the `❯` marker) |
| Placement | Overlay the **first row of the transcript viewport** (below the header). No layout shift. |
| Show when | `TuiAltScreen.isFollowingOutput === false` **and** at least one user-message row exists above `scrollTop` |
| Hide when | Back at the bottom (follow-end), no user message above the viewport top, or the strip cannot be rendered |
| User-message row | A `scrollContentLines` row matching `^\x1b\]133;A` — same source as pi's own `tui.altScreen.previousPrompt` (`scrollToPrompt`) |
| Click target | **Strip cells only.** Reuse grok-tui's zero-width OSC 9999 hit marker + `injectFoldRow` press-injection. Do not wrap any other row. |
| Click action | `scrollView.scrollTo(promptRow, { disableFollow: true })` — message first row top-aligned (same landing as pi's `⌥↑`) — then `requestRender()` |
| Style | Faint/dim strip background text; hover (existing `hoveredFoldId`) brightens the strip |
| Drag | Unmoved click only (pi already drops OSC 8 after motion) |
| Dialogs | Paint before overlay compositing, so real overlays (dialogs, search) cover the strip |
| Fail-soft | Missing prototype / layout shape / seam → no strip, no errors |

## Non-goals

- Regular-mode strip (terminal scrollback; no viewport overlay).
- Stacked deck / multiple strips / strip history.
- Keyboard bindings (pi already has `previousPrompt` / `nextPrompt`).
- `showOverlay()` / `widgetContainerAbove` placement (wheel events may be eaten by overlays).
- Persisting scroll position.

## Architecture

- Pure helpers in `extensions/prompt-jump-core.ts`:
  - `findPromptRows(lines)` — row indices matching `^\x1b\]133;A` (BEL or ST terminated).
  - `pickFloatTarget({ promptRows, scrollTop })` — the largest prompt row strictly `< scrollTop` (undefined when none). After a jump to row `R`, `scrollTop === R`, so the same rule yields the message before `R`.
  - `formatStrip(rawRow, width)` — strip ANSI/OSC 133 prefix, truncate one line with `…`.
- Paint + click wiring in `extensions/prompt-jump.ts`:
  - Patch `TuiAltScreen.prototype.applySearchHighlights(screen, layout)` (runs before overlay compositing).
  - Locate the primary scroll view's `LayoutBox` (`rect`, `scrollContentLines`, `scrollView`) by walking `layout.root`; `layout.primaryScrollView` identifies the view. A local walk avoids depending on pi-tui's unexported `getScrollViewBox`.
  - Paint the strip on screen row `box.rect.y`, replacing the covered row content (any fold marker of the covered row is discarded with it).
  - `registerFoldHandler(id, jump)` + `withFoldMarker(strip, id, width)`; `jump` calls `scrollTo(promptRow, { disableFollow: true })` then `requestRender()`.
  - Hover: when `getState().hoveredFoldId === id`, brighten the strip.
- Mount from `extensions/grok-tui.ts` alongside the other patches; unpatch restores the original prototype method.

Seams (pi-tui 0.99.x): `isFollowingOutput`, `ScrollView.scrollTo(scrollTop, { disableFollow })`, `ScrollView.scrollTop`, `applySearchHighlights(screen, layout)` (before overlays), `LayoutFrame.primaryScrollView` / `LayoutBox.rect` / `scrollContentLines`, OSC 133 prompt-start rows (`^\x1b\]133;A`).

## Error handling

- Every seam access is guarded; anything unexpected skips painting for that frame (never throws out of `doRender`).
- Click handler runs inside the existing fold dispatch try/catch; a stale row index clamps to `scrollContentLines` bounds before `scrollTo`.
- Uninstall restores the original `applySearchHighlights` exactly.

## Testing

`prompt-jump.test.mjs` (node --test, matching the repo's existing suites):

- `findPromptRows`: BEL vs ST terminators, non-prompt OSC 133 zones (B/C) ignored, match strictly at line start (a row whose OSC 133 marker is preceded by other content is not a prompt start).
- `pickFloatTarget`: no prompts, prompt at `scrollTop` (excluded → previous one wins), prompt above with gaps, `scrollTop === 0`.
- `formatStrip`: ANSI stripped, CJK width truncation with `…`, empty row.

Manual: fullscreen, wheel up mid-transcript → strip appears; click → message top-aligned, strip swaps to the older message; scroll to bottom → strip disappears.
