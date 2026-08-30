# pi-grok-tui

Grok-flavored TUI for [pi](https://github.com/earendil-works/pi-coding-agent) — denser chat, tool chrome, and user bubbles (display-only).

**Repo:** https://github.com/cokekitten/pi-grok-tui

## Features

### Thinking

- While the model is thinking: live scrolling view with at most **3** visible lines (Markdown preserved).
- When thinking finishes: always collapses to a single row — **`◆ Thought`**.
- In **fullscreen**, click that row to expand/collapse **this** thinking block. When expanded, click **anywhere in the thinking text** to collapse it back (no need to hit the title row). Hovering the title or body highlights the **whole block**. Keyboard still toggles all thinking: **`⌥T`** (macOS Option+T → †), **`Alt+T`**, or **`Ctrl+Shift+H`**.
- Regular TUI keeps the **`(⌥T)` / `(Alt+T)`** hint (clicks are not captured there).

### Tools (Grok-style titles)

- Collapsible tools (**not** `edit`/`write`): **always title-only** while collapsed — including while running (no process/output body).
- Status diamonds: muted while running, green on success, red on failure.
- Consecutive collapsible tools **merge** into a Grok-style header, e.g. `◇ Read 2 files` or `◇ Ran 1 command · 1 failed`.
- **`write` stays native preview** by default (first 10 lines, syntax highlighting; background blocks removed). In **fullscreen**, click **anywhere in the write block** to expand to full content; click again to return to the 10-line preview. Compact global mode maps write to that preview — never a grok title-only row.
- **`edit` stays fully expanded** (full diff, native highlighting; background blocks removed) and is **not** click-to-fold.
- In **fullscreen**, click chrome to fold that row (Read → preview; other tools → full). Click a group header to split/merge the group; click a member to open only that member. When a tool is expanded, click **anywhere in its output** to fold it back to the title row. Hovering a chrome or body row highlights that **whole block** (group header vs member stay separate).
- **`Ctrl+O` cycles three global views** (and clears per-row tool clicks):
  1. **compact** — one-line chrome (default)
  2. **preview** — pi’s original truncated tool output
  3. **full** — fully expanded tool output  
  then back to compact.
- Regular TUI keeps the **`(Ctrl+O)`** hint on chrome.

### User messages

- Background bubble `#0f1217`
- Leading `❯` in `#c4a7e7`
- Assistant / tool rows indented to line up with the arrow column

### Editor

- Keeps the main input editor and footer visually docked at the bottom while the transcript is shorter than the terminal.
- Normal terminal scrolling takes over after the transcript exceeds the viewport.
- If previously overflowing content shrinks (for example, after collapsing output), enable pi's `terminal.clearOnShrink` setting or set `PI_CLEAR_ON_SHRINK=1` to re-anchor the inline viewport. This can flicker and may clear terminal scrollback.
- Set `PI_GROK_TUI_DOCK_EDITOR=0` to restore pi's native inline editor layout.
- In **fullscreen**, scrolling the transcript away from the bottom shows a centered **`Jump to bottom (click) ↓`** pill on the last visible transcript row. Click the pill (not the surrounding text) to jump back; it hides once you are following the bottom again. Regular TUI is unchanged.

Only changes TUI rendering. It does not modify LLM context, provider payloads, session messages, or stored conversation data.

## Install

From GitHub:

```bash
pi install git:github.com/cokekitten/pi-grok-tui
```

Or try it for one run without installing:

```bash
pi -e git:github.com/cokekitten/pi-grok-tui
```

Local checkout:

```bash
# e.g. in ~/.pi/agent/settings.json packages:
#   "../../dev/pi-grok-tui"
pi install /path/to/pi-grok-tui
# or
pi -e /path/to/pi-grok-tui
```

After installing, restart pi or run `/reload`.

## Usage

| Key / click | Action |
|-------------|--------|
| Click `◆ Thought` (fullscreen) | Expand/collapse that thinking block |
| Click expanded thinking text (fullscreen) | Collapse that thinking block |
| Click tool / group chrome (fullscreen) | Fold that row or split/merge the group |
| Click expanded tool output (fullscreen) | Fold that tool back to its title |
| Click write block (fullscreen) | Toggle native 10-line preview ↔ full |
| Hover a foldable block (fullscreen) | Highlight the whole block |
| Click `Jump to bottom (click) ↓` (fullscreen) | Jump the transcript back to the bottom |
| `⌥T` / `Alt+T` / `Ctrl+Shift+H` | Expand/collapse all thinking |
| `Ctrl+O` | Cycle tool views (compact → preview → full) |

## Notes

This extension monkey-patches pi’s internal TUI components, including locating pi's `CustomEditor` and padding the root layout for editor docking. It may need updates if pi changes those internals. The dock is visual padding, not a separate scrollable message pane.

Formerly **`pi-thinking-scroll`** (repo renamed to `pi-grok-tui`).

## Development

```bash
npm test
```

Package entry: `package.json` → `pi.extensions` → `./extensions/grok-tui.ts`.

## License

MIT
