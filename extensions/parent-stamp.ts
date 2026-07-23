/**
 * Stamp each TUI child with its parent Container so chrome spacing can
 * inspect previous siblings (user message → first thought/tool, prose → tool).
 *
 * Important: pi often constructs AssistantMessage/ToolExecution and runs
 * updateContent/updateDisplay *before* chatContainer.addChild. We therefore
 * re-run layout after stamping the parent so leading spacers apply.
 *
 * Relayout is restricted to top-level assistant/tool components and is
 * reentrancy-guarded so nested addChild during updateContent never storms.
 */
import { Container } from "@earendil-works/pi-tui";

const PARENT_KEY = "__piThinkingScrollParent";

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

export function assistantHasProse(c: unknown): boolean {
  if (!isAssistantMessageComponent(c)) return false;
  const msg = (c as { lastMessage?: { content?: Array<{ type?: string; text?: string }> } })
    .lastMessage;
  if (!msg?.content) return false;
  return msg.content.some(
    (b) => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0,
  );
}

/**
 * Whether a blank line should separate `prev` from the next chrome/content row.
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
    const t = prev as { expanded?: boolean; hideComponent?: boolean };
    if (t.hideComponent) return false;
    if (t.expanded) return true;
    return false;
  }
  return true;
}

function isRelayoutTarget(child: unknown): boolean {
  if (!child || typeof child !== "object") return false;
  const o = child as Record<string, unknown>;
  // ToolExecutionComponent
  if (typeof o.toolName === "string" && typeof o.updateDisplay === "function") return true;
  // AssistantMessageComponent
  if (typeof o.updateContent === "function" && o.contentContainer != null) return true;
  return false;
}

function relayoutChild(child: unknown): void {
  if (relayoutDepth > 0) return;
  if (!isRelayoutTarget(child)) return;

  const o = child as {
    lastMessage?: unknown;
    updateContent?: (msg: unknown) => void;
    updateDisplay?: () => void;
  };

  relayoutDepth += 1;
  try {
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

export function installParentStamp(): () => void {
  const proto = Container.prototype as {
    addChild: (this: { children?: unknown[] }, child: unknown) => void;
  };
  const original = proto.addChild;
  proto.addChild = function (this: { children?: unknown[] }, child: unknown) {
    if (child && typeof child === "object") {
      (child as Record<string, unknown>)[PARENT_KEY] = this;
    }
    const ret = original.call(this, child);
    // Only top-level assistant/tool — not every Spacer/Text under them.
    relayoutChild(child);
    return ret;
  };
  return () => {
    proto.addChild = original;
  };
}
