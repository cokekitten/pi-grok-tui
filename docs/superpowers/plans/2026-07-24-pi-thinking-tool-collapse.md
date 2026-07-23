# Compact Thinking + Tool Title Collapse Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Compact thinking chrome (3-line live, finished `已思考 (Alt+T)`) and Grok-style title-only collapse for non-edit tools after finish.

**Architecture:** Display-only monkey-patches on pi internal TUI components; pure title helpers unit-tested.

**Tech Stack:** TypeScript pi extension, node:test for pure helpers.

## Global Constraints

- Display-only (no session/model changes)
- Alt+T = thinking only; Ctrl+O = tools (pi native)
- edit/write always native expanded; other tools title-only when finished + collapsed
- Thinking finished title: `已思考 (Alt+T)`
- Live thinking max 3 lines

### Task 1: tool-titles pure module + tests
### Task 2: thinking render (3 lines + title collapse)
### Task 3: tool-collapse patch
### Task 4: wire entry + README
### Task 5: test + commit
