/**
 * Completed work rollup: collapses contiguous runs of finished Thoughts,
 * tools, codemode batches, and custom chrome rows immediately above an
 * assistant prose response — or above a turn-closing boundary such as a new
 * user message — into a single clickable Grok ◇ summary row with total duration.
 *
 * While a turn is still executing tools or thinking without a closer below it,
 * no rollup forms so live step-by-step progress remains visible.
 */
import { Container } from "@earendil-works/pi-tui";
import {
  RESPONSE_LEFT_PAD,
  type ChromeKind,
  type ChromeTheme,
} from "./chrome.js";
import { isGroupableTool } from "./click-fold-core.js";
import {
  idForTarget,
  registerFoldHandler,
  renderClickableChrome,
} from "./click-fold.js";
import { extractCodemodeCalls, isCodemodeTool } from "./codemode-style.js";
import {
  INTERNAL_MODULES,
  PI_CODING_AGENT,
  importInternal,
} from "./internal-import.js";
import {
  ensureContainerStamped,
  getParent,
  isAssistantMessageComponent,
  isCustomChromeComponent,
  isNonProseTurnCloserComponent,
  isUserMessageComponent,
  relayoutChild,
  setWorkRollupHooks,
  shouldGapAfter,
} from "./parent-stamp.js";
import {
  clearViewOverride,
  getState,
  getViewOverride,
  isGroupExpanded,
  isWorkRollupExpanded,
  isWorkRollupInitialized,
  markWorkRollupInitialized,
  MIN_EPOCH_MS,
  setWorkRollupExpanded,
  TOOL_FINISHED_AT_KEY,
  TOOL_STARTED_AT_KEY,
} from "./state.js";
import { verbKindForTool } from "./tool-titles.js";

const ROLLUP_PASS_KEY = Symbol.for("pi-grok-tui.rollupPassCache");
const MAX_DISPLAY_BUCKETS = 4;
const NOOP_MOUSE_COMPONENT = Object.freeze({});
const CODEMODE_WALL_TIME_RE = /^Script (?:completed|failed)\nWall time ([\d.]+) seconds\n/;

type RollupVerbKind =
  | "read"
  | "write"
  | "edit"
  | "search"
  | "dir"
  | "web_fetch"
  | "web_search"
  | "command"
  | "subagent"
  | "script"
  | "todo"
  | "classify"
  | "image"
  | "mcp"
  | "other";

export type ClassifiedChatChild =
  | { kind: "spacer"; lines: number }
  | {
      kind: "transparent";
      child?: object;
      startMs?: number;
      endMs?: number;
    }
  | {
      kind: "thought";
      child: object;
      timestamp?: number;
      startMs?: number;
      endMs?: number;
    }
  | {
      kind: "tool";
      child: object;
      toolName: string;
      args: unknown;
      result?: {
        isError?: boolean;
        details?: unknown;
        timestamp?: number;
        durationMs?: number;
        content?: unknown;
      };
      cwd?: string;
      startMs?: number;
      endMs?: number;
      durationMs?: number;
    }
  | {
      kind: "custom";
      child: object;
      startMs?: number;
      endMs?: number;
    }
  | {
      kind: "prose";
      child: object;
      hasLeadingThinking: boolean;
      timestamp?: number;
      startMs?: number;
      thinkingEndMs?: number;
    }
  | { kind: "closer"; child: object }
  | { kind: "active" }
  | { kind: "boundary" };

export interface WorkRollupSegment {
  startIndex: number;
  endIndex: number;
  proseIndex: number;
  closerIndex: number;
  firstWorkChild: object;
  proseChild: object;
  closerChild: object;
  isProseCloser: boolean;
  absorbsProseLeadingThinking: boolean;
  proseTimestamp?: number;
  proseStartMs?: number;
  proseThinkingEndMs?: number;
  leadBlank: boolean;
  visibleBlocks: number;
  items: ClassifiedChatChild[];
}

export interface WorkRollupScan {
  segments: WorkRollupSegment[];
  byStartIndex: Map<number, WorkRollupSegment>;
  byProseChild: Map<object, WorkRollupSegment>;
  byCloserChild: Map<object, WorkRollupSegment>;
  byFirstChild: Map<object, WorkRollupSegment>;
}

export interface WorkRollupSummary {
  kind: ChromeKind;
  label: string;
  failedSuffix?: string;
  durationMs?: number;
  durationSuffix?: string;
}

function extractEpochMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= MIN_EPOCH_MS) {
    return v;
  }
  if (typeof v === "string" && v.length > 0) {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed) && parsed >= MIN_EPOCH_MS) {
      return parsed;
    }
  }
  return undefined;
}

function extractExplicitToolDurationMs(
  toolName: string,
  result:
    | {
        durationMs?: unknown;
        content?: unknown;
      }
    | undefined,
): number | undefined {
  if (
    typeof result?.durationMs === "number" &&
    Number.isFinite(result.durationMs) &&
    result.durationMs >= 0
  ) {
    return result.durationMs;
  }
  if (isCodemodeTool(toolName) && Array.isArray(result?.content)) {
    const first = result.content[0] as { type?: unknown; text?: unknown } | undefined;
    if (first && first.type === "text" && typeof first.text === "string") {
      const m = CODEMODE_WALL_TIME_RE.exec(first.text);
      if (m) {
        const sec = Number.parseFloat(m[1]!);
        if (Number.isFinite(sec) && sec >= 0) {
          return sec * 1000;
        }
      }
    }
  }
  return undefined;
}

export function formatRollupDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 59_950) {
    const sec = ms / 1000;
    const formatted = sec < 10 ? sec.toFixed(1) : sec.toFixed(1);
    return `${formatted.replace(/\.0$/, "")}s`;
  }
  if (ms < 3_599_500) {
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function isSpacerNode(c: unknown): c is { lines: number; render(w: number): string[] } {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (typeof o.lines !== "number" || typeof o.render !== "function") return false;
  if ("toolName" in o || "updateContent" in o || "rebuild" in o || "text" in o) {
    return false;
  }
  return true;
}

function isToolNode(c: unknown): c is {
  toolName: string;
  args: unknown;
  result?: {
    isError?: boolean;
    details?: unknown;
    timestamp?: number;
    durationMs?: number;
    content?: unknown;
  };
  isPartial?: boolean;
  cwd?: string;
  updateDisplay: () => void;
} {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return typeof o.toolName === "string" && typeof o.updateDisplay === "function";
}

function isToolRunningLike(t: { isPartial?: boolean; result?: unknown }): boolean {
  if ("isPartial" in t) {
    return Boolean(t.isPartial || t.result == null);
  }
  return t.result == null;
}

export function classifyChatChild(c: unknown): ClassifiedChatChild {
  if (!c || typeof c !== "object") return { kind: "boundary" };

  if (isSpacerNode(c)) {
    return { kind: "spacer", lines: c.lines };
  }

  if (isAssistantMessageComponent(c)) {
    const amc = c as {
      isStreaming?: boolean;
      timestamp?: unknown;
      lastMessage?: {
        timestamp?: number;
        stopReason?: string;
        content?: Array<{ type?: string; text?: string; thinking?: string; redacted?: boolean }>;
      };
    };
    const msg = amc.lastMessage;
    const isStreaming = Boolean(amc.isStreaming);
    const content = Array.isArray(msg?.content) ? msg.content : [];

    const firstTextIdx = content.findIndex(
      (b) => b?.type === "text" && typeof b.text === "string" && b.text.trim().length > 0,
    );
    const hasProse = firstTextIdx >= 0;

    const thinkingIdxs: number[] = [];
    for (let i = 0; i < content.length; i++) {
      const b = content[i];
      if (
        b?.type === "thinking" &&
        !b.redacted &&
        typeof b.thinking === "string" &&
        b.thinking.trim().length > 0
      ) {
        thinkingIdxs.push(i);
      }
    }
    const hasThinking = thinkingIdxs.length > 0;
    const hasToolCalls = content.some((b) => b?.type === "toolCall");
    const hasStandaloneError =
      !hasToolCalls &&
      !hasThinking &&
      (msg?.stopReason === "aborted" ||
        msg?.stopReason === "error" ||
        msg?.stopReason === "length");

    const state = getState();
    const msgTs = msg?.timestamp;
    const msgStartMs = extractEpochMs(msgTs);
    const entryEndMs = extractEpochMs(amc.timestamp);
    const liveThinkEndMs =
      typeof msgTs === "number" ? state.thinkingEndByTimestamp.get(msgTs) : undefined;
    const liveMsgEndMs =
      typeof msgTs === "number" ? state.messageEndByTimestamp.get(msgTs) : undefined;

    if (hasProse) {
      const hasLeadingThinking =
        hasThinking && thinkingIdxs.every((idx) => idx < firstTextIdx);
      return {
        kind: "prose",
        child: c,
        hasLeadingThinking,
        timestamp: msgTs,
        startMs: msgStartMs,
        thinkingEndMs: liveThinkEndMs ?? entryEndMs ?? msgStartMs,
      };
    }

    if (isStreaming) {
      return { kind: "active" };
    }

    if (hasStandaloneError) {
      return { kind: "closer", child: c };
    }

    const startMs = msgStartMs ?? entryEndMs;
    const endMs = entryEndMs ?? liveMsgEndMs ?? liveThinkEndMs ?? msgStartMs;

    if (hasThinking) {
      return {
        kind: "thought",
        child: c,
        timestamp: msgTs,
        startMs,
        endMs,
      };
    }

    // Empty toolCall-only assistant wrapper (renders 0 lines).
    return { kind: "transparent", child: c, startMs, endMs };
  }

  if (isToolNode(c)) {
    if (isToolRunningLike(c)) {
      return { kind: "active" };
    }
    const durationMs = extractExplicitToolDurationMs(c.toolName, c.result);
    const rec = c as unknown as Record<symbol, unknown>;
    const liveStartMs = extractEpochMs(rec[TOOL_STARTED_AT_KEY]);
    const finishMs =
      extractEpochMs(c.result?.timestamp) ?? extractEpochMs(rec[TOOL_FINISHED_AT_KEY]);
    const derivedStartMs =
      finishMs !== undefined && durationMs !== undefined
        ? finishMs - durationMs
        : undefined;
    const startMs = liveStartMs ?? derivedStartMs ?? finishMs;
    const endMs =
      finishMs ??
      (liveStartMs !== undefined && durationMs !== undefined
        ? liveStartMs + durationMs
        : liveStartMs);
    return {
      kind: "tool",
      child: c,
      toolName: c.toolName,
      args: c.args,
      result: c.result,
      cwd: c.cwd,
      startMs,
      endMs,
      durationMs,
    };
  }

  if (isCustomChromeComponent(c)) {
    const custom = c as {
      hasContent?: () => boolean;
      timestamp?: unknown;
      message?: { timestamp?: unknown };
      entry?: { timestamp?: unknown };
    };
    if (typeof custom.hasContent === "function" && !custom.hasContent()) {
      return { kind: "transparent", child: c };
    }
    const tsMs =
      extractEpochMs(custom.message?.timestamp) ??
      extractEpochMs(custom.timestamp) ??
      extractEpochMs(custom.entry?.timestamp);
    return { kind: "custom", child: c, startMs: tsMs, endMs: tsMs };
  }

  if (isNonProseTurnCloserComponent(c)) {
    return { kind: "closer", child: c };
  }

  return { kind: "boundary" };
}

function needsLeadBlankBeforeIndex(
  children: readonly unknown[],
  classified: readonly ClassifiedChatChild[],
  startIndex: number,
): boolean {
  for (let k = startIndex - 1; k >= 0; k--) {
    const item = classified[k]!;
    if (item.kind === "transparent") continue;
    if (item.kind === "spacer") {
      if (item.lines > 0) return false;
      continue;
    }
    return shouldGapAfter(children[k]);
  }
  return false;
}

function countVisibleBlocks(
  items: readonly ClassifiedChatChild[],
  absorbsProseLeadingThinking: boolean,
): number {
  let blocks = 0;
  let prevNonSpacerWasGroupableTool = false;

  for (const item of items) {
    if (item.kind === "spacer") continue;
    if (item.kind === "transparent") {
      // AssistantMessage wrapper breaks tool-collapse's sibling groupRunRange
      prevNonSpacerWasGroupableTool = false;
      continue;
    }
    if (item.kind === "thought" || item.kind === "custom") {
      blocks += 1;
      prevNonSpacerWasGroupableTool = false;
      continue;
    }
    if (item.kind === "tool") {
      const groupable = isGroupableTool(item.toolName);
      if (groupable && prevNonSpacerWasGroupableTool) {
        continue;
      }
      blocks += 1;
      prevNonSpacerWasGroupableTool = groupable;
      continue;
    }
    prevNonSpacerWasGroupableTool = false;
  }

  if (absorbsProseLeadingThinking) {
    blocks += 1;
  }
  return blocks;
}

function isRealWorkItem(item: ClassifiedChatChild): boolean {
  return item.kind === "thought" || item.kind === "tool" || item.kind === "custom";
}

export function scanChatWorkRollups(children: readonly unknown[]): WorkRollupScan {
  const classified = children.map(classifyChatChild);
  const segments: WorkRollupSegment[] = [];
  const byStartIndex = new Map<number, WorkRollupSegment>();
  const byProseChild = new Map<object, WorkRollupSegment>();
  const byCloserChild = new Map<object, WorkRollupSegment>();
  const byFirstChild = new Map<object, WorkRollupSegment>();

  let segStart: number | null = null;
  let lastWorkIndex: number | null = null;
  let firstRealWorkIndex: number | null = null;

  for (let i = 0; i < classified.length; i++) {
    const item = classified[i]!;

    if (item.kind === "active" || item.kind === "boundary") {
      segStart = null;
      lastWorkIndex = null;
      firstRealWorkIndex = null;
      continue;
    }

    if (item.kind === "spacer") {
      continue;
    }

    if (item.kind === "transparent") {
      // Include leading transparent Assistant([toolCall]) wrapper so its start
      // timestamp is captured with the segment, if real work follows.
      if (segStart === null && item.startMs !== undefined) {
        segStart = i;
      }
      continue;
    }

    if (isRealWorkItem(item)) {
      if (segStart === null) {
        segStart = i;
      }
      if (firstRealWorkIndex === null) {
        firstRealWorkIndex = i;
      }
      lastWorkIndex = i;
      continue;
    }

    if (item.kind === "prose" || item.kind === "closer") {
      if (
        segStart !== null &&
        firstRealWorkIndex !== null &&
        lastWorkIndex !== null &&
        lastWorkIndex < i
      ) {
        const isProse = item.kind === "prose";
        const absorbsThinking = isProse ? item.hasLeadingThinking : false;
        const slice = classified.slice(segStart, lastWorkIndex + 1);
        const visibleBlocks = countVisibleBlocks(slice, absorbsThinking);
        if (visibleBlocks >= 2) {
          const firstWorkChild = children[firstRealWorkIndex] as object;
          const seg: WorkRollupSegment = {
            startIndex: segStart,
            endIndex: lastWorkIndex,
            proseIndex: i,
            closerIndex: i,
            firstWorkChild,
            proseChild: item.child,
            closerChild: item.child,
            isProseCloser: isProse,
            absorbsProseLeadingThinking: absorbsThinking,
            proseTimestamp: isProse ? item.timestamp : undefined,
            proseStartMs: isProse ? item.startMs : undefined,
            proseThinkingEndMs: isProse ? item.thinkingEndMs : undefined,
            leadBlank: needsLeadBlankBeforeIndex(children, classified, segStart),
            visibleBlocks,
            items: slice,
          };
          segments.push(seg);
          byStartIndex.set(segStart, seg);
          if (isProse) {
            byProseChild.set(item.child, seg);
          }
          byCloserChild.set(item.child, seg);
          byFirstChild.set(firstWorkChild, seg);
        }
      }
      segStart = null;
      lastWorkIndex = null;
      firstRealWorkIndex = null;
    }
  }

  return { segments, byStartIndex, byProseChild, byCloserChild, byFirstChild };
}

function computeSegmentDurationMs(seg: WorkRollupSegment): number | undefined {
  let minStartMs: number | undefined;
  let maxEndMs: number | undefined;
  let hasUntimedNonTool = false;
  let allToolsTimed = true;
  let timedToolCount = 0;
  let toolDurationSum = 0;

  for (const item of seg.items) {
    if (
      item.kind === "transparent" ||
      item.kind === "thought" ||
      item.kind === "tool" ||
      item.kind === "custom"
    ) {
      if (item.startMs !== undefined) {
        minStartMs =
          minStartMs === undefined ? item.startMs : Math.min(minStartMs, item.startMs);
      }
      if (item.endMs !== undefined) {
        maxEndMs =
          maxEndMs === undefined ? item.endMs : Math.max(maxEndMs, item.endMs);
      }
    }

    if (item.kind === "thought" || item.kind === "custom") {
      hasUntimedNonTool = true;
    } else if (item.kind === "tool") {
      if (item.durationMs !== undefined && item.durationMs > 0) {
        timedToolCount += 1;
        toolDurationSum += item.durationMs;
      } else {
        allToolsTimed = false;
      }
    }
  }

  if (seg.isProseCloser) {
    if (seg.absorbsProseLeadingThinking) {
      if (minStartMs === undefined && seg.proseStartMs !== undefined) {
        minStartMs = seg.proseStartMs;
      }
      const endCandidate = seg.proseThinkingEndMs ?? seg.proseStartMs;
      if (endCandidate !== undefined) {
        maxEndMs =
          maxEndMs === undefined ? endCandidate : Math.max(maxEndMs, endCandidate);
      }
    } else if (seg.proseStartMs !== undefined) {
      maxEndMs =
        maxEndMs === undefined
          ? seg.proseStartMs
          : Math.max(maxEndMs, seg.proseStartMs);
    }
  }

  if (minStartMs !== undefined && maxEndMs !== undefined && maxEndMs > minStartMs) {
    return maxEndMs - minStartMs;
  }

  if (
    !hasUntimedNonTool &&
    !seg.absorbsProseLeadingThinking &&
    allToolsTimed &&
    timedToolCount > 0 &&
    toolDurationSum > 0
  ) {
    return toolDurationSum;
  }

  return undefined;
}

function rollupVerbKind(toolName: string): RollupVerbKind {
  const lower = toolName.toLowerCase();
  if (lower === "read") return "read";
  if (lower === "write") return "write";
  if (lower === "edit") return "edit";
  if (lower === "subagent") return "subagent";
  if (lower === "models.classify") return "classify";
  if (lower === "models.generateimages") return "image";
  const mapped = verbKindForTool(toolName);
  switch (mapped) {
    case "file":
      return "read";
    case "search":
      return "search";
    case "dir":
      return "dir";
    case "web_fetch":
      return "web_fetch";
    case "web_search":
      return "web_search";
    case "command":
      return "command";
    case "todo":
      return "todo";
    case "mcp":
      return "mcp";
    case "other":
      return "other";
  }
}

function formatRollupBucket(kind: RollupVerbKind, count: number): string {
  const table: Record<RollupVerbKind, [string, string, string]> = {
    read: ["Read", "file", "files"],
    write: ["Wrote", "file", "files"],
    edit: ["Edited", "file", "files"],
    search: ["Searched", "pattern", "patterns"],
    dir: ["Listed", "dir", "dirs"],
    web_fetch: ["Fetched", "website", "websites"],
    web_search: ["Searched", "website", "websites"],
    command: ["Ran", "command", "commands"],
    subagent: ["Ran", "subagent", "subagents"],
    script: ["Ran", "script", "scripts"],
    todo: ["Updated", "todo", "todos"],
    classify: ["Classified", "item", "items"],
    image: ["Generated", "image", "images"],
    mcp: ["Called", "MCP tool", "MCP tools"],
    other: ["Ran", "tool", "tools"],
  };
  const [verb, singular, plural] = table[kind];
  return `${verb} ${count} ${count === 1 ? singular : plural}`;
}

export function summarizeWorkRollup(seg: WorkRollupSegment): WorkRollupSummary {
  let thoughtCount = seg.absorbsProseLeadingThinking ? 1 : 0;
  let customCount = 0;
  let failedCount = 0;
  const buckets: { kind: RollupVerbKind; count: number }[] = [];

  const addBucket = (kind: RollupVerbKind) => {
    const existing = buckets.find((b) => b.kind === kind);
    if (existing) existing.count += 1;
    else buckets.push({ kind, count: 1 });
  };

  for (const item of seg.items) {
    if (item.kind === "thought") {
      thoughtCount += 1;
      continue;
    }
    if (item.kind === "custom") {
      customCount += 1;
      continue;
    }
    if (item.kind === "tool") {
      if (isCodemodeTool(item.toolName)) {
        const calls = extractCodemodeCalls(item.result?.details);
        const toolErr = item.result?.isError === true;
        if (calls.length > 0) {
          let callErrs = 0;
          for (const call of calls) {
            addBucket(rollupVerbKind(call.name));
            if (call.status === "error") callErrs += 1;
          }
          if (callErrs > 0) failedCount += callErrs;
          else if (toolErr) failedCount += 1;
        } else {
          addBucket("script");
          if (toolErr) failedCount += 1;
        }
        continue;
      }

      addBucket(rollupVerbKind(item.toolName));
      if (item.result?.isError === true) {
        failedCount += 1;
      }
    }
  }

  const actionParts = buckets.map((b) => formatRollupBucket(b.kind, b.count));
  if (customCount > 0) {
    actionParts.push(`${customCount} ${customCount === 1 ? "message" : "messages"}`);
  }

  const cappedParts =
    actionParts.length > MAX_DISPLAY_BUCKETS
      ? [
          ...actionParts.slice(0, MAX_DISPLAY_BUCKETS),
          `+${actionParts.length - MAX_DISPLAY_BUCKETS} more`,
        ]
      : actionParts;
  const actionsStr = cappedParts.join(", ");

  let label: string;
  if (thoughtCount > 0 && actionsStr) {
    label = `Thought · ${actionsStr}`;
  } else if (thoughtCount > 0) {
    label = `Thought (${thoughtCount})`;
  } else {
    label = actionsStr || "Steps";
  }

  const durationMs = computeSegmentDurationMs(seg);
  const formattedDur = formatRollupDuration(durationMs);

  return {
    kind: failedCount > 0 ? "group_err" : "group",
    label,
    failedSuffix: failedCount > 0 ? ` · ${failedCount} failed` : undefined,
    durationMs,
    durationSuffix: formattedDur ? ` · ${formattedDur}` : undefined,
  };
}

export function rollupFoldId(closerTarget: object): string {
  return `${idForTarget(closerTarget)}:r`;
}

function isRollupModeActive(): boolean {
  const state = getState();
  return state.toolViewMode === "chrome" && !state.globalExpanded;
}

function segmentHasExplicitInnerExpand(seg: WorkRollupSegment): boolean {
  const state = getState();
  for (const item of seg.items) {
    if (item.kind === "thought") {
      if (item.timestamp !== undefined && state.thinkingOverrides.get(item.timestamp) === true) {
        return true;
      }
      continue;
    }
    if (item.kind === "tool" || item.kind === "custom") {
      // Codemode collapses into single-line state once the turn rolls up.
      if (item.kind === "tool" && isCodemodeTool(item.toolName)) {
        continue;
      }
      const ov = getViewOverride(item.child);
      if (ov !== undefined && ov !== "chrome") return true;
      if (item.kind === "tool" && isGroupExpanded(item.child)) return true;
    }
  }
  if (
    seg.absorbsProseLeadingThinking &&
    seg.proseTimestamp !== undefined &&
    state.thinkingOverrides.get(seg.proseTimestamp) === true
  ) {
    return true;
  }
  return false;
}

function ensureRollupSeeded(seg: WorkRollupSegment): boolean {
  if (!isWorkRollupInitialized(seg.closerChild)) {
    markWorkRollupInitialized(seg.closerChild);
    for (const item of seg.items) {
      if (item.kind === "tool" && isCodemodeTool(item.toolName)) {
        clearViewOverride(item.child);
      }
    }
    if (segmentHasExplicitInnerExpand(seg)) {
      setWorkRollupExpanded(seg.closerChild, true);
    }
  }
  return isWorkRollupExpanded(seg.closerChild);
}

function getScanForParent(parent: { children?: unknown[] } | null): WorkRollupScan | undefined {
  if (!parent || !Array.isArray(parent.children) || parent.children.length < 2) {
    return undefined;
  }
  const passCached = (parent as Record<symbol, unknown>)[ROLLUP_PASS_KEY] as
    | WorkRollupScan
    | undefined;
  if (passCached) return passCached;
  return scanChatWorkRollups(parent.children);
}

function hasOpenRollupHeaderAbove(node: unknown): boolean {
  if (!node || typeof node !== "object" || !isRollupModeActive()) return false;
  const parent = getParent(node);
  const scan = getScanForParent(parent);
  const seg = scan?.byFirstChild.get(node);
  if (!seg) return false;
  return ensureRollupSeeded(seg);
}

function isProseRollupCollapsed(node: unknown): boolean {
  if (!node || typeof node !== "object" || !isRollupModeActive()) return false;
  const parent = getParent(node);
  const scan = getScanForParent(parent);
  const seg = scan?.byProseChild.get(node);
  if (!seg) return false;
  return !ensureRollupSeeded(seg);
}

export function toggleWorkRollupAt(closerTarget: object): boolean {
  const next = !isWorkRollupExpanded(closerTarget);
  markWorkRollupInitialized(closerTarget);
  setWorkRollupExpanded(closerTarget, next);
  const parent = getParent(closerTarget);
  if (parent && Array.isArray(parent.children)) {
    const scan = scanChatWorkRollups(parent.children);
    const seg = scan.byCloserChild.get(closerTarget);
    if (seg) {
      relayoutChild(seg.firstWorkChild);
    }
  }
  return next;
}

interface RollupHeaderCache {
  width: number;
  leadBlank: boolean;
  kind: ChromeKind;
  label: string;
  failedSuffix: string | undefined;
  durationSuffix: string | undefined;
  tuiMode: string;
  clickFoldReady: boolean;
  hovered: boolean;
  themeSample: string;
  lines: string[];
}

type RenderableChild = { render(width: number): string[] };

export async function installWorkRollupPatch(): Promise<() => void> {
  const { theme: rawTheme } = await importInternal<{ theme: unknown }>(
    PI_CODING_AGENT,
    INTERNAL_MODULES.theme,
  );
  const theme = rawTheme as ChromeTheme;

  const proto = Container.prototype as unknown as {
    children?: unknown[];
    mouseLayout?: {
      width: number;
      children: Array<{ component: unknown; height: number }>;
    };
    render: (width: number) => string[];
  };

  const prevRender = proto.render;
  const headerCache = new WeakMap<object, RollupHeaderCache>();
  const wasUnderOpenHeader = new WeakMap<object, boolean>();

  setWorkRollupHooks({
    hasOpenRollupHeaderAbove,
    isProseRollupCollapsed,
  });
  getState().workRollupInstalled = true;

  const renderRollupHeaderLines = (seg: WorkRollupSegment, width: number): string[] => {
    const id = rollupFoldId(seg.closerChild);
    const onClick = () => {
      toggleWorkRollupAt(seg.closerChild);
    };
    registerFoldHandler(id, onClick);

    const summary = summarizeWorkRollup(seg);
    const state = getState();
    const hovered =
      state.tuiMode === "fullscreen" &&
      state.clickFoldReady &&
      state.hoveredFoldId === id;
    const themeSample = theme.fg("muted", "m");

    const hit = headerCache.get(seg.closerChild);
    if (
      hit &&
      hit.width === width &&
      hit.leadBlank === seg.leadBlank &&
      hit.kind === summary.kind &&
      hit.label === summary.label &&
      hit.failedSuffix === summary.failedSuffix &&
      hit.durationSuffix === summary.durationSuffix &&
      hit.tuiMode === state.tuiMode &&
      hit.clickFoldReady === state.clickFoldReady &&
      hit.hovered === hovered &&
      hit.themeSample === themeSample
    ) {
      return hit.lines;
    }

    const pad = RESPONSE_LEFT_PAD;
    const sp = pad > 0 ? " ".repeat(pad) : "";
    const inner = Math.max(1, width - pad);
    const line =
      sp +
      renderClickableChrome(inner, theme, {
        kind: summary.kind,
        label: summary.label,
        failedSuffix: summary.failedSuffix,
        metaSuffix: summary.durationSuffix,
        hintKind: "tool",
        id,
        onClick,
      });

    const lines = seg.leadBlank ? ["", line] : [line];
    headerCache.set(seg.closerChild, {
      width,
      leadBlank: seg.leadBlank,
      kind: summary.kind,
      label: summary.label,
      failedSuffix: summary.failedSuffix,
      durationSuffix: summary.durationSuffix,
      tuiMode: state.tuiMode,
      clickFoldReady: state.clickFoldReady,
      hovered,
      themeSample,
      lines,
    });
    return lines;
  };

  proto.render = function (this: typeof proto, width: number): string[] {
    if (
      this.constructor !== Container ||
      !Array.isArray(this.children) ||
      this.children.length < 2
    ) {
      return prevRender.call(this, width);
    }

    let hasChatTurn = false;
    for (const c of this.children) {
      if (isAssistantMessageComponent(c) || isUserMessageComponent(c)) {
        hasChatTurn = true;
        break;
      }
    }
    if (!hasChatTurn) {
      return prevRender.call(this, width);
    }

    if (!isRollupModeActive()) {
      (this as unknown as Record<symbol, unknown>)[ROLLUP_PASS_KEY] = undefined;
      for (const c of this.children) {
        if (c && typeof c === "object" && wasUnderOpenHeader.get(c) === true) {
          wasUnderOpenHeader.delete(c);
          relayoutChild(c);
        }
      }
      return prevRender.call(this, width);
    }

    ensureContainerStamped(this);
    const scan = scanChatWorkRollups(this.children);
    if (scan.segments.length === 0) {
      (this as unknown as Record<symbol, unknown>)[ROLLUP_PASS_KEY] = undefined;
      return prevRender.call(this, width);
    }

    (this as unknown as Record<symbol, unknown>)[ROLLUP_PASS_KEY] = scan;
    try {
      const lines: string[] = [];
      const mouseChildren: Array<{ component: unknown; height: number }> = [];

      let i = 0;
      while (i < this.children.length) {
        const seg = scan.byStartIndex.get(i);
        if (!seg) {
          const child = this.children[i] as RenderableChild | undefined;
          if (child && typeof child === "object" && wasUnderOpenHeader.get(child) === true) {
            wasUnderOpenHeader.delete(child);
            relayoutChild(child);
          }
          const childLines = child ? child.render(width) : [];
          mouseChildren.push({ component: child, height: childLines.length });
          for (const line of childLines) lines.push(line);
          i += 1;
          continue;
        }

        const open = ensureRollupSeeded(seg);
        const headerLines = renderRollupHeaderLines(seg, width);
        mouseChildren.push({
          component: NOOP_MOUSE_COMPONENT,
          height: headerLines.length,
        });
        for (const line of headerLines) lines.push(line);

        if (!open) {
          if (wasUnderOpenHeader.get(seg.firstWorkChild) === true) {
            wasUnderOpenHeader.set(seg.firstWorkChild, false);
          }
          for (let k = seg.startIndex; k <= seg.endIndex; k++) {
            mouseChildren.push({ component: this.children[k], height: 0 });
          }
          i = seg.endIndex + 1;
          continue;
        }

        if (wasUnderOpenHeader.get(seg.firstWorkChild) !== true) {
          wasUnderOpenHeader.set(seg.firstWorkChild, true);
          relayoutChild(seg.firstWorkChild);
        }

        for (let k = seg.startIndex; k <= seg.endIndex; k++) {
          const child = this.children[k] as RenderableChild | undefined;
          const childLines = child ? child.render(width) : [];
          mouseChildren.push({ component: child, height: childLines.length });
          for (const line of childLines) lines.push(line);
        }
        i = seg.endIndex + 1;
      }

      this.mouseLayout = { width, children: mouseChildren };
      return lines;
    } finally {
      (this as unknown as Record<symbol, unknown>)[ROLLUP_PASS_KEY] = undefined;
    }
  };

  return () => {
    proto.render = prevRender;
    getState().workRollupInstalled = false;
    setWorkRollupHooks(undefined);
  };
}
