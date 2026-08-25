/**
 * Monkey-patch ToolExecutionComponent:
 * - chrome: one-line Grok titles + grouping
 * - truncated/full: strip background blocks only; collapsible tools get a ◆ title
 *   and quieter body; edit/write keep native syntax/diff highlighting
 */
import {
  bodyFg,
  RESPONSE_LEFT_PAD,
  responsePadString,
  type ChromeKind,
  type ChromeTheme,
} from "./chrome.js";
import { dimBodyTexts, stripBgDeep } from "./flat-style.js";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import { getPreviousSibling, getSiblings, shouldGapAfter } from "./parent-stamp.js";
import { getToolViewMode, isGroupExpanded } from "./state.js";
import {
  clickableChromeChild,
  collapsibleRun,
  effectiveToolMode,
} from "./tool-click.js";
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
  return effectiveToolMode(t, t.toolName) === "chrome";
}

function consecutiveGroup(self: ToolExecutionProto): {
  members: ToolExecutionProto[];
  header: ToolExecutionProto;
  isHeader: boolean;
} {
  const siblings = findParentChildren(self);
  if (!siblings) {
    return { members: [self], header: self, isHeader: true };
  }
  const selfIdx = siblings.indexOf(self);
  if (selfIdx < 0) {
    return { members: [self], header: self, isHeader: true };
  }
  const run = collapsibleRun(siblings, selfIdx);
  const members = run.members.filter(isToolComponent);
  if (members.length === 0) {
    return { members: [self], header: self, isHeader: true };
  }
  return {
    members,
    header: members[0]!,
    isHeader: members[0] === self,
  };
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

function prependGroupHeader(
  self: ToolExecutionProto,
  theme: ThemeLike,
  header: ToolExecutionProto,
  g: { kind: ChromeKind; label: string; failedSuffix?: string },
): void {
  const child = chromeChild(self, theme, {
    kind: g.kind,
    label: g.label,
    failedSuffix: g.failedSuffix,
    groupHeader: true,
    header,
  });
  (child as any)[TITLE_MARK] = true;
  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const rc =
      shell === "self" ? self.selfRenderContainer : self.contentBox;
    const kids = (rc as { children?: unknown[] }).children;
    if (Array.isArray(kids)) {
      while (
        kids.length > 0 &&
        (kids[0] as Record<string, unknown>)?.[TITLE_MARK] &&
        (kids[0] as { groupHeader?: boolean }).groupHeader
      ) {
        kids.shift();
      }
      (child as { groupHeader?: boolean }).groupHeader = true;
      kids.unshift(child);
    }
    return;
  }
  try {
    const sp = responsePadString();
    const line = child.render(80)[0] ?? "";
    const body = self.contentText.text ?? "";
    self.contentText.setText(
      `${line.startsWith(sp) ? line : sp + line}${body ? `\n${body}` : ""}`,
    );
  } catch {
    /* ignore */
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

function chromeChild(
  self: ToolExecutionProto,
  theme: ThemeLike,
  opts: {
    kind: ChromeKind;
    label: string;
    failedSuffix?: string;
    groupHeader?: boolean;
    header?: ToolExecutionProto;
    pad?: number;
  },
) {
  return clickableChromeChild(theme, {
    target: opts.groupHeader ? (opts.header ?? self) : self,
    toolName: self.toolName,
    kind: opts.kind,
    label: opts.label,
    failedSuffix: opts.failedSuffix,
    groupHeader: opts.groupHeader,
    pad: opts.pad,
  });
}

function setCollapsedChrome(
  self: ToolExecutionProto,
  theme: ThemeLike,
  opts: {
    kind: ChromeKind;
    label: string;
    failedSuffix?: string;
    groupHeader?: boolean;
    header?: ToolExecutionProto;
  },
): void {
  applyLeadSpacer(self, false);
  const child = chromeChild(self, theme, opts);

  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const renderContainer =
      shell === "self" ? self.selfRenderContainer : self.contentBox;
    applyHorizontalPad(renderContainer as { paddingX?: number; paddingY?: number });
    if (typeof renderContainer.setBgFn === "function") {
      renderContainer.setBgFn(passthrough);
    }
    renderContainer.clear();
    renderContainer.addChild(child as any);
    self.hideComponent = false;
  } else {
    if (typeof self.contentText.setCustomBgFn === "function") {
      self.contentText.setCustomBgFn(passthrough);
    }
    const sp = responsePadString();
    try {
      const line = child.render(80)[0] ?? "";
      self.contentText.setText(line.startsWith(sp) ? line : sp + line);
    } catch {
      self.contentText.setText(sp + `◆ ${opts.label}`);
    }
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
  const titleChild = chromeChild(self, theme, { kind, label });

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
      const title = titleChild as any;
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
        const titleLine = titleChild.render(80)[0] ?? `◆ ${label}`;
        self.contentText.setText(
          `${titleLine.startsWith(sp) ? titleLine : sp + titleLine}${bodyLines ? `\n${bodyLines}` : ""}`,
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
      const { members, header, isHeader } = consecutiveGroup(this);
      const grouped = members.length >= 2 && getToolViewMode() === "chrome";
      const groupOpen = grouped && isGroupExpanded(header);
      const titleOnly = isTitleOnlyCandidate(this);

      // Collapsed group: header is always the one-line group chrome, even if
      // member 0 has a local body override. Other members stay hidden.
      if (grouped && !groupOpen) {
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
        clearImages(this);
        const failed = members.filter(
          (m) => !isToolRunning(m) && m.result?.isError === true,
        ).length;
        const anyError = failed > 0;
        const base = formatVerbGroupLabel(
          members.map((m) => ({
            toolName: m.toolName,
            isError: !isToolRunning(m) && m.result?.isError === true,
          })),
        );
        const failedMatch = base.match(/^(.*?)( · \d+ failed)$/);
        setCollapsedChrome(this, theme, {
          kind: anyError ? "group_err" : "group",
          label: failedMatch ? failedMatch[1]! : base,
          failedSuffix: failedMatch ? failedMatch[2]! : undefined,
          groupHeader: true,
          header,
        });
        refreshSiblings(this, members, refreshDepth);
        return;
      }

      const paintGroupHeader = grouped && isHeader;
      const failed = members.filter(
        (m) => !isToolRunning(m) && m.result?.isError === true,
      ).length;
      const anyError = failed > 0;
      const anyRunning = members.some(isToolRunning);
      const groupChrome = () => {
        const base = formatVerbGroupLabel(
          members.map((m) => ({
            toolName: m.toolName,
            isError: !isToolRunning(m) && m.result?.isError === true,
          })),
        );
        const failedMatch = base.match(/^(.*?)( · \d+ failed)$/);
        return {
          kind: (anyError ? "group_err" : "group") as ChromeKind,
          label: failedMatch ? failedMatch[1]! : base,
          failedSuffix: failedMatch ? failedMatch[2]! : undefined,
        };
      };

      // ── preview / full body (including expanded group members)
      if (!titleOnly) {
        if (isCollapsibleTool(this.toolName)) {
          const wantExpanded = effectiveToolMode(this, this.toolName) === "full";
          if (this.expanded !== wantExpanded) {
            this.expanded = wantExpanded;
          }
        }
        this.hideComponent = false;
        originalUpdateDisplay.call(this);
        restyleExpanded(this, theme);
        if (paintGroupHeader && groupOpen) {
          prependGroupHeader(this, theme, header, groupChrome());
        }
        refreshSiblings(this, members, refreshDepth);
        return;
      }

      // ── chrome mode: one-line titles (expanded groups already handled above)
      clearImages(this);

      const label = formatCollapsedToolLabel(this.toolName, this.args, {
        cwd: this.cwd,
      });
      const kind = anyRunning
        ? "tool_run"
        : anyError
          ? "tool_err"
          : "tool_ok";
      if (paintGroupHeader && groupOpen) {
        const g = groupChrome();
        setCollapsedChrome(this, theme, {
          kind,
          label,
        });
        prependGroupHeader(this, theme, header, g);
      } else {
        setCollapsedChrome(this, theme, { kind, label });
      }
      refreshSiblings(this, members, refreshDepth);
    } catch {
      try {
        setCollapsedChrome(this, theme, {
          kind: "tool_ok",
          label: this.toolName || "tool",
        });
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
