/**
 * Ctrl+O multi-state cycle:
 *   chrome (one-line titles) → truncated (pi default partial) → full → chrome
 *
 * Patches InteractiveMode.toggleToolOutputExpansion / setToolsExpanded so the
 * existing app.tools.expand keybinding drives the cycle.
 */
import {
  importInternal,
  PI_CODING_AGENT,
} from "./internal-import.js";
import {
  clearToolFoldOverrides,
  cycleToolViewMode,
  getState,
  getToolViewMode,
  toolViewModeLabel,
  type ToolViewMode,
} from "./state.js";

interface Expandable {
  setExpanded?(expanded: boolean): void;
  updateDisplay?(): void;
  rebuild?(): void;
  toolName?: string;
}

interface InteractiveModeLike {
  toolOutputExpanded: boolean;
  customHeader?: Expandable;
  builtInHeader?: Expandable;
  loadedResourcesContainer?: { children?: Expandable[] };
  chatContainer?: { children?: Expandable[] };
  ui?: { requestRender?: () => void };
  showStatus?(message: string): void;
  toggleToolOutputExpansion?(): void;
  setToolsExpanded?(expanded: boolean): void;
}

function isExpandable(c: unknown): c is Expandable {
  return (
    !!c &&
    typeof c === "object" &&
    typeof (c as Expandable).setExpanded === "function"
  );
}

interface Relayoutable {
  toolName?: string;
  lastMessage?: unknown;
  updateContent?: (msg: unknown) => void;
  setExpanded?: (expanded: boolean) => void;
  updateDisplay?: () => void;
  rebuild?: () => void;
  contentContainer?: unknown;
}

function isRelayoutable(c: unknown): c is Relayoutable {
  return !!c && typeof c === "object";
}

/**
 * Recompute Thought/assistant lead spacers after tool expand/collapse.
 * Lead gap depends on whether the previous tool shows a body (non-chrome).
 */
function relayoutAssistantMessages(im: InteractiveModeLike): void {
  const children = im.chatContainer?.children;
  if (!children) return;
  for (const child of children) {
    if (!isRelayoutable(child)) continue;
    // Skip tools — already refreshed via setExpanded → updateDisplay
    if (typeof child.toolName === "string") continue;
    if (
      typeof child.updateContent === "function" &&
      child.lastMessage != null &&
      child.contentContainer != null
    ) {
      try {
        child.updateContent(child.lastMessage);
      } catch {
        /* ignore */
      }
    }
  }
}

function applyToolViewMode(im: InteractiveModeLike, mode: ToolViewMode): void {
  // Keep pi's boolean roughly in sync for newly created components.
  im.toolOutputExpanded = mode === "full";

  const headerExpanded = mode !== "chrome";
  const activeHeader = im.customHeader ?? im.builtInHeader;
  if (isExpandable(activeHeader)) {
    activeHeader.setExpanded?.(headerExpanded);
  }

  for (const container of [im.loadedResourcesContainer, im.chatContainer]) {
    if (!container?.children) continue;
    for (const child of container.children) {
      if (!isExpandable(child)) continue;

      const isTool = typeof child.toolName === "string";
      if (isTool) {
        // setExpanded already calls updateDisplay — do not call it again
        try {
          child.setExpanded?.(mode === "full");
        } catch {
          /* ignore */
        }
      } else {
        // Custom messages: one-line only in chrome; preview/full show body
        try {
          child.setExpanded?.(mode !== "chrome");
          // setExpanded on custom already rebuilds; only rebuild if no setExpanded path
          if (typeof child.setExpanded !== "function") {
            child.rebuild?.();
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Thought rows keep a lead Spacer based on prev tool body visibility.
  // Without this, Ctrl+O leaves Thought stuck to expanded tool output
  // (or leaves a stale blank after collapsing back to chrome).
  relayoutAssistantMessages(im);

  try {
    im.ui?.requestRender?.();
  } catch {
    /* ignore */
  }
}

export async function installToolViewCyclePatch(): Promise<() => void> {
  const mod = await importInternal<{ InteractiveMode?: unknown }>(
    PI_CODING_AGENT,
    "dist/modes/interactive/interactive-mode.js",
  );

  const IM = mod.InteractiveMode as
    | { prototype: InteractiveModeLike }
    | undefined;
  if (!IM?.prototype) {
    throw new Error("pi-grok-tui: InteractiveMode missing");
  }

  const proto = IM.prototype;
  const originalToggle = proto.toggleToolOutputExpansion;
  const originalSet = proto.setToolsExpanded;

  if (typeof originalToggle !== "function" || typeof originalSet !== "function") {
    throw new Error("pi-grok-tui: expand toggle methods missing");
  }

  proto.toggleToolOutputExpansion = function (this: InteractiveModeLike) {
    clearToolFoldOverrides();
    const mode = cycleToolViewMode();
    applyToolViewMode(this, mode);
    try {
      this.showStatus?.(
        `Tools view: ${toolViewModeLabel(mode)} · Ctrl+O to cycle`,
      );
    } catch {
      /* ignore */
    }
  };

  // Absolute set from elsewhere: true → full, false → chrome
  proto.setToolsExpanded = function (
    this: InteractiveModeLike,
    expanded: boolean,
  ) {
    clearToolFoldOverrides();
    const stateMode: ToolViewMode = expanded ? "full" : "chrome";
    getState().toolViewMode = stateMode;
    applyToolViewMode(this, stateMode);
  };

  // Ensure default mode is chrome on install
  if (!getToolViewMode()) {
    getState().toolViewMode = "chrome";
  }

  return () => {
    proto.toggleToolOutputExpansion = originalToggle;
    proto.setToolsExpanded = originalSet;
  };
}
