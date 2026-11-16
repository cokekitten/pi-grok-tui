# Changelog

## [0.3.9] - 2026-11-16

### Added

- Turn work rollup with total duration: automatically merges contiguous stacks of ≥2 finished work blocks (`Thought`, tools, `codemode` nested calls, `subagent`, and custom chrome rows — including leading `Thought` blocks inside the prose message) into a single clickable `◇ Thought · Read …, Wrote …, Ran … · <duration>` summary row once closed by assistant prose OR by an interrupting user message / turn boundary, while keeping in-progress turns at the tail expanded live; expanding the rollup renders inner `codemode` blocks in compact single-line form, and clicking the top `◇` header folds the stack back.
- Transparent 2-zone `codemode` rendering: keeps the `├─ / └─` nested call list visible throughout active turn execution until the turn closes, leniently parses 200-char truncated JSON `args` previews, and splits expanded `codemode` blocks into two independent fullscreen hover/click zones — clicking the **title row** collapses directly to 1 line, while clicking the **lower call-list / script body** cycles the 3-state view (`collapsed` → `calls` → `full` with preserved `CodeHighlighter` JS syntax colors) without merging sibling `codemode` rows into `◇ Ran N tools`.

### Fixed

- Re-open fold hyperlinks across Pi 1.5 `ScrollView` / `compositeTuiLine` leading `SEGMENT_RESET` (`ESC[0m` + bare OSC 8 close at column 0) in `injectFoldRow` so fullscreen mouse clicks reliably hit fold targets when the scrollbar is active, and lazily self-heal pre-existing `AssistantMessageComponent` instances on first paint after `/reload`.
- Collapse extension-rendered `CustomMessageComponent` and `CustomEntryComponent` blocks (`pi-subagents` supervisor requests, `subagent_supervisor_reply` custom entries, steering/watchdog/slash notices, `pi-intercom` cards, and background-task notices) to a single Grok `◇` chrome row in compact mode instead of painting native purple `customMessageBg` boxes or multi-line wireframe cards.
- Re-style pre-existing `ToolExecutionComponent`, `CustomMessageComponent`, and `CustomEntryComponent` instances lazily on their first paint after `/reload` (and re-stamp `chatContainer` children populated before `session_start` re-installs patches), fixing purple `[subagent]` blocks surviving `/reload`.
- Strip `customMessageBg`, unwrap inner `MouseRegion` / `handleMouse` interceptors, and attach full-block fold markers when expanded via fullscreen click or `Ctrl+O`, while keeping tight 1-line chrome stacking and 1-line body gaps synchronized across sibling tool/custom toggles.
- Make `InteractiveMode.setToolsExpanded(false)` a no-op when tools are already collapsed (`chrome` / `truncated`), matching native Pi so extensions like `pi-subagents` calling `ctx.ui.setToolsExpanded(false)` on every `subagent` run no longer wipe per-row click expansions or trigger a full-chat relayout, and keep a click-expanded standalone tool open if a consecutive collapsible tool joins its run.

## [0.3.8] - 2026-11-15

### Fixed

- Cache rendered line arrays across fullscreen scroll frames for `clickableChromeChild`, `wrapFoldBodyComponent`, marked `Text` fold bodies, `UserMessageComponent` boundary anchors, and the `prompt-jump` top strip, and clear stale `hoveredFoldId` on wheel input. Previously every scroll frame re-ran `truncateToWidth` (`Intl.Segmenter`), fold-marker regexes, and array/string allocations across every off-screen tool and custom message in the transcript (`doc.render` ~10.9ms → ~1.9ms on a 736-entry session, bringing full `doRender` from ~19.4ms down to native Pi's ~9.8ms).

## [0.3.7] - 2026-11-15

### Fixed

- Chrome mode no longer replaces a custom message that an extension renders itself. The collapse patch cleared `CustomMessageComponent.customComponent` and drew `[customType] first line` for every `custom_message`, which bypassed Pi's registered message renderers: pi-subagents supervisor requests showed as `[subagent_supervisor_request] Subagent needs a supervisor decision. Run: …` instead of `[subagent] worker needs a decision`, pi-intercom cards lost their layout, and both lost their request body beyond 72 characters. The patch now runs the renderer first and only falls back to the one-line chrome row when no renderer is registered or it declines to render. Messages without a renderer (background tasks, web search notices) still collapse to one line.

## [0.3.6] - 2026-11-14

### Fixed

- Collapsing an image-bearing tool result no longer leaves Pi's image caches out of sync. Pi 1.5 re-adds images with `previousImages[index]` whenever `imageSources[index]` still matches, so chrome mode dropping the images while keeping the sources made `updateDisplay` push `undefined` into the component's children — the next paint died with `TypeError: Cannot read properties of undefined (reading 'render')` inside `Container.render`. `imageSources` is now cleared with the images, and any undefined child is dropped before paint as a last line of defence.

## [0.3.5] - 2026-11-04

### Fixed

- Preserve Pi 1.5's streaming Markdown block/highlight caches by reusing assistant text and thinking components. Theme invalidation still refreshes cached colors.
- Consume deferred tool argument batches in compact/grouped tool views, avoiding redundant updates on later frames.
- Restore Markdown transformer chains for user bubbles, assistant text and visible thinking, including exact content width, streaming/final transitions and saved session-entry metadata. Transformer failures no longer prevent subsequent transformers from running.
- Adapt regression tests to deferred write rendering and the current fullscreen Ctrl+End binding.

### Added

- Reproducible local test-host setup that follows the managed Pi version (or accepts an explicit node_modules path), without bundling host peer dependencies.
- Package changelog for Pi 1.5's Extension Updates notices.

## [0.3.4] - 2026-10-17

- Preserve the native incremental write syntax-highlight cache when restyling tool output.
