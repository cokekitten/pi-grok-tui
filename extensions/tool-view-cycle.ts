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
        // full → expanded true; chrome/truncated → false (chrome uses title-only)
        child.setExpanded?.(mode === "full");
        try {
          child.updateDisplay?.();
        } catch {
          /* ignore */
        }
      } else {
        // Custom messages: one-line only in chrome; preview/full show body
        child.setExpanded?.(mode !== "chrome");
        try {
          child.rebuild?.();
        } catch {
          /* ignore */
        }
      }
    }
  }

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
    throw new Error("thinking-scroll: InteractiveMode missing");
  }

  const proto = IM.prototype;
  const originalToggle = proto.toggleToolOutputExpansion;
  const originalSet = proto.setToolsExpanded;

  if (typeof originalToggle !== "function" || typeof originalSet !== "function") {
    throw new Error("thinking-scroll: expand toggle methods missing");
  }

  proto.toggleToolOutputExpansion = function (this: InteractiveModeLike) {
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
