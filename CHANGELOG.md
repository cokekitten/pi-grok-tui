# Changelog

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
