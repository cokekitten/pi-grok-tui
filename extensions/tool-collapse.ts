/**
 * Monkey-patch ToolExecutionComponent:
 * - chrome mode: one-line Grok titles + grouping
 * - truncated/full: native body but NO success/error color blocks
 * - status only via leading ◆ dots (same colors as chrome mode)
 * - tight spacing between consecutive tools
 */
import { Text } from "@earendil-works/pi-tui";
import {
  chromeGlyph,
  colorGlyph,
  formatChromeLine,
  type ChromeTheme,
} from "./chrome.js";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import { getPreviousSibling, getSiblings, shouldGapAfter } from "./parent-stamp.js";
import { getToolViewMode } from "./state.js";
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
    children?: unknown[];
  };
  contentText: {
    setText(t: string): void;
    setCustomBgFn?(fn: (text: string) => string): void;
    text?: string;
  };
  selfRenderContainer: {
    clear(): void;
    addChild(c: unknown): void;
    children?: unknown[];
  };
  imageComponents: unknown[];
  imageSpacers: unknown[];
  children?: unknown[];
  ui?: { children?: unknown[] };
  hasRendererDefinition(): boolean;
  getRenderShell(): "default" | "self";
  updateDisplay(): void;
  setExpanded?(expanded: boolean): void;
  removeChild?(c: unknown): void;
  addChild?(c: unknown): void;
}

const STATUS_DOT_MARK = "__piStatusDot";
const passthrough = (t: string) => t;

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
  const stamped = getSiblings(self);
  if (stamped) return stamped;

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

function isToolRunning(t: ToolExecutionProto): boolean {
  return t.isPartial || t.result == null;
}

function statusKind(t: ToolExecutionProto): "tool_run" | "tool_ok" | "tool_err" {
  if (isToolRunning(t)) return "tool_run";
  if (t.result?.isError === true) return "tool_err";
  return "tool_ok";
}

function isTitleOnlyCandidate(t: ToolExecutionProto): boolean {
  return getToolViewMode() === "chrome" && isCollapsibleTool(t.toolName);
}

function isCrossableGap(c: unknown): boolean {
  if (isSpacer(c)) return true;
  return false;
}

function consecutiveGroup(self: ToolExecutionProto): {
  members: ToolExecutionProto[];
  isHeader: boolean;
} {
  const siblings = findParentChildren(self);
  if (!siblings) {
    return { members: [self], isHeader: true };
  }

  const selfIdx = siblings.indexOf(self);
  if (selfIdx < 0) {
    return { members: [self], isHeader: true };
  }

  let start = selfIdx;
  while (start > 0) {
    const prev = siblings[start - 1];
    if (isCrossableGap(prev)) {
      start -= 1;
      continue;
    }
    if (isToolComponent(prev) && isTitleOnlyCandidate(prev)) {
      start -= 1;
      continue;
    }
    break;
  }

  let end = selfIdx;
  while (end + 1 < siblings.length) {
    const next = siblings[end + 1];
    if (isCrossableGap(next)) {
      end += 1;
      continue;
    }
    if (isToolComponent(next) && isTitleOnlyCandidate(next)) {
      end += 1;
      continue;
    }
    break;
  }

  const members: ToolExecutionProto[] = [];
  for (let i = start; i <= end; i++) {
    const c = siblings[i];
    if (isToolComponent(c) && isTitleOnlyCandidate(c)) {
      members.push(c);
    }
  }

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

/** Leading blank only after user/prose — never between tool blocks. */
function applyLeadSpacer(self: ToolExecutionProto): void {
  const lead = shouldGapAfter(getPreviousSibling(self)) ? 1 : 0;
  if (!Array.isArray(self.children)) return;
  for (const child of self.children) {
    if (isSpacer(child)) {
      if (typeof child.setLines === "function") child.setLines(lead);
      else child.lines = lead;
    }
  }
}

function setCollapsedChrome(self: ToolExecutionProto, line: string): void {
  applyLeadSpacer(self);

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

/**
 * After native updateDisplay (preview/full): strip color blocks, tighten padding,
 * prepend status ◆ matching chrome mode.
 */
function stripExpandedChrome(self: ToolExecutionProto, theme: ThemeLike): void {
  applyLeadSpacer(self);

  const kind = statusKind(self);
  const dot = colorGlyph(kind, chromeGlyph(kind), theme);

  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const rc =
      shell === "self" ? self.selfRenderContainer : self.contentBox;

    if (rc && typeof (rc as { paddingY?: number }).paddingY === "number") {
      (rc as { paddingX: number; paddingY: number }).paddingX = 0;
      (rc as { paddingX: number; paddingY: number }).paddingY = 0;
    }
    if (typeof rc.setBgFn === "function") {
      rc.setBgFn(passthrough);
    }

    // Prepend / refresh leading status diamond as first child of the body box
    const kids = (rc as { children?: unknown[] }).children;
    if (Array.isArray(kids)) {
      while (kids.length > 0 && (kids[0] as { [STATUS_DOT_MARK]?: boolean })?.[STATUS_DOT_MARK]) {
        kids.shift();
      }
      const dotLine = new Text(`${dot}`, 0, 0) as any;
      (dotLine as any)[STATUS_DOT_MARK] = true;
      kids.unshift(dotLine);
    }
  } else {
    if (typeof self.contentText.setCustomBgFn === "function") {
      self.contentText.setCustomBgFn(passthrough);
    }
    // Best-effort: prefix plain text body with status dot
    try {
      const cur = (self.contentText as { text?: string }).text;
      if (typeof cur === "string" && !cur.startsWith("◆") && !cur.startsWith("◇")) {
        // Can't easily re-color without full restyle; leave body as-is
      }
    } catch {
      /* ignore */
    }
  }

  self.hideComponent = false;
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

  const originalSetExpanded = prototype.setExpanded as
    | ((this: ToolExecutionProto, expanded: boolean) => void)
    | undefined;

  if (typeof originalSetExpanded === "function") {
    prototype.setExpanded = function (
      this: ToolExecutionProto,
      expanded: boolean,
    ) {
      this.expanded = expanded;
      this.updateDisplay();
    };
  }

  const patchedUpdateDisplay = function (this: ToolExecutionProto) {
    try {
      const mode = getToolViewMode();
      const titleOnly = isTitleOnlyCandidate(this);

      // ── preview / full (or non-collapsible edit/write): native body, flat chrome
      if (!titleOnly) {
        if (isCollapsibleTool(this.toolName)) {
          const wantExpanded = mode === "full";
          if (this.expanded !== wantExpanded) {
            this.expanded = wantExpanded;
          }
        }
        this.hideComponent = false;
        originalUpdateDisplay.call(this);
        // Strip green/red blocks; status = leading ◆ only
        stripExpandedChrome(this, theme);
        return;
      }

      // ── chrome mode: one-line titles + grouping
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
        const base = formatVerbGroupLabel(
          members.map((m) => ({
            toolName: m.toolName,
            isError: !isToolRunning(m) && m.result?.isError === true,
          })),
        );
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
        const fallback = `◆ ${this.toolName || "tool"}`;
        setCollapsedChrome(this, fallback);
      } catch {
        try {
          this.hideComponent = false;
        } catch {
          /* unrecoverable */
        }
      }
    }
  };

  prototype.updateDisplay = patchedUpdateDisplay as any;

  return () => {
    prototype.updateDisplay = originalUpdateDisplay;
    if (typeof originalSetExpanded === "function") {
      prototype.setExpanded = originalSetExpanded;
    }
  };
}
