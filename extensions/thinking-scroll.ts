/**
 * thinking-scroll — compact thinking + collapsed tool titles for pi.
 *
 * Thinking:
 *   1. Live 3-line scrolling view while streaming
 *   2. Finished → single row `Thought (Alt+T)`
 *   3. Alt+T expands/collapses all thinking
 *
 * Tools:
 *   - Running: native live output
 *   - Finished collapsible (not edit/write): Grok-style title + (Ctrl+O)
 *   - edit/write: always native expanded (Grok Edit default)
 *   - Ctrl+O: pi native tool expand
 *
 * Display-only. Does not alter session data or model I/O.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { getState } from "./state.js";
import { installThinkingPatch } from "./thinking-patch.js";
import { installToolCollapsePatch } from "./tool-collapse.js";

async function installPatch(): Promise<() => void> {
  const cleanupThinking = await installThinkingPatch();
  let cleanupTools: (() => void) | undefined;
  try {
    cleanupTools = await installToolCollapsePatch();
  } catch (error) {
    // Tools patch is best-effort; thinking still works.
    console.warn(
      "thinking-scroll: tool collapse patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  return () => {
    cleanupThinking();
    cleanupTools?.();
  };
}

export async function retainPatch(): Promise<() => Promise<void>> {
  const state = getState();
  state.patchRefCount++;

  let cleanup = state.patchCleanup;
  if (!cleanup) {
    const existingPromise = state.patchInstallPromise;
    const promise = existingPromise ?? installPatch();
    if (!existingPromise) state.patchInstallPromise = promise;
    try {
      cleanup = await promise;
      if (!state.patchCleanup) state.patchCleanup = cleanup;
    } catch (error) {
      state.patchRefCount--;
      throw error;
    } finally {
      if (state.patchInstallPromise === promise) {
        state.patchInstallPromise = undefined;
      }
    }
  }

  let released = false;
  return async () => {
    if (released) return;
    state.patchRefCount = Math.max(0, state.patchRefCount - 1);
    if (state.patchRefCount > 0) {
      released = true;
      return;
    }
    const c = state.patchCleanup;
    if (!c) {
      released = true;
      return;
    }
    if (state.patchCleanup === c) state.patchCleanup = undefined;
    try {
      c();
      released = true;
    } catch (error) {
      state.patchRefCount++;
      if (!state.patchCleanup) state.patchCleanup = c;
      throw error;
    }
  };
}

export default function (pi: ExtensionAPI) {
  let degraded = false;

  pi.registerShortcut(Key.alt("t"), {
    description: "Toggle all thinking expand/collapse",
    handler: async (ctx) => {
      const state = getState();
      state.globalExpanded = !state.globalExpanded;
      if (ctx.hasUI) {
        ctx.ui.notify(
          state.globalExpanded ? "All thinking expanded" : "All thinking collapsed",
          "info",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const state = getState();
    state.activeByTimestamp.clear();
    state.globalExpanded = false;
    if (state.patchCleanup && state.patchRelease) return;
    if (state.patchCleanup && !state.patchRelease) {
      try {
        state.patchCleanup();
      } catch {
        /* ignore */
      } finally {
        state.patchCleanup = undefined;
        state.patchInstallPromise = undefined;
        state.patchRefCount = 0;
      }
    }

    try {
      state.patchRelease = await retainPatch();
      degraded = false;
    } catch (error) {
      degraded = true;
      if (ctx.hasUI) {
        ctx.ui.notify(
          `thinking-scroll: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
  });

  pi.on("message_update", async (event) => {
    if (degraded || event.message.role !== "assistant") return;

    const assistantEvent = event.assistantMessageEvent as
      | { type?: string; contentIndex?: number }
      | undefined;
    const state = getState();
    const ts = event.message.timestamp;
    const type = assistantEvent?.type;

    if (type === "thinking_start" || type === "thinking_delta") {
      state.activeByTimestamp.set(ts, {
        messageTimestamp: ts,
        contentIndex:
          typeof assistantEvent?.contentIndex === "number"
            ? assistantEvent.contentIndex
            : -1,
      });
      return;
    }

    if (
      type === "thinking_end" ||
      type === "text_start" ||
      type === "text_delta" ||
      type === "text_end" ||
      type === "toolcall_start" ||
      type === "toolcall_delta" ||
      type === "toolcall_end"
    ) {
      state.activeByTimestamp.delete(ts);
    }
  });

  pi.on("message_end", async (event) => {
    if (degraded || event.message.role !== "assistant") return;
    getState().activeByTimestamp.delete(event.message.timestamp);
  });

  pi.on("agent_end", async () => {
    getState().activeByTimestamp.clear();
  });

  pi.on("session_shutdown", async (event) => {
    const state = getState();
    state.activeByTimestamp.clear();
    state.globalExpanded = false;

    if ((event.reason === "reload" || event.reason === "quit") && state.patchRelease) {
      try {
        await state.patchRelease();
      } catch {
        /* ignore */
      } finally {
        state.patchRelease = undefined;
        state.patchCleanup = undefined;
        state.patchInstallPromise = undefined;
        state.patchRefCount = 0;
      }
    }
  });
}
