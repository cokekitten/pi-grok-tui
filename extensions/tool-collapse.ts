/**
 * Monkey-patch ToolExecutionComponent:
 * - chrome: one-line Grok titles + grouping
 * - truncated/full: strip background blocks only; collapsible tools get a ◆ title
 *   and quieter body; edit/write keep native syntax/diff highlighting
 */
import { Text } from "@earendil-works/pi-tui";
import {
  bodyFg,
  formatChromeLine,
  RESPONSE_LEFT_PAD,
  responsePadString,
  safeFg,
  type ChromeTheme,
} from "./chrome.js";
import { dimBodyTexts, stripBgDeep } from "./flat-style.js";
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

const TITLE_MARK = "__piToolTitle";
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

function isTitleOnlyCandidate(t: ToolExecutionProto): boolean {
  return getToolViewMode() === "chrome" && isCollapsibleTool(t.toolName);
}

function isCrossableGap(c: unknown): boolean {
  return isSpacer(c);
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

/**
 * Leading blank before a tool block.
 * - chrome: tight between tools; gap after user/prose only
 * - preview/full: always leave a blank when there is a previous sibling (more air)
 */
function applyLeadSpacer(self: ToolExecutionProto, roomy: boolean): void {
  const prev = getPreviousSibling(self);
  let lead = 0;
  if (roomy) {
    // Expanded views: breathing room between every block
    lead = prev ? 1 : 0;
  } else {
    lead = shouldGapAfter(prev) ? 1 : 0;
  }
  if (!Array.isArray(self.children)) return;
  for (const child of self.children) {
    if (isSpacer(child)) {
      if (typeof child.setLines === "function") child.setLines(lead);
      else child.lines = lead;
    }
  }
}

function applyHorizontalPad(
  renderContainer: { paddingX?: number; paddingY?: number },
): void {
  // Vertical pad off (own lead Spacer); horizontal pad aligns with user ❯.
  if (typeof renderContainer.paddingY === "number") {
    renderContainer.paddingX = RESPONSE_LEFT_PAD;
    renderContainer.paddingY = 0;
  }
}

function setCollapsedChrome(self: ToolExecutionProto, line: string): void {
  applyLeadSpacer(self, false);

  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const renderContainer =
      shell === "self" ? self.selfRenderContainer : self.contentBox;
    applyHorizontalPad(renderContainer as { paddingX?: number; paddingY?: number });
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
    // No Box padding path — bake indent into the text.
    self.contentText.setText(responsePadString() + line);
    self.hideComponent = false;
  }
}

/**
 * After native updateDisplay (preview/full):
 * 1. strip background color blocks only (keep fg / syntax / diff highlights)
 * 2. for collapsible tools: add ◆ title row and optionally quiet non-code body
 * 3. edit/write keep native body styling (diff greens/reds, syntax) — only bg goes
 * 4. roomier lead spacer between blocks
 */
function restyleExpanded(
  self: ToolExecutionProto,
  theme: ThemeLike,
): void {
  applyLeadSpacer(self, true);
  stripBgDeep(self);

  // edit/write are always-expanded Grok-style: native renderer owns the body
  // (syntax + diff highlights). We only remove toolSuccessBg/errorBg blocks.
  const preserveNativeBody = !isCollapsibleTool(self.toolName);

  const isError = !isToolRunning(self) && self.result?.isError === true;
  const isRunning = isToolRunning(self);
  const kind = isRunning ? "tool_run" : isError ? "tool_err" : "tool_ok";
  const label = formatCollapsedToolLabel(self.toolName, self.args, {
    cwd: self.cwd,
  });
  const titleLine = formatChromeLine(theme, {
    kind,
    label,
    hint: " (Ctrl+O)",
  });

  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const rc =
      shell === "self" ? self.selfRenderContainer : self.contentBox;

    // Vertical pad off (lead Spacer owns gaps); horizontal pad matches ❯ column.
    // stripBgDeep may zero pad — re-apply after.
    stripBgDeep(rc);
    applyHorizontalPad(rc as { paddingX?: number; paddingY?: number });

    if (preserveNativeBody) {
      // Do not inject chrome title over native "edit path" / do not dimBody —
      // that would strip ANSI diff/syntax colors.
      self.hideComponent = false;
      return;
    }

    const kids = (rc as { children?: unknown[] }).children;
    if (Array.isArray(kids)) {
      // Drop previous title mark if re-rendering
      while (
        kids.length > 0 &&
        (kids[0] as Record<string, unknown>)?.[TITLE_MARK]
      ) {
        kids.shift();
      }
      const title = new Text(titleLine, 0, 0) as any;
      (title as any)[TITLE_MARK] = true;
      kids.unshift(title);

      // Quiet bash/read/etc body for flat look (not edit/write).
      for (let i = 1; i < kids.length; i++) {
        dimBodyTexts(kids[i], (t) => bodyFg(t), [TITLE_MARK]);
      }
    }
  } else {
    if (typeof self.contentText.setCustomBgFn === "function") {
      self.contentText.setCustomBgFn(passthrough);
    }
    const sp = responsePadString();
    if (!preserveNativeBody) {
      try {
        const body = self.contentText.text ?? "";
        // Title + dim body if we can
        const plain = body.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const bodyLines = plain
          ? plain
              .split("\n")
              .map((l) => sp + bodyFg(l))
              .join("\n")
          : "";
        self.contentText.setText(
          `${sp}${titleLine}${bodyLines ? `\n${bodyLines}` : ""}`,
        );
      } catch {
        /* ignore */
      }
    } else {
      // Preserve native colors but still indent.
      try {
        const body = self.contentText.text ?? "";
        if (body && !body.startsWith(sp)) {
          self.contentText.setText(
            body
              .split("\n")
              .map((l) => sp + l)
              .join("\n"),
          );
        }
      } catch {
        /* ignore */
      }
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
    throw new Error("pi-grok-tui: ToolExecutionComponent missing");
  }

  const Tec = rawTec as { prototype: ToolExecutionProto };
  const prototype = Tec.prototype;
  const theme = rawTheme as ThemeLike;

  if (typeof prototype.updateDisplay !== "function") {
    throw new Error("pi-grok-tui: ToolExecutionComponent.updateDisplay missing");
  }

  const originalUpdateDisplay = prototype.updateDisplay;
  const refreshDepth = { n: 0 };
  /** Re-entrancy guard: ToolExecution.invalidate → updateDisplay must not nest. */
  const updating = new WeakSet<object>();

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
    if (updating.has(this)) return;
    updating.add(this);
    try {
      const mode = getToolViewMode();
      const titleOnly = isTitleOnlyCandidate(this);

      // ── preview / full: title + flat dim body (no color blocks)
      if (!titleOnly) {
        if (isCollapsibleTool(this.toolName)) {
          const wantExpanded = mode === "full";
          if (this.expanded !== wantExpanded) {
            this.expanded = wantExpanded;
          }
        }
        this.hideComponent = false;
        originalUpdateDisplay.call(this);
        restyleExpanded(this, theme);
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
    } finally {
      updating.delete(this);
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
