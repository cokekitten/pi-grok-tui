# Design: Fullscreen jump-to-bottom pill

**Date:** 2026-08-31  
**Repo:** `pi-grok-tui`  
**Status:** Approved for implementation

## Goal

In pi **fullscreen** TUI, when the user scrolls the transcript away from the bottom, show a Claude Code-style centered pill on the last visible transcript row. Clicking the pill jumps back to the bottom. Regular TUI is unchanged.

Display-only. No pi core fork.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Scope | Fullscreen only (`TuiAltScreen`) |
| Placement | Overlay the **last visible primary-scroll row** (input-box 上方、盖住最后一行对话). No layout shift. |
| Copy | ` Jump to bottom (click) ↓ ` |
| Show when | `TuiAltScreen.isFollowingOutput === false` (wheel, PageUp, scrollbar, Home, …) |
| Hide when | Back at the bottom (`isFollowingOutput === true`) or viewport too narrow to fit the full pill |
| Click target | **Pill cells only.** Surrounding text stays selectable. |
| Click plumbing | Bounded OSC 9999 hit span + existing `pi-grok-tui://v1/fold/<id>` press-injection. Do **not** wrap the whole row. |
| Drag | Unmoved click only (pi already drops OSC 8 after motion). |
| Dialogs | Paint before `compositeOverlays`, so real overlays cover the pill. |
| Fail-soft | Missing prototype / layout shape → no pill. |

## Non-goals

- Regular-mode jump button (terminal scrollback; no `isFollowingOutput`).
- `showOverlay()` / `widgetContainerAbove` placement.
- Changing Home/End/PageUp bindings.
- Persisting scroll position.

## Architecture

- Pure helpers in `extensions/jump-bottom-core.ts` (visibility, centering, hit-span parse).
- Paint + `applySearchHighlights` patch in `extensions/jump-bottom.ts`.
- Bounded press-injection in `extensions/click-fold.ts` (`injectHitSpan` before `injectFoldRow`).
- Hit marker: `OSC 9999;pi-grok-tui/v1/hit/<id>/<visibleWidth> BEL` (zero-width).

Seams (pi 0.84+): `isFollowingOutput`, `scrollToBottom()`, `applySearchHighlights(screen, layout)` (before overlays), `compositeTuiLine`.
