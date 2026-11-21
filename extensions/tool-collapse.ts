/**
 * Monkey-patch ToolExecutionComponent:
 * - chrome: one-line Grok titles + grouping
 * - truncated/full: strip background blocks only; collapsible tools get a ◆ title
 *   and quieter body; edit/write keep native syntax/diff highlighting
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  bodyFg,
  RESPONSE_LEFT_PAD,
  responsePadString,
  type ChromeKind,
  type ChromeTheme,
} from "./chrome.js";
import {
  extractCodemodeCalls,
  formatCodemodeTreeLines,
  isCodemodeAutoTree,
  isCodemodeTool,
  resolveCodemodeDisplay,
  summarizeCodemodeChrome,
  type CodemodeChromeSummary,
} from "./codemode-style.js";
import { dimBodyTexts, stripAnsi, stripBgDeep } from "./flat-style.js";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import {
  getChildIndex,
  getNextSibling,
  getPreviousSibling,
  getSiblings,
  isNodeInUnclosedChatTurn,
  relayoutChild,
  shouldGapBefore,
} from "./parent-stamp.js";
import {
  markBodyFold,
  markBodyFoldDeep,
  unmarkBodyFold,
  unwrapMouseRegion,
  withFoldMarker,
  wrapFoldBodyComponent,
} from "./fold-body.js";
import {
  bumpChatLayoutVersion,
  clearViewOverride,
  getChatLayoutVersion,
  getState,
  getToolViewMode,
  getViewOverride,
  isGroupExpanded,
  setGroupExpanded,
  TOOL_FINISHED_AT_KEY,
  TOOL_STARTED_AT_KEY,
} from "./state.js";
import {
  chromePadForRenderShell,
  clickableChromeChild,
  codemodeBodyFoldId,
  collapsibleRun,
  effectiveToolMode,
  nativePreviewFoldId,
  toggleToolAt,
  toolChromeKind,
} from "./tool-click.js";
import { idForTarget, registerFoldHandler } from "./click-fold.js";
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
  executionStarted?: boolean;
  argsPending?: boolean;
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
    mouseLayout?: unknown;
  };
  selfRenderHeight?: number;
  mouseLayout?: unknown;
  callRendererComponent?: unknown;
  resultRendererComponent?: unknown;
  imageComponents: unknown[];
  imageSpacers: unknown[];
  imageSources?: unknown[];
  children?: unknown[];
  ui?: { children?: unknown[] };
  hasRendererDefinition(): boolean;
  getRenderShell(): "default" | "self";
  updateDisplay(): void;
  render?(width: number): string[];
  setExpanded?(expanded: boolean): void;
  removeChild?(c: unknown): void;
  addChild?(c: unknown): void;
}

const TITLE_MARK = "__piToolTitle";
const TOOL_PATCHED_GEN = Symbol.for("pi-grok-tui.toolPatchedGen");
const TOOL_GEN_COUNTER = Symbol.for("pi-grok-tui.toolGenCounter");
const EMPTY_LINES: readonly string[] = Object.freeze([]);
const passthrough = (t: string) => t;

function nextToolPatchGeneration(): number {
  const g = globalThis as Record<symbol, unknown>;
  const next = (typeof g[TOOL_GEN_COUNTER] === "number" ? g[TOOL_GEN_COUNTER] : 0) + 1;
  g[TOOL_GEN_COUNTER] = next;
  return next;
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
  const selfIdx = siblings === getSiblings(self) ? getChildIndex(self) : siblings.indexOf(self);
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
  // imageSources must go too: pi 1.5's updateDisplay() re-adds images with
  //   imageComponent = previous ? previousImages[index] : new Image(...)
  // where previous = imageSources[index]. A leftover source with no matching
  // image makes it addChild(undefined) and the next paint throws
  // "Cannot read properties of undefined (reading 'render')" in Container.render.
  self.imageSources = [];
}

/**
 * Last line of defence: a single undefined entry in a children array kills the
 * whole TUI (Container.render calls child.render unconditionally), so drop any
 * before pi paints. Splice in place — parent-stamp/findParentChildren keep
 * references to these arrays.
 */
function dropUndefinedChildren(node: { children?: unknown[] } | undefined): void {
  if (!Array.isArray(node?.children)) return;
  const kids = node.children;
  for (let i = kids.length - 1; i >= 0; i--) {
    if (kids[i] === undefined) kids.splice(i, 1);
  }
}

function sanitizeChildren(self: ToolExecutionProto): void {
  dropUndefinedChildren(self);
  dropUndefinedChildren(self.contentBox);
  dropUndefinedChildren(self.selfRenderContainer);
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
    lead = shouldGapBefore(self) ? 1 : 0;
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

function wrapExpandedBody(
  node: unknown,
  id: string,
  pad: number,
  onRender?: () => void,
): unknown {
  const inner = unwrapMouseRegion(node);
  if (!inner || typeof inner !== "object") return node;
  markBodyFoldDeep(inner, id, [TITLE_MARK]);
  return wrapFoldBodyComponent(
    inner as { render(width: number): string[]; invalidate?(): void },
    id,
    pad,
    onRender,
  );
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
  const shell =
    self.hasRendererDefinition() && self.getRenderShell() === "self"
      ? "self"
      : "default";
  return clickableChromeChild(theme, {
    target: opts.groupHeader ? (opts.header ?? self) : self,
    toolName: self.toolName,
    kind: opts.kind,
    label: opts.label,
    failedSuffix: opts.failedSuffix,
    groupHeader: opts.groupHeader,
    pad: chromePadForRenderShell(shell, opts.pad),
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
    if (typeof (self.contentText as { paddingX?: unknown }).paddingX === "number") {
      (self.contentText as { paddingX: number }).paddingX = 0;
    }
    if (typeof (self.contentText as { paddingY?: unknown }).paddingY === "number") {
      (self.contentText as { paddingY: number }).paddingY = 0;
    }
    if (typeof (self.contentText as { paddingX?: unknown }).paddingX === "number") {
      (self.contentText as { paddingX: number }).paddingX = 0;
    }
    if (typeof (self.contentText as { paddingY?: unknown }).paddingY === "number") {
      (self.contentText as { paddingY: number }).paddingY = 0;
    }
    const sp = responsePadString();
    try {
      const line = child.render(80)[0] ?? "";
      self.contentText.setText(line.startsWith(sp) ? line : sp + line);
    } catch {
      self.contentText.setText(sp + `◆ ${opts.label}`);
    }
    // Body is gone — drop its fold link so the collapsed title keeps no
    // leftover OSC 8 from the previous expanded paint.
    unmarkBodyFold(self.contentText);
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

  // edit/write keep the native renderer (syntax + diff highlights). We only
  // remove toolSuccessBg/errorBg blocks. write can still fold preview ↔ full.
  const preserveNativeBody = !isCollapsibleTool(self.toolName);

  const kind = toolChromeKind({
    running: isToolRunning(self),
    isError: !isToolRunning(self) && self.result?.isError === true,
  });
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

    const kids = (rc as { children?: unknown[] }).children;
    const foldPad = shell === "self" ? RESPONSE_LEFT_PAD : 0;

    if (preserveNativeBody) {
      // Do not inject chrome title over native "edit path" / do not dimBody —
      // that would strip ANSI diff/syntax colors.
      stripBgDeep(self.callRendererComponent);
      stripBgDeep(self.resultRendererComponent);
      const foldId = nativePreviewFoldId(self, self.toolName);
      if (foldId && Array.isArray(kids)) {
        for (let i = 0; i < kids.length; i++) {
          kids[i] = wrapExpandedBody(kids[i], foldId, 0);
        }
      } else if (foldId) {
        markBodyFoldDeep(rc, foldId, []);
      }
      self.hideComponent = false;
      return;
    }

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
      const bodyId = idForTarget(self);
      for (let i = 1; i < kids.length; i++) {
        dimBodyTexts(kids[i], (t) => bodyFg(t), [TITLE_MARK]);
        // Unwrap pi 0.85 MouseRegion so native click-to-expand cannot steal
        // grok's body-fold press, then wrap for indent + fold markers.
        kids[i] = wrapExpandedBody(kids[i], bodyId, foldPad);
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
        // contentText holds title + body rows; body rows get the fold link at
        // render time (title rows keep their own chrome link unbroken).
        markBodyFold(self.contentText, idForTarget(self));
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
      const foldId = nativePreviewFoldId(self, self.toolName);
      if (foldId) markBodyFold(self.contentText, foldId);
    }
  }

  self.hideComponent = false;
}


function createCodemodeTreeChild(
  self: ToolExecutionProto,
  theme: ThemeLike,
  summary: CodemodeChromeSummary,
  opts: {
    autoCompact: boolean;
    pad: number;
    isError: boolean;
    running: boolean;
  },
): { render(width: number): string[]; invalidate(): void } {
  const pad = opts.pad;
  const sp = pad > 0 ? " ".repeat(pad) : "";
  const id = codemodeBodyFoldId(self);
  const onClick = () => {
    toggleToolAt(self, self.toolName);
  };
  registerFoldHandler(id, onClick);

  let cachedWidth: number | undefined;
  let cachedTuiMode: string | undefined;
  let cachedClickFoldReady: boolean | undefined;
  let cachedHovered: boolean | undefined;
  let cachedThemeSample: string | undefined;
  let cachedLines: string[] | undefined;

  return {
    render(width: number) {
      registerFoldHandler(id, onClick);
      const state = getState();
      const hovered =
        state.tuiMode === "fullscreen" &&
        state.clickFoldReady &&
        state.hoveredFoldId === id;
      const themeSample = theme.fg("muted", "m");
      if (
        cachedLines &&
        cachedWidth === width &&
        cachedTuiMode === state.tuiMode &&
        cachedClickFoldReady === state.clickFoldReady &&
        cachedHovered === hovered &&
        cachedThemeSample === themeSample
      ) {
        return cachedLines;
      }

      const inner = Math.max(1, width - pad);
      const rawLines = formatCodemodeTreeLines(theme, summary.calls, {
        autoCompact: opts.autoCompact,
        cwd: self.cwd,
        scriptError: summary.scriptError,
        isError: opts.isError,
        running: opts.running,
      });
      const out = rawLines.map((line) => {
        const truncated = truncateToWidth(line, inner, "…");
        return sp + withFoldMarker(truncated, id, inner);
      });

      cachedWidth = width;
      cachedTuiMode = state.tuiMode;
      cachedClickFoldReady = state.clickFoldReady;
      cachedHovered = hovered;
      cachedThemeSample = themeSample;
      cachedLines = out;
      return out;
    },
    invalidate() {
      cachedLines = undefined;
      cachedWidth = undefined;
      cachedThemeSample = undefined;
    },
  };
}

function setCodemodeCallsView(
  self: ToolExecutionProto,
  theme: ThemeLike,
  summary: CodemodeChromeSummary,
  opts: { autoCompact: boolean; isError: boolean; running: boolean },
): void {
  applyLeadSpacer(self, false);
  const titleChild = chromeChild(self, theme, {
    kind: summary.kind,
    label: summary.label,
    failedSuffix: summary.failedSuffix,
  });

  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const renderContainer =
      shell === "self" ? self.selfRenderContainer : self.contentBox;
    applyHorizontalPad(renderContainer as { paddingX?: number; paddingY?: number });
    if (typeof renderContainer.setBgFn === "function") {
      renderContainer.setBgFn(passthrough);
    }
    const pad = chromePadForRenderShell(shell);
    const treeChild = createCodemodeTreeChild(self, theme, summary, {
      autoCompact: opts.autoCompact,
      pad,
      isError: opts.isError,
      running: opts.running,
    });
    renderContainer.clear();
    renderContainer.addChild(titleChild as any);
    renderContainer.addChild(treeChild as any);
    self.hideComponent = false;
  } else {
    if (typeof self.contentText.setCustomBgFn === "function") {
      self.contentText.setCustomBgFn(passthrough);
    }
    if (typeof (self.contentText as { paddingX?: unknown }).paddingX === "number") {
      (self.contentText as { paddingX: number }).paddingX = 0;
    }
    if (typeof (self.contentText as { paddingY?: unknown }).paddingY === "number") {
      (self.contentText as { paddingY: number }).paddingY = 0;
    }
    const sp = responsePadString();
    try {
      const head = titleChild.render(80)[0] ?? `◆ ${summary.label}`;
      const headPadded = head.startsWith(sp) ? head : sp + head;
      const treeLines = formatCodemodeTreeLines(theme, summary.calls, {
        autoCompact: opts.autoCompact,
        cwd: self.cwd,
        scriptError: summary.scriptError,
        isError: opts.isError,
        running: opts.running,
      }).map((l) => sp + l);
      self.contentText.setText([headPadded, ...treeLines].join("\n"));
    } catch {
      self.contentText.setText(sp + `◆ ${summary.label}`);
    }
    const bodyId = codemodeBodyFoldId(self);
    registerFoldHandler(bodyId, () => {
      toggleToolAt(self, self.toolName);
    });
    markBodyFold(self.contentText, bodyId);
    self.hideComponent = false;
  }
}

function dropDuplicateCodemodeHeading(callComp: unknown): void {
  if (!callComp || typeof callComp !== "object") return;
  const kids = (callComp as { children?: unknown[] }).children;
  if (!Array.isArray(kids) || kids.length === 0) return;
  const first = kids[0] as { text?: unknown } | undefined;
  if (first && typeof first.text === "string") {
    if (stripAnsi(first.text).trim() === "codemode") {
      kids.shift();
    }
  }
}

function restyleCodemodeFull(
  self: ToolExecutionProto,
  theme: ThemeLike,
  summary: CodemodeChromeSummary,
): void {
  applyLeadSpacer(self, true);
  stripBgDeep(self);

  const titleChild = chromeChild(self, theme, {
    kind: summary.kind,
    label: summary.label,
    failedSuffix: summary.failedSuffix,
  });

  if (self.hasRendererDefinition()) {
    const shell = self.getRenderShell();
    const rc =
      shell === "self" ? self.selfRenderContainer : self.contentBox;
    stripBgDeep(rc);
    applyHorizontalPad(rc as { paddingX?: number; paddingY?: number });
    stripBgDeep(self.callRendererComponent);
    stripBgDeep(self.resultRendererComponent);
    dropDuplicateCodemodeHeading(self.callRendererComponent);

    const kids = (rc as { children?: unknown[] }).children;
    const foldPad = shell === "self" ? RESPONSE_LEFT_PAD : 0;
    if (Array.isArray(kids)) {
      while (
        kids.length > 0 &&
        (kids[0] as Record<string, unknown>)?.[TITLE_MARK]
      ) {
        kids.shift();
      }
      // Drop empty callRenderer wrapper if stripping the heading left 0 children
      for (let i = kids.length - 1; i >= 0; i--) {
        const unwrapped = unwrapMouseRegion(kids[i]) as { children?: unknown[] } | undefined;
        if (
          unwrapped &&
          unwrapped === self.callRendererComponent &&
          Array.isArray(unwrapped.children) &&
          unwrapped.children.length === 0
        ) {
          kids.splice(i, 1);
        }
      }

      const title = titleChild as any;
      (title as any)[TITLE_MARK] = true;
      kids.unshift(title);

      const bodyId = codemodeBodyFoldId(self);
      const onBodyClick = () => {
        toggleToolAt(self, self.toolName);
      };
      const keepBodyHandler = () => {
        registerFoldHandler(bodyId, onBodyClick);
      };
      keepBodyHandler();
      for (let i = 1; i < kids.length; i++) {
        // Keep CodeHighlighter syntax colors and ✓/✗/error fg intact (no dimBodyTexts).
        kids[i] = wrapExpandedBody(kids[i], bodyId, foldPad, keepBodyHandler);
      }
    }
  } else {
    if (typeof self.contentText.setCustomBgFn === "function") {
      self.contentText.setCustomBgFn(passthrough);
    }
    const sp = responsePadString();
    const bodyId = codemodeBodyFoldId(self);
    registerFoldHandler(bodyId, () => {
      toggleToolAt(self, self.toolName);
    });
    try {
      const body = self.contentText.text ?? "";
      const bodyLines = body
        ? body
            .split("\n")
            .map((l) => (l.startsWith(sp) ? l : sp + l))
            .join("\n")
        : "";
      const titleLine = titleChild.render(80)[0] ?? `◆ ${summary.label}`;
      self.contentText.setText(
        `${titleLine.startsWith(sp) ? titleLine : sp + titleLine}${bodyLines ? `\n${bodyLines}` : ""}`,
      );
      markBodyFold(self.contentText, bodyId);
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
    throw new Error("pi-grok-tui: ToolExecutionComponent missing");
  }

  const Tec = rawTec as { prototype: ToolExecutionProto };
  const prototype = Tec.prototype;
  const theme = rawTheme as ThemeLike;

  if (typeof prototype.updateDisplay !== "function") {
    throw new Error("pi-grok-tui: ToolExecutionComponent.updateDisplay missing");
  }

  const generation = nextToolPatchGeneration();
  const originalUpdateDisplay = prototype.updateDisplay;
  const originalRender = prototype.render;
  const refreshDepth = { n: 0 };
  /** Re-entrancy guard: ToolExecution.invalidate → updateDisplay must not nest. */
  const updating = new WeakSet<object>();
  const showsBodyState = new WeakMap<object, boolean>();
  const wasRunningTool = new WeakMap<object, boolean>();
  const lastCodemodeAutoTree = new WeakMap<object, boolean>();
  const lastAutoTreeCheckedVer = new WeakMap<object, number>();
  // Resolved display level of the last paint. The auto-tree flag alone misses
  // paints whose level changed without it (a cleared click override, a single
  // finished call that now skips the calls view), leaving a stale full body.
  const lastCodemodeLevel = new WeakMap<object, string>();
  const wasStandaloneInParent = new WeakSet<object>();
  type ToolRenderCache =
    | {
        kind: "self";
        width: number;
        kids: unknown[];
        kidOuts: Array<readonly string[]>;
        innerMouseLayout: unknown;
        selfRenderHeight: number | undefined;
        lines: string[];
      }
    | {
        kind: "default";
        width: number;
        spLines: number;
        mainChild: unknown;
        mainOut: readonly string[];
        mouseLayout: unknown;
        lines: string[];
      };
  const toolRenderCache = new WeakMap<object, ToolRenderCache>();
  const syncNextSiblingOnBodyChange = (self: ToolExecutionProto, showsBody: boolean) => {
    const prev = showsBodyState.get(self);
    showsBodyState.set(self, showsBody);
    if (prev !== undefined && prev !== showsBody) {
      const next = getNextSibling(self);
      if (next) relayoutChild(next);
    }
  };

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
    (this as unknown as Record<symbol, unknown>)[TOOL_PATCHED_GEN] = generation;
    toolRenderCache.delete(this);
    if (updating.has(this)) return;
    updating.add(this);
    bumpChatLayoutVersion();
    // Pi 1.5 defers streamed args until render(). Chrome/group branches skip
    // native updateDisplay, so they must acknowledge the batch themselves.
    this.argsPending = false;
    try {
      const toolRunningNow = isToolRunning(this);
      const prevToolRunning = wasRunningTool.get(this);
      wasRunningTool.set(this, toolRunningNow);
      if (this.executionStarted) {
        if (toolRunningNow) {
          const rec = this as unknown as Record<symbol, unknown>;
          if (typeof rec[TOOL_STARTED_AT_KEY] !== "number") {
            rec[TOOL_STARTED_AT_KEY] = Date.now();
          }
        } else if (prevToolRunning === true) {
          (this as unknown as Record<symbol, unknown>)[TOOL_FINISHED_AT_KEY] = Date.now();
        }
      }

      if (isCodemodeTool(this.toolName)) {
        const running = toolRunningNow;
        const inUnclosedTurn = isNodeInUnclosedChatTurn(this);
        const isError = !running && this.result?.isError === true;
        const summary = summarizeCodemodeChrome(this.args, this.result, {
          running,
          inUnclosedTurn,
          cwd: this.cwd,
        });
        const prevAutoTree = lastCodemodeAutoTree.get(this);
        lastCodemodeAutoTree.set(this, summary.autoTree);
        lastAutoTreeCheckedVer.set(this, getChatLayoutVersion());
        if (prevAutoTree === true && !summary.autoTree) {
          clearViewOverride(this);
        }
        const { level, autoCompact } = resolveCodemodeDisplay({
          globalMode: getToolViewMode(),
          override: getViewOverride(this),
          autoTree: summary.autoTree,
        });
        lastCodemodeLevel.set(this, level);

        if (level === "collapsed") {
          this.expanded = false;
          clearImages(this);
          setCollapsedChrome(this, theme, {
            kind: summary.kind,
            label: summary.label,
            failedSuffix: summary.failedSuffix,
          });
          syncNextSiblingOnBodyChange(this, false);
          return;
        }

        if (level === "calls") {
          this.expanded = false;
          clearImages(this);
          setCodemodeCallsView(this, theme, summary, {
            autoCompact,
            isError,
            running,
          });
          syncNextSiblingOnBodyChange(this, false);
          return;
        }

        // level === "full"
        this.expanded = true;
        this.hideComponent = false;
        originalUpdateDisplay.call(this);
        restyleCodemodeFull(this, theme, summary);
        syncNextSiblingOnBodyChange(this, true);
        return;
      }

      const { members, header, isHeader } = consecutiveGroup(this);
      const grouped = members.length >= 2 && getToolViewMode() === "chrome";
      if (!grouped && getToolViewMode() === "chrome" && getSiblings(this) !== null) {
        wasStandaloneInParent.add(this);
      } else if (grouped && wasStandaloneInParent.has(header)) {
        wasStandaloneInParent.delete(header);
        const headerOverride = getViewOverride(header);
        if (headerOverride && headerOverride !== "chrome") {
          setGroupExpanded(header, true);
        }
      }
      const groupOpen = grouped && isGroupExpanded(header);
      const titleOnly = isTitleOnlyCandidate(this);

      // Collapsed group: header is always the one-line group chrome, even if
      // member 0 has a local body override. Other members stay hidden.
      if (grouped && !groupOpen) {
        this.expanded = false;
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
          syncNextSiblingOnBodyChange(this, false);
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
        syncNextSiblingOnBodyChange(this, false);
        refreshSiblings(this, members, refreshDepth);
        return;
      }

      const paintGroupHeader = grouped && isHeader;
      const anyError = members.some(
        (m) => !isToolRunning(m) && m.result?.isError === true,
      );
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
        if (isCollapsibleTool(this.toolName) || this.toolName === "write") {
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
        syncNextSiblingOnBodyChange(this, true);
        refreshSiblings(this, members, refreshDepth);
        return;
      }

      // ── chrome mode: one-line titles (expanded groups already handled above)
      this.expanded = false;
      clearImages(this);

      const label = formatCollapsedToolLabel(this.toolName, this.args, {
        cwd: this.cwd,
      });
      const kind = toolChromeKind({
        running: isToolRunning(this),
        isError: !isToolRunning(this) && this.result?.isError === true,
      });
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
      syncNextSiblingOnBodyChange(this, false);
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
      sanitizeChildren(this);
      updating.delete(this);
    }
  };

  prototype.updateDisplay = patchedUpdateDisplay as any;
  if (typeof originalRender === "function") {
    prototype.render = function (this: ToolExecutionProto, width: number): string[] {
      if ((this as unknown as Record<symbol, unknown>)[TOOL_PATCHED_GEN] !== generation) {
        (this as unknown as Record<symbol, unknown>)[TOOL_PATCHED_GEN] = generation;
        try {
          this.updateDisplay();
        } catch {
          /* never break render */
        }
      } else if (isCodemodeTool(this.toolName)) {
        const running = isToolRunning(this);
        const curVer = getChatLayoutVersion();
        if (
          running ||
          lastAutoTreeCheckedVer.get(this) !== curVer ||
          !lastCodemodeAutoTree.has(this)
        ) {
          lastAutoTreeCheckedVer.set(this, curVer);
          const wantAutoTree = isCodemodeAutoTree(
            extractCodemodeCalls(this.result?.details),
            {
              running,
              inUnclosedTurn: isNodeInUnclosedChatTurn(this),
              isError: !running && this.result?.isError === true,
            },
          );
          const wantLevel = resolveCodemodeDisplay({
            globalMode: getToolViewMode(),
            override: getViewOverride(this),
            autoTree: wantAutoTree,
          }).level;
          if (
            lastCodemodeAutoTree.get(this) !== wantAutoTree ||
            (lastCodemodeLevel.has(this) && lastCodemodeLevel.get(this) !== wantLevel)
          ) {
            try {
              this.updateDisplay();
            } catch {
              /* never break render */
            }
          }
        }
      }

      if (!this.argsPending) {
        if (this.hideComponent) {
          return EMPTY_LINES as string[];
        }

        const hasImages =
          Array.isArray(this.imageComponents) && this.imageComponents.length > 0;
        if (!hasImages && !isToolRunning(this)) {
          const hit = toolRenderCache.get(this);
          if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
            const rcKids = this.selfRenderContainer?.children;
            if (Array.isArray(rcKids)) {
              const kidOuts: Array<readonly string[]> = new Array(rcKids.length);
              let matched =
                hit !== undefined &&
                hit.kind === "self" &&
                hit.width === width &&
                hit.kids.length === rcKids.length;
              for (let i = 0; i < rcKids.length; i++) {
                const k = rcKids[i] as { render?: (w: number) => string[] } | undefined;
                if (!k || typeof k.render !== "function" || (matched && hit!.kind === "self" && hit!.kids[i] !== k)) {
                  matched = false;
                }
                kidOuts[i] = k && typeof k.render === "function" ? k.render(width) : EMPTY_LINES;
                if (matched && hit!.kind === "self" && hit!.kidOuts[i] !== kidOuts[i]) {
                  matched = false;
                }
              }
              if (matched && hit && hit.kind === "self") {
                this.selfRenderContainer.mouseLayout = hit.innerMouseLayout;
                this.selfRenderHeight = hit.selfRenderHeight;
                return hit.lines;
              }
              const lines = originalRender.call(this, width);
              toolRenderCache.set(this, {
                kind: "self",
                width,
                kids: rcKids.slice(),
                kidOuts,
                innerMouseLayout: this.selfRenderContainer.mouseLayout,
                selfRenderHeight: this.selfRenderHeight,
                lines,
              });
              return lines;
            }
          } else if (
            Array.isArray(this.children) &&
            this.children.length === 2 &&
            isSpacer(this.children[0])
          ) {
            const spLines = this.children[0].lines;
            const mainChild = this.children[1] as { render?: (w: number) => string[] } | undefined;
            if (mainChild && typeof mainChild.render === "function") {
              const mainOut = mainChild.render(width);
              if (
                hit &&
                hit.kind === "default" &&
                hit.width === width &&
                hit.spLines === spLines &&
                hit.mainChild === mainChild &&
                hit.mainOut === mainOut
              ) {
                this.mouseLayout = hit.mouseLayout;
                return hit.lines;
              }
              const lines = originalRender.call(this, width);
              toolRenderCache.set(this, {
                kind: "default",
                width,
                spLines,
                mainChild,
                mainOut,
                mouseLayout: this.mouseLayout,
                lines,
              });
              return lines;
            }
          }
        }
      }

      return originalRender.call(this, width);
    };
  }

  return () => {
    prototype.updateDisplay = originalUpdateDisplay;
    if (typeof originalRender === "function") {
      prototype.render = originalRender;
    }
    if (typeof originalSetExpanded === "function") {
      prototype.setExpanded = originalSetExpanded;
    }
  };
}
