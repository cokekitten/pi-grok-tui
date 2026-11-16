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
- Consecutive collapsible tools **merge** into a Grok-style header, e.g. `◇ Read 2 files` or `◇ Ran 1 command · 1 failed`. Compact MCP (`renderShell: "self"`) titles get the same left indent as `Execute` / `Thought`.
- **`write` stays native preview** by default (first 10 lines, syntax highlighting; background blocks removed). In **fullscreen**, click **anywhere in the write block** to expand to full content; click again to return to the 10-line preview. Compact global mode maps write to that preview — never a grok title-only row.
- **`edit` stays fully expanded** (full diff, native highlighting; background blocks removed) and is **not** click-to-fold.
- In **fullscreen**, click chrome to fold that row (Read → preview; other tools → full). Click a group header to split/merge the group; click a member to open only that member. When a tool is expanded, click **anywhere in its output** to fold it back to the title row. Hovering a chrome or body row highlights that **whole block** as one rectangle, including interior blank lines (group header vs member stay separate).
- **`Ctrl+O` cycles three global views** (and clears per-row tool clicks):
  1. **compact** — one-line chrome (default)
  2. **preview** — pi’s original truncated tool output
  3. **full** — fully expanded tool output  
  then back to compact.
- Regular TUI keeps the **`(Ctrl+O)`** hint on chrome.

### Codemode

- Transparent rendering for Pi 1.5+ `codemode` tool calls instead of opaque `◆ Codemode` rows:
  - **During turn execution:** keeps the nested `├─ / └─` call list visible across steps (`◇ Read 1 file, Ran 1 command (1/2)` while running, then completed `✓ / ✗ / ⊘` rows with durations/costs) until the turn concludes.
  - **Once the turn finishes:** rolls up with surrounding steps into the single turn summary row (or collapses to a single Grok row for lone 1-block turns — `◆ Read \`…\``, `◇ Read 2 files, Wrote 1 file`, or `◆ Script \`<first statement>\`` for 0-call scripts); expanding a finished turn rollup shows each `codemode` in clean **single-line** form first.
- **Two interactive zones in fullscreen:**
  - **Title row:** clicking an expanded `codemode` title (`calls` or `full`) **immediately collapses** it back to 1 line; clicking a 1-line title expands it.
  - **Lower region (call list / full script & output):** clicking the lower region cycles the 3-state view (**nested call list** → **full syntax-highlighted JS + output** → **collapsed 1-line**), with independent hover highlighting per zone. `codemode` rows never merge into cross-tool `◇ Ran N tools` groups.

### Compaction

- Context compaction is restyled to grok chrome: **`◇ Compacted from N tokens`**, no native `[compaction]` label or purple block.
- In **fullscreen**, click the row to expand/collapse the summary. **`Ctrl+O`** still cycles the global tool view (compact hides the summary body).

### Custom messages & entries

- Extension-rendered `custom_message` and `custom` session entries (`pi-subagents` supervisor requests/replies/notices, `pi-intercom` cards, background-task notices, etc.) collapse to a single Grok **`◇`** chrome row in compact mode (extracting the extension renderer's headline, e.g. `◇ [subagent] worker needs a decision`, `◇ [subagent] reply sent to worker`, `◇ [intercom] From …`), with no native purple `customMessageBg` block.
- In **fullscreen**, click the `◇` row to expand the full message/entry body (background blocks stripped) and click anywhere in the expanded body to fold back; **`Ctrl+O`** cycles all custom blocks alongside tools. Pre-existing instances self-heal on first paint after `/reload`.

### Turn work rollup

- While a turn is actively thinking or running tools (no closing response or next user prompt below the work rows yet), each `◆ Thought`, tool, `codemode` subcall list, and custom status row stays live.
- Once assistant prose — or a turn-closing boundary such as a follow-up user message, `/skill`, `!bash`, compaction/branch summary, or terminal error/abort — arrives below a contiguous stack of ≥2 work blocks (`Thought`, tools, `codemode` batches, `subagent`, custom chrome rows, plus any leading `Thought` inside the prose message), the entire stack automatically rolls up into **one Grok summary line** with total elapsed duration when available (e.g. `◇ Thought · Read 38 files, Wrote 8 files, Ran 3 commands · 2m 14s`, with ` · N failed` on error).
- In **fullscreen**, clicking that `◇` summary row expands it in place (with `codemode` rows in compact single-line form, ready to expand individually), and clicking the top `◇` summary header folds the stack back into one line. `Ctrl+O` and `Alt+T` temporarily dissolve the rollup when viewing previews/full output or global thinking.

### User messages

- Background bubble `#0f1217`
- Leading `❯` in `#c4a7e7`
- Assistant / tool rows indented to line up with the arrow column
- Already-rendered history is re-styled automatically: after a restart, `/reload`, or a session resume, user messages created before the patch was (re)installed are rebuilt with the current style at their first paint — each instance at most once per patch generation.

### Message jump float

- While the fullscreen transcript is scrolled away from the bottom, a one-line strip floats at the top of the viewport showing the most recent user message scrolled past (`❯ …`, truncated with `…`).
- **Click the strip** to jump to that user message. The strip then shows the next older user message; the landed message's first text line stays visible directly below it (the strip covers only its top padding).
- Only real user messages are targets, not assistant/tool output. Scrolling back to the bottom hides the strip; dialogs take priority. Regular TUI is unchanged. Fail-soft: if a pi seam is missing, there is simply no strip.

### Editor

- Keeps the main input editor and footer visually docked at the bottom while the transcript is shorter than the terminal.
- Normal terminal scrolling takes over after the transcript exceeds the viewport.
- If previously overflowing content shrinks (for example, after collapsing output), enable pi's `terminal.clearOnShrink` setting or set `PI_CLEAR_ON_SHRINK=1` to re-anchor the inline viewport. This can flicker and may clear terminal scrollback.
- Set `PI_GROK_TUI_DOCK_EDITOR=0` to restore pi's native inline editor layout.
- In **fullscreen**, pi 0.85+ already shows a native **Jump to latest message** label when the transcript is scrolled up. grok-tui no longer paints its own jump-bottom pill.

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
| Hover a foldable block (fullscreen) | Highlight the whole block, including blank lines |
| Click compaction chrome (fullscreen) | Expand/collapse that compaction summary |
| Click the top float strip (fullscreen) | Jump to that user message (first row top-aligned) |
| `⌥T` / `Alt+T` / `Ctrl+Shift+H` | Expand/collapse all thinking |
| `Ctrl+O` | Cycle tool views (compact → preview → full) |

## Notes

This extension monkey-patches pi’s internal TUI components, including locating pi's `CustomEditor` and padding the root layout for editor docking. It may need updates if pi changes those internals. The dock is visual padding, not a separate scrollable message pane.

Restyling must never blanket-clear a component's `cache` field: pi's write renderer keeps its incremental syntax-highlight cache there (`WriteCallRenderComponent.cache`). Wiping it makes pi re-highlight the whole file on every streamed args delta (highlight.js O(n²)), which freezes the TUI while a long file is written. `flat-style.ts` therefore only drops non-highlight caches; `write-highlight-cache.test.mjs` locks this in.

Formerly **`pi-thinking-scroll`** (repo renamed to `pi-grok-tui`).

## Pi 1.5 compatibility

Version 0.3.5 preserves Pi 1.5's streamed Markdown/highlight caches and deferred tool-argument rendering. User bubbles, assistant text and visible thinking forward registered Markdown transformers with the actual content width, current streaming state, and saved entry IDs/ISO timestamps where available. These remain display-only changes; message content is untouched.

Updates are listed in [CHANGELOG.md](CHANGELOG.md), included in the package for Pi 1.5's Extension Updates notices. There are no changes to the existing colors, folding rules or keyboard shortcuts.

## Development

Use a current Node.js 24 release for the native TypeScript test loader. Host packages remain external peers. For a managed Pi installation, link tests to its active release; repeat after upgrading Pi (the script replaces only symlinks, never real dependency directories):

```bash
npm run test:setup
# For a non-managed installation instead:
# npm run test:setup -- /absolute/path/to/pi/node_modules
npm test
# Optional real pi CLI/PTY regression (python3 + pi on PATH; isolated synthetic session):
npm run test:prompt-jump-pty
```

The test-only loader resolves source `.js` imports to `.ts` and enables TypeScript parameter-property transformation; production still loads through pi/jiti. Fullscreen navigation tests use `Ctrl+End` to return to the latest output.

Package entry: `package.json` → `pi.extensions` → `./extensions/grok-tui.ts`.

## License

MIT
