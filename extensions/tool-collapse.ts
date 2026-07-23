/**
 * Monkey-patch ToolExecutionComponent:
 * - Finished collapsible tools → one compact title row with green/red dots
 * - No success/error background blocks
 * - No vertical spacer / box padding on collapsed rows
 * - Consecutive collapsible tools merge into Grok-style group headers
 * - edit/write always use native expanded render
 */
import { Text } from "@earendil-works/pi-tui";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import {
  formatCollapsedToolLabel,
  formatVerbGroupLabel,
  isCollapsibleTool,
} from "./tool-titles.js";

interface ThemeLike {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
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
    paddingX?: number;
    paddingY?: number;
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
  children?: unknown[];
  ui?: { children?: unknown[] };
  hasRendererDefinition(): boolean;
  getRenderShell(): "default" | "self";
  updateDisplay(): void;
  removeChild?(c: unknown): void;
  addChild?(c: unknown): void;
}

function isToolComponent(c: unknown): c is ToolExecutionProto {
  return (
    !!c &&
    typeof c === "object" &&
    typeof (c as ToolExecutionProto).toolName === "string" &&
    typeof (c as ToolExecutionProto).updateDisplay === "function" &&
    "isPartial" in (c as object)
  );
}

function isSpacer(c: unknown): c is { lines: number; setLines?: (n: number) => void } {
  return (
    !!c &&
    typeof c === "object" &&
    typeof (c as { lines?: unknown }).lines === "number" &&
    typeof (c as { render?: unknown }).render === "function"
  );
}

/** Walk TUI tree to find the parent Container that holds `self`. */
function findParentChildren(self: ToolExecutionProto): unknown[] | null {
  const root = self.ui;
  if (!root || !Array.isArray(root.children)) return null;

  const walk = (node: unknown): unknown[] | null => {
    if (!node || typeof node !== "object") return null;
    const children = (node as { children?: unknown[] }).children;
    if (!Array.isArray(children)) return null;
    for (const child of children) {
      if (child === self) return children;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };

  return walk(root);
}

function isTitleOnlyCandidate(t: ToolExecutionProto): boolean {
  return (
    !t.isPartial &&
    t.result != null &&
    !t.expanded &&
    isCollapsibleTool(t.toolName)
  );
}

/**
 * Consecutive title-only tools around `self` in the chat child list.
 * Returns members + whether `self` is the group header (first).
 */
function consecutiveGroup(self: ToolExecutionProto): {
  members: ToolExecutionProto[];
  isHeader: boolean;
} {
  const siblings = findParentChildren(self);
  if (!siblings) {
    return { members: [self], isHeader: true };
  }

  const tools = siblings
    .map((c, i) => ({ c, i }))
    .filter((x): x is { c: ToolExecutionProto; i: number } => isToolComponent(x.c));

  const selfIdx = tools.findIndex((x) => x.c === self);
  if (selfIdx < 0) {
    return { members: [self], isHeader: true };
  }

  // Expand left/right while consecutive sibling indices and title-only
  let start = selfIdx;
  let end = selfIdx;
  while (
    start > 0 &&
    tools[start].i === tools[start - 1].i + 1 &&
    isTitleOnlyCandidate(tools[start - 1].c)
  ) {
    start -= 1;
  }
  while (
    end + 1 < tools.length &&
    tools[end + 1].i === tools[end].i + 1 &&
    isTitleOnlyCandidate(tools[end + 1].c)
  ) {
    end += 1;
  }

  // Only claim tools that are themselves title-only (self is)
  const members = tools.slice(start, end + 1).map((x) => x.c).filter(isTitleOnlyCandidate);
  if (members.length === 0) {
    return { members: [self], isHeader: true };
  }
  return { members, isHeader: members[0] === self };
}

function statusDot(theme: ThemeLike, isError: boolean): string {
  // Filled diamond-ish bullet, matches Grok screenshot feel
  const glyph = "●";
  if (isError) {
    return theme.fg("error", glyph);
  }
  // success — prefer success/accent green if present
  try {
    return theme.fg("success", glyph);
  } catch {
    return theme.fg("toolTitle", glyph);
  }
}

function clearImages(self: ToolExecutionProto): void {
  if (Array.isArray(self.imageComponents) && typeof self.removeChild === "function") {
    for (const img of self.imageComponents) {
      try {
        self.removeChild(img);
      } catch {
        /* ignore */
      }
    }
    self.imageComponents = [];
  }
  if (Array.isArray(self.imageSpacers) && typeof self.removeChild === "function") {
    for (const sp of self.imageSpacers) {
      try {
        self.removeChild(sp);
      } catch {
        /* ignore */
      }
    }
    self.imageSpacers = [];
  }
}

function setCollapsedChrome(self: ToolExecutionProto, theme: ThemeLike, line: string): void {
  // Zero spacer above tool row
  if (Array.isArray(self.children)) {
    for (const child of self.children) {
      if (isSpacer(child)) {
        if (typeof child.setLines === "function") child.setLines(0);
        else child.lines = 0;
      }
    }
  }

  // No tinted background — pass-through bgFn
  const passthrough = (t: string) => t;

  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const renderContainer =
      shell === "self" ? self.selfRenderContainer : self.contentBox;
    if (renderContainer && typeof (renderContainer as any).paddingY === "number") {
      (renderContainer as { paddingX: number; paddingY: number }).paddingX = 0;
      (renderContainer as { paddingX: number; paddingY: number }).paddingY = 0;
    }
    if (typeof renderContainer.setBgFn === "function") {
      renderContainer.setBgFn(passthrough);
    }
    renderContainer.clear();
    // Text with zero padding so one physical line, no wrap padding rows
    renderContainer.addChild(new Text(line, 0, 0) as any);
    self.hideComponent = false;
  } else {
    if (typeof self.contentText.setCustomBgFn === "function") {
      self.contentText.setCustomBgFn(passthrough);
    }
    self.contentText.setText(line);
    self.hideComponent = false;
  }

  // Avoid unused theme lint in passthrough path
  void theme;
}

function restoreNativeChrome(self: ToolExecutionProto): void {
  if (Array.isArray(self.children)) {
    for (const child of self.children) {
      if (isSpacer(child)) {
        if (typeof child.setLines === "function") child.setLines(1);
        else child.lines = 1;
      }
    }
  }
  if (self.contentBox && typeof self.contentBox.paddingY === "number") {
    self.contentBox.paddingX = 1;
    self.contentBox.paddingY = 1;
  }
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

  // Coalesce sibling refresh so one tool finishing re-lays out the whole group
  let refreshDepth = 0;

  const patchedUpdateDisplay = function (this: ToolExecutionProto) {
    try {
      const titleOnly = isTitleOnlyCandidate(this);

      if (!titleOnly) {
        restoreNativeChrome(this);
        this.hideComponent = false;
        return originalUpdateDisplay.call(this);
      }

      clearImages(this);

      const { members, isHeader } = consecutiveGroup(this);

      if (!isHeader) {
        // Folded into a group header above — hide this row entirely
        this.hideComponent = true;
        if (Array.isArray(this.children)) {
          for (const child of this.children) {
            if (isSpacer(child)) {
              if (typeof child.setLines === "function") child.setLines(0);
              else child.lines = 0;
            }
          }
        }
        // Still refresh header so its count updates when a later tool finishes
        if (refreshDepth === 0 && members.length > 1) {
          refreshDepth += 1;
          try {
            for (const m of members) {
              if (m !== this) {
                try {
                  m.updateDisplay();
                } catch {
                  /* ignore */
                }
              }
            }
          } finally {
            refreshDepth -= 1;
          }
        }
        return;
      }

      const anyError = members.some((m) => m.result?.isError === true);
      const dot = statusDot(theme, anyError);

      let label: string;
      if (members.length >= 2) {
        label = formatVerbGroupLabel(
          members.map((m) => ({
            toolName: m.toolName,
            isError: m.result?.isError === true,
          })),
        );
      } else {
        label = formatCollapsedToolLabel(this.toolName, this.args, {
          cwd: this.cwd,
          isError: this.result?.isError === true,
        });
      }

      const titleStyled = theme.fg("muted", theme.bold(label));
      const line = `${dot} ${titleStyled}`;

      setCollapsedChrome(this, theme, line);

      // Refresh other group members so they hide / re-header correctly
      if (refreshDepth === 0 && members.length > 1) {
        refreshDepth += 1;
        try {
          for (const m of members) {
            if (m !== this) {
              try {
                m.updateDisplay();
              } catch {
                /* ignore sibling refresh */
              }
            }
          }
        } finally {
          refreshDepth -= 1;
        }
      }
    } catch {
      try {
        restoreNativeChrome(this);
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
