/**
 * Monkey-patch ToolExecutionComponent so finished collapsible tools
 * render as a single Grok-style title row + (Ctrl+O).
 * edit/write always use native expanded render.
 */
import { Text } from "@earendil-works/pi-tui";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import {
  formatCollapsedToolLabel,
  isCollapsibleTool,
} from "./tool-titles.js";

interface ThemeLike {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
  muted?: (text: string) => string;
}

interface ToolExecutionProto {
  toolName: string;
  args: unknown;
  cwd: string;
  expanded: boolean;
  isPartial: boolean;
  result?: { isError?: boolean; content?: unknown; details?: unknown };
  hideComponent: boolean;
  contentBox: {
    clear(): void;
    addChild(c: unknown): void;
    setBgFn?(fn: (text: string) => string): void;
  };
  contentText: {
    setText(t: string): void;
    setCustomBgFn?(fn: (text: string) => string): void;
  };
  selfRenderContainer: {
    clear(): void;
    addChild(c: unknown): void;
  };
  imageComponents: unknown[];
  imageSpacers: unknown[];
  hasRendererDefinition(): boolean;
  getRenderShell(): "default" | "self";
  updateDisplay(): void;
  removeChild?(c: unknown): void;
}

export async function installToolCollapsePatch(): Promise<() => void> {
  const [
    { ToolExecutionComponent: rawTec },
    { theme: rawTheme },
  ] = await Promise.all([
    importInternal<{ ToolExecutionComponent: unknown }>(
      PI_CODING_AGENT,
      INTERNAL_MODULES.toolExecution,
    ),
    importInternal<{ theme: unknown }>(PI_CODING_AGENT, INTERNAL_MODULES.theme),
  ]);

  if (!rawTec || (typeof rawTec !== "function" && typeof rawTec !== "object")) {
    throw new Error("thinking-scroll: ToolExecutionComponent missing");
  }

  const Tec = rawTec as { prototype: ToolExecutionProto };
  const prototype = Tec.prototype;
  const theme = rawTheme as ThemeLike;

  if (typeof prototype.updateDisplay !== "function") {
    throw new Error("thinking-scroll: ToolExecutionComponent.updateDisplay missing");
  }

  const originalUpdateDisplay = prototype.updateDisplay;

  const patchedUpdateDisplay = function (this: ToolExecutionProto) {
    try {
      const finished = !this.isPartial && this.result != null;
      const titleOnly =
        finished &&
        !this.expanded &&
        isCollapsibleTool(this.toolName);

      if (!titleOnly) {
        return originalUpdateDisplay.call(this);
      }

      const isError = this.result?.isError === true;
      const bgFn = isError
        ? (text: string) => theme.bg("toolErrorBg", text)
        : (text: string) => theme.bg("toolSuccessBg", text);

      // Drop any attached images from prior expanded/partial renders
      if (Array.isArray(this.imageComponents) && typeof this.removeChild === "function") {
        for (const img of this.imageComponents) {
          try {
            this.removeChild(img);
          } catch {
            /* ignore */
          }
        }
        this.imageComponents = [];
      }
      if (Array.isArray(this.imageSpacers) && typeof this.removeChild === "function") {
        for (const sp of this.imageSpacers) {
          try {
            this.removeChild(sp);
          } catch {
            /* ignore */
          }
        }
        this.imageSpacers = [];
      }

      const label = formatCollapsedToolLabel(this.toolName, this.args, {
        cwd: this.cwd,
        isError,
      });
      const titleStyled = theme.fg("toolTitle", theme.bold(label));
      const hint = theme.fg("muted", " (Ctrl+O)");
      const line = `${titleStyled}${hint}`;

      if (this.hasRendererDefinition()) {
        const shell = this.getRenderShell();
        const renderContainer =
          shell === "self" ? this.selfRenderContainer : this.contentBox;
        if (typeof renderContainer.setBgFn === "function") {
          renderContainer.setBgFn(bgFn);
        }
        renderContainer.clear();
        renderContainer.addChild(new Text(line, 0, 0) as any);
        this.hideComponent = false;
      } else {
        if (typeof this.contentText.setCustomBgFn === "function") {
          this.contentText.setCustomBgFn(bgFn);
        }
        this.contentText.setText(line);
        this.hideComponent = false;
      }
    } catch {
      try {
        originalUpdateDisplay.call(this);
      } catch {
        /* unrecoverable */
      }
    }
  };

  prototype.updateDisplay = patchedUpdateDisplay as any;

  return () => {
    prototype.updateDisplay = originalUpdateDisplay;
  };
}
