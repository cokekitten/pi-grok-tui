/**
 * Monkey-patch ToolExecutionComponent:
 * - Finished collapsible tools → compact Grok-style chrome row
 * - True green/red diamonds (not theme olive "success")
 * - Group consecutive collapsible tools
 * - edit/write always native expanded
 */
import { Text } from "@earendil-works/pi-tui";
import { formatChromeLine, type ChromeTheme } from "./chrome.js";
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

interface ThemeLike extends ChromeTheme {
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

/** Still streaming / not yet finalized. */
function isToolRunning(t: ToolExecutionProto): boolean {
  return t.isPartial || t.result == null;
}

/**
 * Collapsible tools (everything except edit/write) are title-only whenever
 * collapsed — including while running. Process/output is hidden until Ctrl+O.
 */
function isTitleOnlyCandidate(t: ToolExecutionProto): boolean {
  return !t.expanded && isCollapsibleTool(t.toolName);
}

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

  const members = tools
    .slice(start, end + 1)
    .map((x) => x.c)
    .filter(isTitleOnlyCandidate);
  if (members.length === 0) {
    return { members: [self], isHeader: true };
  }
  return { members, isHeader: members[0] === self };
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

function setCollapsedChrome(self: ToolExecutionProto, line: string): void {
  if (Array.isArray(self.children)) {
    for (const child of self.children) {
      if (isSpacer(child)) {
        if (typeof child.setLines === "function") child.setLines(0);
        else child.lines = 0;
      }
    }
  }

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
    renderContainer.addChild(new Text(line, 0, 0) as any);
    self.hideComponent = false;
  } else {
    if (typeof self.contentText.setCustomBgFn === "function") {
      self.contentText.setCustomBgFn(passthrough);
    }
    self.contentText.setText(line);
    self.hideComponent = false;
  }
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

function refreshSiblings(
  self: ToolExecutionProto,
  members: ToolExecutionProto[],
  refreshDepth: { n: number },
): void {
  if (refreshDepth.n > 0 || members.length <= 1) return;
  refreshDepth.n += 1;
  try {
    for (const m of members) {
      if (m !== self) {
        try {
          m.updateDisplay();
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    refreshDepth.n -= 1;
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
  const refreshDepth = { n: 0 };

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
        this.hideComponent = true;
        if (Array.isArray(this.children)) {
          for (const child of this.children) {
            if (isSpacer(child)) {
              if (typeof child.setLines === "function") child.setLines(0);
              else child.lines = 0;
            }
          }
        }
        refreshSiblings(this, members, refreshDepth);
        return;
      }

      const failed = members.filter(
        (m) => !isToolRunning(m) && m.result?.isError === true,
      ).length;
      const anyError = failed > 0;
      const anyRunning = members.some(isToolRunning);

      let line: string;
      if (members.length >= 2) {
        // Grok group: hollow diamond + aggregated label; failed as red suffix
        const base = formatVerbGroupLabel(
          members.map((m) => ({
            toolName: m.toolName,
            isError: !isToolRunning(m) && m.result?.isError === true,
          })),
        );
        // Strip trailing " · N failed" so we can color it separately
        const failedMatch = base.match(/^(.*?)( · \d+ failed)$/);
        const label = failedMatch ? failedMatch[1]! : base;
        const failedSuffix = failedMatch ? failedMatch[2]! : undefined;
        line = formatChromeLine(theme, {
          kind: anyError ? "group_err" : "group",
          label,
          failedSuffix,
          hint: " (Ctrl+O)",
        });
      } else {
        const label = formatCollapsedToolLabel(this.toolName, this.args, {
          cwd: this.cwd,
        });
        const kind = anyRunning
          ? "tool_run"
          : anyError
            ? "tool_err"
            : "tool_ok";
        line = formatChromeLine(theme, {
          kind,
          label,
          hint: " (Ctrl+O)",
        });
      }

      setCollapsedChrome(this, line);
      refreshSiblings(this, members, refreshDepth);
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
