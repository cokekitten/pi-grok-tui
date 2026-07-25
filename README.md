# pi-thinking-scroll

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that densifies the TUI for **thinking** and **tool calls** (display-only).

## Features

### Thinking

- While the model is thinking: live scrolling view with at most **3** visible lines (Markdown preserved).
- When thinking finishes: always collapses to a single row — **`Thought (Alt+T)`**.
- Press **`Alt+T`** to expand/collapse all thinking blocks.

### Tools (Grok-style titles)

- Collapsible tools (**not** `edit`/`write`): **always title-only** while collapsed — including while running (no process/output body).
- Status diamonds: muted while running, green on success, red on failure.
- Consecutive collapsible tools **merge** into a Grok-style header, e.g. `◇ Read 2 files` or `◇ Ran 1 command · 1 failed`.
- **`edit` / `write` stay expanded** by default (full diff/content), matching Grok Build’s Edit policy.
- **`Ctrl+O` cycles three views:**
  1. **compact** — one-line chrome (default)
  2. **preview** — pi’s original truncated tool output
  3. **full** — fully expanded tool output  
  then back to compact.

| Tool | Collapsed title example |
|------|-------------------------|
| `read` | `● Read \`src/a.ts\`` |
| `bash` | `● Execute \`cargo test\`` |
| multi-read | `● Read 2 files` |
| failed bash | `● Ran 1 command · 1 failed` (red dot) |
| `edit` / `write` | *not collapsed* — native render |

Only changes TUI rendering. It does not modify LLM context, provider payloads, session messages, or stored conversation data.

## Install

From GitHub:

```bash
pi install git:github.com/cokekitten/pi-thinking-scroll
```

Or try it for one run without installing:

```bash
pi -e git:github.com/cokekitten/pi-thinking-scroll
```

Local checkout:

```bash
pi install /path/to/pi-thinking-scroll
# or
pi -e /path/to/pi-thinking-scroll
```

After installing, restart pi or run `/reload`.

## Usage

Use pi normally with a reasoning model and tools.

| Key | Action |
|-----|--------|
| `Alt+T` | Expand/collapse all thinking |
| `Ctrl+O` | Expand/collapse tool outputs (pi native; collapsible tools become title-only when collapsed) |

## Notes

This extension monkey-patches pi’s internal `AssistantMessageComponent` and `ToolExecutionComponent` rendering. That makes full chrome replacement possible, but the extension may need updates if pi changes its internal TUI implementation.

## Development

```bash
npm test   # pure title helpers
```

Package resources are declared in `package.json` under the `pi.extensions` field.

## License

MIT
