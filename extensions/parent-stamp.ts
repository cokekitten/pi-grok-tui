/**
 * Stamp parent container on children when addChild runs (display-only metadata).
 * Lets Thinking / ToolExecution / CustomMessage / CustomEntry inspect previous
 * chat siblings for Grok spacing, including after /reload where chatContainer
 * may be populated before session_start re-installs patches.
 */
import { Container } from "@earendil-works/pi-tui";
import { effectiveToolMode } from "./tool-click.js";
import { getState, getToolViewMode } from "./state.js";

const PARENT_KEY = "__piThinkingScrollParent";
export const CUSTOM_CHROME_MARK = "__piCustomChrome";
const ROLLUP_HOOKS_KEY = Symbol.for("pi-grok-tui.rollupHooks");

export interface WorkRollupHooks {
  hasOpenRollupHeaderAbove(node: unknown): boolean;
  isProseRollupCollapsed(node: unknown): boolean;
}

export function setWorkRollupHooks(hooks: WorkRollupHooks | undefined): void {
  (globalThis as Record<symbol, unknown>)[ROLLUP_HOOKS_KEY] = hooks;
}

export function getWorkRollupHooks(): WorkRollupHooks | undefined {
  if (!getState().workRollupInstalled) return undefined;
  return (globalThis as Record<symbol, unknown>)[ROLLUP_HOOKS_KEY] as
    | WorkRollupHooks
    | undefined;
}

let relayoutDepth = 0;

export function getParent(node: unknown): { children?: unknown[] } | null {
  if (!node || typeof node !== "object") return null;
  const p = (node as Record<string, unknown>)[PARENT_KEY];
  if (p && typeof p === "object") return p as { children?: unknown[] };
  return null;
}

export function getSiblings(node: unknown): unknown[] | null {
  const parent = getParent(node);
  if (!parent || !Array.isArray(parent.children)) return null;
  return parent.children;
}

export function getPreviousSibling(node: unknown): unknown | null {
  const siblings = getSiblings(node);
  if (!siblings) return null;
  const idx = siblings.indexOf(node);
  if (idx <= 0) return null;
  return siblings[idx - 1] ?? null;
}

export function getNextSibling(node: unknown): unknown | null {
  const siblings = getSiblings(node);
  if (!siblings) return null;
  const idx = siblings.indexOf(node);
  if (idx < 0 || idx + 1 >= siblings.length) return null;
  return siblings[idx + 1] ?? null;
}

/** Heuristic: pi UserMessageComponent */
export function isUserMessageComponent(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (typeof o.toolName === "string") return false;
  if (typeof o.updateContent === "function") return false;
  if (typeof o.updateDisplay === "function") return false;
  if (typeof o.rebuild === "function" && (typeof o.text === "string" || "text" in o)) {
    return true;
  }
  const name = (c as { constructor?: { name?: string } }).constructor?.name;
  return name === "UserMessageComponent";
}

/** Heuristic: pi AssistantMessageComponent */
export function isAssistantMessageComponent(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (typeof o.toolName === "string") return false;
  if (typeof o.updateContent === "function" && o.contentContainer != null) return true;
  const name = (c as { constructor?: { name?: string } }).constructor?.name;
  return name === "AssistantMessageComponent";
}

/** Heuristic: CustomMessageComponent or CustomEntryComponent managed by grok-tui */
export function isCustomChromeComponent(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (o[CUSTOM_CHROME_MARK]) return true;
  if (typeof o.rebuild !== "function") return false;
  if ("customRenderer" in o && "message" in o) return true;
  if ("renderer" in o && "entry" in o) return true;
  return false;
}

export function assistantHasProse(c: unknown): boolean {
  if (!isAssistantMessageComponent(c)) return false;
  const msg = (c as { lastMessage?: { content?: Array<{ type?: string; text?: string }> } })
    .lastMessage;
  if (!msg?.content) return false;
  return msg.content.some(
    (b) => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0,
  );
}

/** Finished assistant turn with no thinking/toolCall/prose that surfaces an error/abort row. */
export function assistantHasFinishedStandaloneError(c: unknown): boolean {
  if (!isAssistantMessageComponent(c)) return false;
  const amc = c as {
    isStreaming?: boolean;
    lastMessage?: {
      stopReason?: string;
      content?: Array<{ type?: string; text?: string; thinking?: string; redacted?: boolean }>;
    };
  };
  if (amc.isStreaming) return false;
  const msg = amc.lastMessage;
  if (
    msg?.stopReason !== "aborted" &&
    msg?.stopReason !== "error" &&
    msg?.stopReason !== "length"
  ) {
    return false;
  }
  const content = Array.isArray(msg?.content) ? msg.content : [];
  const hasProse = content.some(
    (b) => b?.type === "text" && typeof b.text === "string" && b.text.trim().length > 0,
  );
  if (hasProse) return false;
  const hasThinking = content.some(
    (b) =>
      b?.type === "thinking" &&
      !b.redacted &&
      typeof b.thinking === "string" &&
      b.thinking.trim().length > 0,
  );
  const hasToolCalls = content.some((b) => b?.type === "toolCall");
  return !hasThinking && !hasToolCalls;
}

/** Non-prose chat boundary that closes a preceding agent work run (user prompt, /skill, !bash, compaction/branch summary, standalone error). */
export function isNonProseTurnCloserComponent(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  if (isUserMessageComponent(c)) return true;
  if (assistantHasFinishedStandaloneError(c)) return true;
  const o = c as Record<string, unknown>;
  if ("skillBlock" in o && o.skillBlock != null) return true;
  if (typeof o.setComplete === "function" && typeof o.appendOutput === "function") {
    return true;
  }
  const name = (c as { constructor?: { name?: string } }).constructor?.name;
  if (
    name === "SkillInvocationMessageComponent" ||
    name === "BashExecutionComponent" ||
    name === "CompactionSummaryMessageComponent" ||
    name === "BranchSummaryMessageComponent"
  ) {
    return true;
  }
  if (o.message && typeof o.message === "object" && !isCustomChromeComponent(c)) {
    const role = (o.message as { role?: unknown }).role;
    if (role === "compactionSummary" || role === "branchSummary") return true;
  }
  return false;
}

/** True for any chat child that marks the completion/termination of a preceding work run. */
export function isChatTurnCloserNode(c: unknown): boolean {
  return assistantHasProse(c) || isNonProseTurnCloserComponent(c);
}

/**
 * True when `node` sits inside a real chat container (containing user/assistant
 * turns) and no turn-closing component (assistant prose, next user prompt, etc.)
 * has appeared after `node` yet — i.e., the agent turn is still executing.
 */
export function isNodeInUnclosedChatTurn(node: unknown): boolean {
  const siblings = getSiblings(node);
  if (!siblings || siblings.length < 2) return false;
  if (isChatTurnCloserNode(siblings[siblings.length - 1])) {
    return false;
  }
  const idx = siblings.indexOf(node);
  if (idx < 0) return false;
  for (let k = siblings.length - 1; k > idx; k--) {
    if (isChatTurnCloserNode(siblings[k])) {
      return false;
    }
  }
  for (let k = 0; k < siblings.length; k++) {
    if (isAssistantMessageComponent(siblings[k]) || isUserMessageComponent(siblings[k])) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a blank line should separate `prev` from the next chrome/content row.
 *
 * Tool / custom chrome (one-line titles): stack tightly with following Thought/tools/custom rows.
 * Expanded bodies: leave one blank before the next block so body text does not stick to ◆/◇.
 */
export function shouldGapAfter(prev: unknown | null): boolean {
  if (!prev) return false;
  if (isUserMessageComponent(prev)) return true;
  if (isAssistantMessageComponent(prev)) return assistantHasProse(prev);
  if (
    prev &&
    typeof prev === "object" &&
    typeof (prev as { toolName?: unknown }).toolName === "string"
  ) {
    const t = prev as { expanded?: boolean; hideComponent?: boolean; toolName: string };
    if (t.hideComponent) return false;
    const mode = effectiveToolMode(t, t.toolName);
    // codemode keeps compact spacing in both collapsed ("chrome") and subcall
    // tree ("truncated") modes; only "full" shows an expanded script/output body.
    if (t.toolName === "codemode") {
      return mode === "full" || Boolean(t.expanded);
    }
    // truncated/full (global or per-tool click override, plus edit/write) show
    // a tool body even when `expanded` is false.
    if (mode !== "chrome") return true;
    if (t.expanded) return true;
    return false;
  }
  if (isCustomChromeComponent(prev)) {
    if (getToolViewMode() !== "chrome") return true;
    return Boolean((prev as { _expanded?: boolean })._expanded);
  }
  return true;
}

/**
 * Whether a compact chrome child should insert a leading blank line.
 * Suppresses the gap when an expanded work-rollup header sits directly above it.
 */
export function shouldGapBefore(self: unknown): boolean {
  const hooks = getWorkRollupHooks();
  if (hooks?.hasOpenRollupHeaderAbove(self)) return false;
  return shouldGapAfter(getPreviousSibling(self));
}

function isRelayoutTarget(child: unknown): boolean {
  if (!child || typeof child !== "object") return false;
  const o = child as Record<string, unknown>;
  // ToolExecutionComponent
  if (typeof o.toolName === "string" && typeof o.updateDisplay === "function") return true;
  // AssistantMessageComponent
  if (typeof o.updateContent === "function" && o.contentContainer != null) return true;
  // CustomMessageComponent / CustomEntryComponent (including pre-/reload instances)
  if (typeof o.__syncCustomLeadSpacer === "function" || isCustomChromeComponent(child)) {
    return true;
  }
  return false;
}

export function relayoutChild(child: unknown): void {
  if (relayoutDepth > 0) return;
  if (!isRelayoutTarget(child)) return;

  const o = child as {
    lastMessage?: unknown;
    updateContent?: (msg: unknown) => void;
    updateDisplay?: () => void;
    __syncCustomLeadSpacer?: () => void;
  };

  relayoutDepth += 1;
  try {
    if (typeof o.__syncCustomLeadSpacer === "function") {
      o.__syncCustomLeadSpacer();
      return;
    }
    if (typeof o.updateContent === "function" && o.lastMessage != null) {
      o.updateContent(o.lastMessage);
      return;
    }
    if (typeof o.updateDisplay === "function") {
      o.updateDisplay();
    }
  } catch {
    // Never let resume rebuild blow up into showExtensionError red flash.
  } finally {
    relayoutDepth -= 1;
  }
}

export function ensureContainerStamped(container: { children?: unknown[] }): void {
  if (!Array.isArray(container.children)) return;
  let hasUnstampedTarget = false;
  for (const child of container.children) {
    if (
      (isRelayoutTarget(child) || isChatTurnCloserNode(child)) &&
      (child as Record<string, unknown>)[PARENT_KEY] !== container
    ) {
      hasUnstampedTarget = true;
      break;
    }
  }
  if (!hasUnstampedTarget) return;
  const newlyStamped: unknown[] = [];
  for (const child of container.children) {
    if (
      child &&
      typeof child === "object" &&
      (child as Record<string, unknown>)[PARENT_KEY] !== container
    ) {
      (child as Record<string, unknown>)[PARENT_KEY] = container;
      if (isRelayoutTarget(child)) {
        newlyStamped.push(child);
      }
    }
  }
  for (const child of newlyStamped) {
    relayoutChild(child);
    const next = getNextSibling(child);
    if (next) relayoutChild(next);
  }
}

export function installParentStamp(): () => void {
  const proto = Container.prototype as {
    addChild: (this: { children?: unknown[] }, child: unknown) => void;
    render?: (this: { children?: unknown[] }, width: number) => string[];
  };
  const originalAddChild = proto.addChild;
  const originalRender = proto.render;

  proto.addChild = function (this: { children?: unknown[] }, child: unknown) {
    if (child && typeof child === "object") {
      (child as Record<string, unknown>)[PARENT_KEY] = this;
    }
    const ret = originalAddChild.call(this, child);
    // Only top-level assistant/tool/custom — not every Spacer/Text under them.
    relayoutChild(child);
    return ret;
  };

  if (typeof originalRender === "function") {
    proto.render = function (this: { children?: unknown[] }, width: number) {
      ensureContainerStamped(this);
      return originalRender.call(this, width);
    };
  }

  return () => {
    proto.addChild = originalAddChild;
    if (typeof originalRender === "function") {
      proto.render = originalRender;
    }
  };
}
