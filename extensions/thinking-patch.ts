/**
 * Monkey-patch AssistantMessageComponent to use ThinkingScrollComponent.
 */
import { Spacer, Text } from "@earendil-works/pi-tui";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import {
  getPreviousSibling,
  getWorkRollupHooks,
  shouldGapAfter,
} from "./parent-stamp.js";
import { RESPONSE_LEFT_PAD, safeFg } from "./chrome.js";
import { bumpChatLayoutVersion } from "./state.js";
import { ThinkingScrollComponent, type ThinkingThemeLike } from "./thinking-render.js";
import { markdownTransformFor, type MarkdownTransformSource } from "./markdown-transform.ts";
import { TranscriptMarkdown } from "./transcript-markdown.js";

const AMC_PATCHED_GEN = Symbol.for("pi-grok-tui.amcPatchGen");
let amcGeneration = 0;

const EMPTY_LINES: readonly string[] = Object.freeze([]);
const ONE_BLANK_LINE: readonly string[] = Object.freeze([""]);

interface ContentBlock {
  type: string;
  thinking?: string;
  text?: string;
  redacted?: boolean;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  timestamp: number;
  stopReason?: string;
  errorMessage?: string;
}

interface AssistantMessageComponentProto extends MarkdownTransformSource {
  updateContent(message: AssistantMessage, isStreaming?: boolean): void;
  render?(width: number): string[];
  outputPad?: number;
  setHideThinkingBlock(hide: boolean): void;
  setHiddenThinkingLabel(label: string): void;
  contentContainer: {
    clear(): void;
    addChild(component: unknown): void;
    children?: unknown[];
    mouseLayout?: unknown;
  };
  mouseLayout?: unknown;
  lastMessage?: AssistantMessage;
  isStreaming?: boolean;
  hideThinkingBlock: boolean;
  markdownTheme: unknown;
  hiddenThinkingLabel: string;
  hasToolCalls: boolean;
  [AMC_PATCHED_GEN]?: number;
}

function createDynamicLeadGap(
  owner: AssistantMessageComponentProto,
  opts: { hasText: boolean; startsWithText: boolean },
): { render(width: number): string[]; invalidate(): void } {
  return {
    render(_width: number): string[] {
      const hooks = getWorkRollupHooks();
      if (hooks?.isProseRollupCollapsed(owner)) {
        return ONE_BLANK_LINE as string[];
      }
      if (hooks?.hasOpenRollupHeaderAbove(owner)) {
        return EMPTY_LINES as string[];
      }
      const prev = getPreviousSibling(owner);
      if (shouldGapAfter(prev)) {
        return ONE_BLANK_LINE as string[];
      }
      if (opts.hasText && prev == null) {
        return ONE_BLANK_LINE as string[];
      }
      if (opts.hasText && opts.startsWithText) {
        return ONE_BLANK_LINE as string[];
      }
      return EMPTY_LINES as string[];
    },
    invalidate() {},
  };
}

function createCollapsibleLeadingThinking(
  owner: AssistantMessageComponentProto,
  thinkingComp: ThinkingScrollComponent,
): { render(width: number): string[]; invalidate(): void } {
  let cachedThinkingRef: readonly string[] | undefined;
  let cachedWithGap: string[] | undefined;

  return {
    render(width: number): string[] {
      const hooks = getWorkRollupHooks();
      if (hooks?.isProseRollupCollapsed(owner)) {
        return EMPTY_LINES as string[];
      }
      const tLines = thinkingComp.render(width);
      if (cachedWithGap && cachedThinkingRef === tLines) {
        return cachedWithGap;
      }
      cachedThinkingRef = tLines;
      cachedWithGap = [...tLines, ""];
      return cachedWithGap;
    },
    invalidate() {
      cachedThinkingRef = undefined;
      cachedWithGap = undefined;
      thinkingComp.invalidate();
    },
  };
}

export async function installThinkingPatch(): Promise<() => void> {
  const [
    { AssistantMessageComponent: rawAmc },
    { theme: rawTheme },
  ] = await Promise.all([
    importInternal<{ AssistantMessageComponent: unknown }>(
      PI_CODING_AGENT,
      INTERNAL_MODULES.assistantMessageComponent,
    ),
    importInternal<{ theme: unknown }>(PI_CODING_AGENT, INTERNAL_MODULES.theme),
  ]);

  if (!rawAmc || (typeof rawAmc !== "function" && typeof rawAmc !== "object")) {
    throw new Error("pi-grok-tui: AssistantMessageComponent missing");
  }

  const Amc = rawAmc as { prototype: AssistantMessageComponentProto };
  const prototype = Amc.prototype;
  const uiTheme = rawTheme as ThinkingThemeLike;

  if (typeof prototype.updateContent !== "function") {
    throw new Error("pi-grok-tui: updateContent not found");
  }

  const generation = ++amcGeneration;
  const originalUpdateContent = prototype.updateContent;
  const originalRender = prototype.render;
  const originalSetHideThinkingBlock = prototype.setHideThinkingBlock;
  const originalSetHiddenThinkingLabel = prototype.setHiddenThinkingLabel;

  type RenderSlot =
    | { kind: "text"; component: TranscriptMarkdown }
    | { kind: "thinking"; component: ThinkingScrollComponent };
  // Patch-local state neither retains old sessions nor collides with Pi's own
  // markdownSlots. A new patch generation starts with clean slots after /reload.
  const renderStates = new WeakMap<object, {
    slots: RenderSlot[];
    markdownTheme: unknown;
    outputPad?: number;
    timestamp: number;
  }>();
  const amcRenderCache = new WeakMap<object, {
    width: number;
    hasToolCalls: boolean;
    kids: unknown[];
    kidOutputs: Array<readonly string[] | number>;
    innerMouseLayout: unknown;
    outerMouseLayout: unknown;
    lines: string[];
  }>();

  const patchedUpdateContent = function (
    this: AssistantMessageComponentProto,
    message: AssistantMessage,
    isStreaming = this.isStreaming ?? false,
  ) {
    this[AMC_PATCHED_GEN] = generation;
    amcRenderCache.delete(this);
    bumpChatLayoutVersion();
    this.lastMessage = message;
    this.isStreaming = isStreaming;

    if (!this.contentContainer || typeof this.contentContainer.clear !== "function") {
      return originalUpdateContent.call(this, message, isStreaming);
    }

    try {
      this.contentContainer.clear();
      const previous = renderStates.get(this);
      const reusable = previous !== undefined &&
        previous.markdownTheme === this.markdownTheme &&
        previous.outputPad === this.outputPad && previous.timestamp === message.timestamp;
      const previousSlots = reusable ? previous.slots : [];
      const slots: RenderSlot[] = [];
      renderStates.set(this, { slots, markdownTheme: this.markdownTheme, outputPad: this.outputPad, timestamp: message.timestamp });

      const thinkingBlocks = message.content.filter(
        (c) => c.type === "thinking" && !c.redacted && (c.thinking || "").trim().length > 0,
      );
      const hasThinking = thinkingBlocks.length > 0;
      const hasText = message.content.some(
        (c) => c.type === "text" && (c.text || "").trim().length > 0,
      );
      const hasToolCalls = message.content.some((c) => c.type === "toolCall");
      this.hasToolCalls = hasToolCalls;

      const firstMeaningful = message.content.find(
        (c) =>
          (c.type === "text" && (c.text || "").trim().length > 0) ||
          (c.type === "thinking" && !c.redacted && (c.thinking || "").trim().length > 0),
      );
      const startsWithText = firstMeaningful?.type === "text";

      // Dynamic lead gap adapts without re-running updateContent when a
      // pre-prose work rollup collapses, opens, or dissolves (Ctrl+O / Alt+T).
      if (hasThinking || hasText) {
        this.contentContainer.addChild(
          createDynamicLeadGap(this, { hasText, startsWithText }),
        );
      }

      let renderedThinking = false;
      const lastThinkingBlock =
        thinkingBlocks.length > 0 ? thinkingBlocks[thinkingBlocks.length - 1]! : null;
      const lastThinkingIndex = lastThinkingBlock
        ? message.content.indexOf(lastThinkingBlock)
        : -1;
      const hasTextAfterThinking =
        hasThinking &&
        message.content.some(
          (c, i) =>
            c.type === "text" && (c.text || "").trim().length > 0 && i > lastThinkingIndex,
        );
      const hasTextBeforeThinking =
        hasThinking &&
        message.content.some(
          (c, i) =>
            c.type === "text" && (c.text || "").trim().length > 0 && i < lastThinkingIndex,
        );

      // Match user-message ❯ column (see RESPONSE_LEFT_PAD).
      const padX = RESPONSE_LEFT_PAD;

      for (const block of message.content) {
        if (block.type === "text" && (block.text || "").trim().length > 0) {
          const text = (block.text || "").trim();
          const slot = previousSlots[slots.length];
          const component = slot?.kind === "text" ? slot.component : new TranscriptMarkdown(
            text, padX, 0, this.markdownTheme as any, undefined,
            { transform: markdownTransformFor(this, "assistant") },
          );
          component.setText(text);
          slots.push({ kind: "text", component });
          this.contentContainer.addChild(component);
          continue;
        }

        if (block.type === "thinking" && hasThinking && !renderedThinking) {
          if (hasTextBeforeThinking) {
            this.contentContainer.addChild(new Spacer(1));
          }
          const blocks = thinkingBlocks.map((b) => ({ text: b.thinking || "", redacted: b.redacted }));
          const slot = previousSlots[slots.length];
          const component = slot?.kind === "thinking" ? slot.component : new ThinkingScrollComponent(
            uiTheme, this.markdownTheme, message.timestamp, blocks,
            markdownTransformFor(this, "assistant-thinking"),
          );
          component.setThinkingBlocks(blocks);
          slots.push({ kind: "thinking", component });
          renderedThinking = true;

          if (!hasTextBeforeThinking && hasTextAfterThinking) {
            // Leading thinking right above prose in the same message can be
            // absorbed into the collapsed pre-prose work rollup above.
            this.contentContainer.addChild(
              createCollapsibleLeadingThinking(this, component),
            );
          } else {
            this.contentContainer.addChild(component);
            if (hasTextAfterThinking) {
              this.contentContainer.addChild(new Spacer(1));
            }
          }
        }
      }

      // Surface hard failures only when there's no tool row to own the error.
      if (!hasToolCalls && !hasThinking) {
        if (message.stopReason === "aborted") {
          const raw =
            message.errorMessage && message.errorMessage !== "Request was aborted"
              ? message.errorMessage
              : "Aborted";
          const msg = raw.split("\n")[0]!.slice(0, 200);
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(safeFg(uiTheme, "error", msg), padX, 0) as any,
          );
        } else if (message.stopReason === "error") {
          const raw = (message.errorMessage || "Unknown").split("\n")[0]!.slice(0, 200);
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(safeFg(uiTheme, "error", `Error: ${raw}`), padX, 0) as any,
          );
        } else if (message.stopReason === "length") {
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(
              safeFg(
                uiTheme,
                "error",
                "Error: hit max output tokens (response may be incomplete)",
              ),
              padX,
              0,
            ) as any,
          );
        }
      }

      this.hideThinkingBlock = false;
    } catch {
      try {
        this.contentContainer.clear();
      } catch {
        /* unrecoverable */
      }
    }
  };

  const patchedSetHideThinkingBlock = function (
    this: AssistantMessageComponentProto,
    _hide: boolean,
  ) {
    this.hideThinkingBlock = false;
  };

  prototype.updateContent = patchedUpdateContent as any;
  prototype.setHideThinkingBlock = patchedSetHideThinkingBlock as any;
  prototype.setHiddenThinkingLabel = patchedSetHideThinkingBlock as any;

  if (typeof originalRender === "function") {
    prototype.render = function (this: AssistantMessageComponentProto, width: number): string[] {
      if (this[AMC_PATCHED_GEN] !== generation && this.lastMessage) {
        this[AMC_PATCHED_GEN] = generation;
        try {
          this.updateContent(this.lastMessage, this.isStreaming ?? false);
        } catch {
          /* never break render */
        }
      }

      const kids = !this.isStreaming ? this.contentContainer?.children : undefined;
      if (Array.isArray(kids)) {
        if (kids.length === 0) {
          this.contentContainer.mouseLayout = { width, children: [] };
          this.mouseLayout = {
            width,
            children: [{ component: this.contentContainer, height: 0 }],
          };
          return EMPTY_LINES as string[];
        }
        const hit = amcRenderCache.get(this);
        const hasTools = Boolean(this.hasToolCalls);
        if (
          hit !== undefined &&
          hit.width === width &&
          hit.hasToolCalls === hasTools &&
          hit.kids.length === kids.length
        ) {
          let matched = true;
          for (let i = 0; i < kids.length; i++) {
            const kid = kids[i] as { lines?: unknown; render?: (w: number) => string[] } | undefined;
            if (!kid || hit.kids[i] !== kid) {
              matched = false;
              break;
            }
            const out =
              kid.constructor === Spacer && typeof kid.lines === "number"
                ? kid.lines
                : typeof kid.render === "function"
                  ? kid.render(width)
                  : -1;
            if (out === -1 || hit.kidOutputs[i] !== out) {
              matched = false;
              break;
            }
          }
          if (matched) {
            this.contentContainer.mouseLayout = hit.innerMouseLayout;
            this.mouseLayout = hit.outerMouseLayout;
            return hit.lines;
          }
        }

        const lines = originalRender.call(this, width);
        const nextOutputs: Array<readonly string[] | number> = new Array(kids.length);
        for (let i = 0; i < kids.length; i++) {
          const kid = kids[i] as { lines?: unknown; render?: (w: number) => string[] } | undefined;
          nextOutputs[i] =
            kid && kid.constructor === Spacer && typeof kid.lines === "number"
              ? kid.lines
              : kid && typeof kid.render === "function"
                ? kid.render(width)
                : -1;
        }
        amcRenderCache.set(this, {
          width,
          hasToolCalls: hasTools,
          kids: kids.slice(),
          kidOutputs: nextOutputs,
          innerMouseLayout: this.contentContainer.mouseLayout,
          outerMouseLayout: this.mouseLayout,
          lines,
        });
        return lines;
      }

      return originalRender.call(this, width);
    };
  }

  return () => {
    prototype.updateContent = originalUpdateContent;
    if (typeof originalRender === "function") {
      prototype.render = originalRender;
    }
    prototype.setHideThinkingBlock = originalSetHideThinkingBlock;
    prototype.setHiddenThinkingLabel = originalSetHiddenThinkingLabel;
  };
}
