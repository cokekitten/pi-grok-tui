# Jump-to-bottom Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. This plan is executed in the same session.

**Goal:** Fullscreen Claude-style `Jump to bottom (click) ↓` pill on the last transcript row when not following output.

**Architecture:** Pure placement/hit-span helpers; paint via `applySearchHighlights`; click via bounded OSC 9999 + existing fold URL dispatch to `scrollToBottom()`.

**Tech Stack:** TypeScript pi extension, node:test.

## Global Constraints

- Fullscreen only; regular TUI unchanged
- Overlay last primary-scroll row; no dock/layout shift
- Copy exactly ` Jump to bottom (click) ↓ `
- Click pill cells only
- Display-only; no pi-mono edits

---

### Task 1: Pure core + bounded hit injection + paint patch

**Files:** `extensions/jump-bottom-core.ts`, `extensions/jump-bottom.ts`, `extensions/click-fold.ts`, `extensions/grok-tui.ts`, `jump-bottom.test.mjs`, `package.json`, `README.md`

- [x] Failing tests first
- [x] Minimal implementation
- [x] `npm test`
- [x] Commit
