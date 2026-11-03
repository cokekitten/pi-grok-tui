# Changelog

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
