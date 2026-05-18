# pi-thinking-scroll

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that replaces the default thinking renderer with a compact scrolling TUI view.

## Features

- Replaces pi's default thinking block renderer in the TUI.
- While the model is thinking, shows a live scrolling view with at most 5 visible lines.
- During active thinking, Markdown rendering is preserved, including inline code and code blocks.
- After thinking finishes:
  - Thinking with 3 or fewer lines stays visible.
  - Longer thinking collapses to a 3-line Markdown-rendered preview.
  - The collapsed preview flattens original line breaks into a compact paragraph.
- Press `Alt+T` to expand/collapse all thinking blocks.
- Only changes TUI rendering. It does not modify LLM context, provider payloads, session messages, or stored conversation data.

## Install

From GitHub:

```bash
pi install git:github.com/cokekitten/pi-thinking-scroll
```

Or try it for one run without installing:

```bash
pi -e git:github.com/cokekitten/pi-thinking-scroll
```

After installing, restart pi or run `/reload`.

## Usage

Just use pi normally with a reasoning/thinking model.

- Active thinking: compact scrolling renderer.
- Completed short thinking: visible inline.
- Completed long thinking: collapsed to a 3-line preview.
- `Alt+T`: toggle all thinking blocks expanded/collapsed.

## Notes

This extension monkey-patches pi's internal `AssistantMessageComponent` rendering method. That makes it possible to fully replace the built-in thinking renderer, but it also means the extension may need updates if pi changes its internal TUI implementation.

The extension is intentionally display-only:

- It does not alter messages saved in session files.
- It does not alter model requests or responses.
- It does not affect context construction.
- It does not change tool calls or tool results.

## Development

Clone the repository and load it as a local pi package:

```bash
pi install /path/to/pi-thinking-scroll
```

Or run once:

```bash
pi -e /path/to/pi-thinking-scroll
```

Package resources are declared in `package.json` under the `pi.extensions` field.

## License

MIT
