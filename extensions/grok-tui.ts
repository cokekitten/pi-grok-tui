/**
 * pi-grok-tui — Grok-flavored pi TUI (display-only).
 *
 * Thinking: live 3-line scroll → Thought · click (fullscreen) or ⌥T / Alt+T / Ctrl+Shift+H
 * Tools: Grok titles, grouping, click-to-fold (fullscreen), Ctrl+O compact/preview/full
 * User: #0f1217 bubble + ❯ arrow; response rows indented to match
 *
 * Does not alter session data or model I/O.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installCompactionStylePatch } from "./compaction-style.js";
import { installCustomMessageCollapsePatch } from "./custom-message-collapse.js";
import { installEditorDockPatch } from "./editor-dock.js";
import { installParentStamp } from "./parent-stamp.js";
import { installClickFoldPatch, resetFoldHandlers } from "./click-fold.js";
import { clearFoldRegistry } from "./fold-body.js";
import { installSkillFlatPatch } from "./skill-flat.js";
import { getState, resetClickFoldSession } from "./state.js";
import { applyGlobalThinkingToggle } from "./thinking-click.js";
import {
  isThinkingExpandInput,
  thinkingExpandShortcutIds,
} from "./thinking-keys.js";
import { installThinkingPatch } from "./thinking-patch.js";
import { installToolCollapsePatch } from "./tool-collapse.js";
import { installToolViewCyclePatch } from "./tool-view-cycle.js";
import { installUserMessageStylePatch } from "./user-message-style.js";

async function installPatch(): Promise<() => void> {
  // Click intercept first so chrome render sees clickFoldReady on the first paint.
  let cleanupClick: (() => void) | undefined;
  try {
    cleanupClick = installClickFoldPatch();
  } catch (error) {
    console.warn(
      "pi-grok-tui: click-fold patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  // Parent stamp first so subsequent UI builds record siblings for spacing.
  const cleanupStamp = installParentStamp();
  const cleanupThinking = await installThinkingPatch();
  const cleanupEditorDock = installEditorDockPatch();
  let cleanupTools: (() => void) | undefined;
  let cleanupCustom: (() => void) | undefined;
  let cleanupCompaction: (() => void) | undefined;
  let cleanupCycle: (() => void) | undefined;
  let cleanupSkill: (() => void) | undefined;
  let cleanupUser: (() => void) | undefined;
  try {
    cleanupTools = await installToolCollapsePatch();
  } catch (error) {
    console.warn(
      "pi-grok-tui: tool collapse patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    cleanupCustom = await installCustomMessageCollapsePatch();
  } catch (error) {
    console.warn(
      "pi-grok-tui: custom message collapse patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    cleanupCompaction = await installCompactionStylePatch();
  } catch (error) {
    console.warn(
      "pi-grok-tui: compaction style patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    cleanupSkill = await installSkillFlatPatch();
  } catch (error) {
    console.warn(
      "pi-grok-tui: skill flat patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    cleanupCycle = await installToolViewCyclePatch();
  } catch (error) {
    console.warn(
      "pi-grok-tui: tool view cycle patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    cleanupUser = await installUserMessageStylePatch();
  } catch (error) {
    console.warn(
      "pi-grok-tui: user message style patch failed:",
      error instanceof Error ? error.message : error,
    );
  }
  return () => {
    cleanupThinking();
    cleanupTools?.();
    cleanupCustom?.();
    cleanupCompaction?.();
    cleanupSkill?.();
    cleanupCycle?.();
    cleanupUser?.();
    cleanupEditorDock();
    cleanupStamp();
    cleanupClick?.();
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

type ToggleCtx = {
  hasUI?: boolean;
  ui?: {
    notify?: (msg: string, level?: string) => void;
    setStatus?: (key: string, text: string | undefined) => void;
    setWidget?: (key: string, content: undefined) => void;
    onTerminalInput?: (
      handler: (data: string) => { consume?: boolean } | undefined,
    ) => () => void;
  };
};

function requestEditorDockRender(ctx?: ToggleCtx): void {
  try {
    // Removing a non-existent widget is a side-effect-free way to ask pi's UI
    // for a fresh render after the process-global TUI patch is installed.
    ctx?.ui?.setWidget?.("pi-grok-tui:editor-dock-refresh", undefined);
  } catch {
    /* ignore */
  }
}

function toggleThinkingExpand(ctx?: ToggleCtx): void {
  const expanded = applyGlobalThinkingToggle();
  const msg = expanded
    ? "Thinking expanded (⌥T / Alt+T / Ctrl+Shift+H)"
    : "Thinking collapsed (⌥T / Alt+T / Ctrl+Shift+H)";
  try {
    // setStatus is lightweight footer text; notify also re-renders chat so
    // ThinkingScrollComponent re-reads globalExpanded.
    ctx?.ui?.setStatus?.("pi-grok-tui", msg);
    ctx?.ui?.notify?.(msg, "info");
  } catch {
    /* ignore */
  }
}

export default function (pi: ExtensionAPI) {
  let degraded = false;
  let terminalInputUnsub: (() => void) | undefined;

  const detachTerminalInput = () => {
    try {
      terminalInputUnsub?.();
    } catch {
      /* ignore */
    }
    terminalInputUnsub = undefined;
  };

  const attachTerminalInput = (ctx: ToggleCtx) => {
    detachTerminalInput();
    if (!ctx.hasUI || typeof ctx.ui?.onTerminalInput !== "function") return;

    // Raw input path — required for macOS Option+T ("†"), which pi.registerShortcut
    // cannot match (matchesKey rejects non a–z single chars).
    terminalInputUnsub = ctx.ui.onTerminalInput((data) => {
      if (!isThinkingExpandInput(data)) return undefined;
      toggleThinkingExpand(ctx);
      return { consume: true };
    });
  };

  // Best-effort: alt+t / ctrl+shift+h when the terminal actually emits them.
  // "†" is intentionally NOT registered here — matchesKey never matches it.
  for (const id of thinkingExpandShortcutIds()) {
    pi.registerShortcut(id, {
      description: "Toggle all thinking expand/collapse",
      handler: (ctx) => {
        toggleThinkingExpand(ctx);
      },
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    const state = getState();
    state.activeByTimestamp.clear();
    state.globalExpanded = false;
    resetClickFoldSession();
    resetFoldHandlers();
    clearFoldRegistry();

    // Re-bind raw Option+T listener every session (rebind clears UI listeners).
    try {
      attachTerminalInput(ctx);
    } catch {
      /* ignore */
    }

    // Patches are process-global (prototype monkey-patches). Keep them across
    // resume so renderBeforeBind sees them; only reinstall when missing/broken.
    if (state.patchCleanup && state.patchRelease) {
      degraded = false;
      requestEditorDockRender(ctx);
      return;
    }

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
      requestEditorDockRender(ctx);
    } catch (error) {
      // Never throw — extension onError paints a red stack into the chat.
      degraded = true;
      if (ctx.hasUI) {
        try {
          ctx.ui.notify(
            `pi-grok-tui: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        } catch {
          /* ignore */
        }
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
    resetClickFoldSession();
    resetFoldHandlers();
    clearFoldRegistry();
    detachTerminalInput();

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
