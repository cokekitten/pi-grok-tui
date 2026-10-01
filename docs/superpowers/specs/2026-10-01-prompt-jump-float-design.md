# Design: Fullscreen previous-message jump float

**Date:** 2026-10-01; implementation corrected 2026-10-02
**Repo:** `pi-grok-tui`

## Goal

While the fullscreen transcript is scrolled away from the bottom, show **one one-line strip** at the top with the nearest user message above the viewport. Click to jump to that message; the strip then shows the previous user message. The jumped-to message is real transcript content, not a second float.

Display-only. No pi core fork, message mutation, or persisted navigation state. Regular TUI is unchanged.

## Decisions

| Topic | Decision |
|-------|----------|
| Scope | Fullscreen (`TuiAltScreen`), away from follow-end |
| Shape | Exactly one strip, `❯` + one line of text, terminal-column truncation with `…` |
| Placement | Cover the first transcript viewport row, preserving the scrollbar cell; no layout shift |
| User identification | Private zero-width `user-start` / `user-end` markers on `UserMessageComponent.render()` output only |
| Preview | First nonblank rendered text **within the marked user block**, not its top padding |
| Target | Nearest marked block start strictly `< scrollTop` |
| Landing | `scrollTo(blockStart, { disableFollow: true })`; top padding is covered by the new strip and the jumped-to message's first text line remains visible immediately below it |
| Style | User bubble background `#0f1217`, purple `❯`, faint text; hover `#2c2c2c` |
| Click | Existing OSC 9999 fold marker and press-only OSC 8 injection; unchanged text selection/drag semantics |
| Hit priority | Float wins over interactive tool/body regions beneath it, never over dialogs or scrollbar cells |
| Hide | Following output, no earlier user message, unsupported seam, narrow viewport, or real overlay/dialog open |
| Reload | Existing message components are marked at render time; arrowless native bodies still yield `❯` previews |
| Cleanup | Restore render/mouse prototype methods; release the float handler and hover state |

## Why the original implementation did not display

Pi 0.99.2 emits OSC 133 A on the **blank top padding row**, for both user messages and tool-free assistant messages. The original implementation treated it as a user-only text row, formatted an empty preview, then returned without painting.

The original fake-layout smoke put text on that marker row, so it could not reproduce the real failure. The corrected regression tests use actual message components, ScrollView, layout, TuiAltScreen, and mouse input. OSC 133 remains untouched for native navigation; it is no longer used to identify users.

## Architecture

- `extensions/user-message-style.ts`: wraps `UserMessageComponent.render()` to append user-only start/end OSC 9999 markers to copied rows, without changing widths, heights, native OSC 133 prefixes, or cached source arrays. Rendering rather than construction also covers pre-reload message instances.
- `extensions/prompt-jump-core.ts`: `markUserMessageRows`, `findUserMessageTarget`, and `formatStrip`. Search backwards for the nearest user anchor and read its preview within the component boundary only.
- `extensions/prompt-jump.ts`: wraps `applySearchHighlights(screen, layout)` to paint before native overlay composition. Uses the primary scroll box's current content lines and geometry every frame, so resize/folding does not reuse stale row offsets.
- Click handler registry: fixed `prompt-jump` key, refreshed each paint. `handleMouseEvent` routes hits on the actual painted strip to the existing `handleSelectionMouseEvent` fold path before underlying MouseRegions can consume them. Dialogs, other component captures and scrollbar cells retain native routing.
- Painting preserves the rightmost scrollbar cell. Segment reset is placed **after** the strip: putting an OSC 8 close before its text would cancel click-fold's temporarily injected hyperlink.
- `extensions/grok-tui.ts` mounts and disposes the patch with the other display patches.

## Non-goals

- Regular-terminal-scrollback overlays.
- Multi-strip decks, keyboard rebinding, persisted scroll position.
- Changing pi core or model/session content.

## Verification

- `prompt-jump.test.mjs`: user-only bounded anchors, unchanged row/cache data, empty/edge inputs, Unicode widths and control-sequence stripping.
- `prompt-jump-integration.test.mjs`: actual message rendering and fullscreen layout with only terminal I/O replaced. Wheel-up, successive SGR clicks, visible landing text, pre-reload instances, covered interactive body, drag selection, scrollbar, dialog priority, resize, and return-to-end.
- `npm run test:prompt-jump-pty`: launches the installed pi CLI in a real PTY with isolated config and a synthetic transcript, loads the actual grok-tui entry through pi's loader, sends wheel/press/release/End and `/reload`. A read-only frame observer records post-render state. No model calls or personal session data.
