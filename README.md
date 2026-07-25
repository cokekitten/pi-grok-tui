# pi-grok-tui

Grok-flavored TUI for [pi](https://github.com/earendil-works/pi-coding-agent) — denser chat, tool chrome, and user bubbles (display-only).

**Repo:** https://github.com/cokekitten/pi-grok-tui

## Features

### Thinking

- While the model is thinking: live scrolling view with at most **3** visible lines (Markdown preserved).
- When thinking finishes: always collapses to a single row — **`Thought (⌥T)`** on macOS / **`Thought (Alt+T)`** elsewhere.
- Expand/collapse thinking: **`⌥T`** (macOS Option+T → †), **`Alt+T`** (Option-as-Meta terminals), or **`Ctrl+Shift+H`**.

### Tools (Grok-style titles)

- Collapsible tools (**not** `edit`/`write`): **always title-only** while collapsed — including while running (no process/output body).
- Status diamonds: muted while running, green on success, red on failure.
- Consecutive collapsible tools **merge** into a Grok-style header, e.g. `◇ Read 2 files` or `◇ Ran 1 command · 1 failed`.
- **`edit` / `write` stay expanded** by default (full diff/content, native highlighting; background blocks removed).
- **`Ctrl+O` cycles three views:**
  1. **compact** — one-line chrome (default)
  2. **preview** — pi’s original truncated tool output
  3. **full** — fully expanded tool output  
  then back to compact.

### User messages

- Background bubble `#0f1217`
- Leading `❯` in `#c4a7e7`
- Assistant / tool rows indented to line up with the arrow column

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

| Key | Action |
|-----|--------|
| `⌥T` / `Alt+T` / `Ctrl+Shift+H` | Expand/collapse all thinking |
| `Ctrl+O` | Cycle tool views (compact → preview → full) |

## Notes

This extension monkey-patches pi’s internal TUI components. It may need updates if pi changes those internals.

Formerly **`pi-thinking-scroll`** (repo renamed to `pi-grok-tui`).

## Development

```bash
npm test
```

Package entry: `package.json` → `pi.extensions` → `./extensions/grok-tui.ts`.

## License

MIT
