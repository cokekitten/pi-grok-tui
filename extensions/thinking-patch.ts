/**
 * Monkey-patch AssistantMessageComponent to use ThinkingScrollComponent.
 */
import { Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import { getPreviousSibling, shouldGapAfter } from "./parent-stamp.js";
import { safeFg } from "./chrome.js";
import { ThinkingScrollComponent, type ThinkingThemeLike } from "./thinking-render.js";

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

interface AssistantMessageComponentProto {
  updateContent(message: AssistantMessage): void;
  setHideThinkingBlock(hide: boolean): void;
  setHiddenThinkingLabel(label: string): void;
  contentContainer: {
    clear(): void;
    addChild(component: unknown): void;
  };
  lastMessage?: AssistantMessage;
  hideThinkingBlock: boolean;
  markdownTheme: unknown;
  hiddenThinkingLabel: string;
  hasToolCalls: boolean;
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
    throw new Error("thinking-scroll: AssistantMessageComponent missing");
  }

  const Amc = rawAmc as { prototype: AssistantMessageComponentProto };
  const prototype = Amc.prototype;
  const uiTheme = rawTheme as ThinkingThemeLike;

  if (typeof prototype.updateContent !== "function") {
    throw new Error("thinking-scroll: updateContent not found");
  }

  const originalUpdateContent = prototype.updateContent;
  const originalSetHideThinkingBlock = prototype.setHideThinkingBlock;
  const originalSetHiddenThinkingLabel = prototype.setHiddenThinkingLabel;

  const patchedUpdateContent = function (
    this: AssistantMessageComponentProto,
    message: AssistantMessage,
  ) {
    this.lastMessage = message;

    if (!this.contentContainer || typeof this.contentContainer.clear !== "function") {
      return originalUpdateContent.call(this, message);
    }

    try {
      this.contentContainer.clear();

      const thinkingBlocks = message.content.filter(
        (c) => c.type === "thinking" && !c.redacted && (c.thinking || "").trim().length > 0,
      );
      const hasThinking = thinkingBlocks.length > 0;
      const hasText = message.content.some(
        (c) => c.type === "text" && (c.text || "").trim().length > 0,
      );
      const hasToolCalls = message.content.some((c) => c.type === "toolCall");
      this.hasToolCalls = hasToolCalls;

      // Spacing (Grok-like):
      // - one blank after user prompt (or previous prose) before this message
      // - chrome rows stack tightly; one blank between chrome and prose body
      // Note: first updateContent may run before addChild (parent unset). Parent
      // stamp re-invokes updateContent after addChild so the gap is applied.
      const prev = getPreviousSibling(this);
      const needsLeadGap = shouldGapAfter(prev);
      if (needsLeadGap) {
        this.contentContainer.addChild(new Spacer(1));
      } else if (hasText && prev == null) {
        // Parent not stamped yet — conservative gap so user→first chrome
        // never sticks. Tight tool→thought is fixed on the re-layout pass.
        this.contentContainer.addChild(new Spacer(1));
      } else if (hasText) {
        // Message starts with body text (no thinking first) after chrome tools:
        // still separate prose from the previous tool chrome.
        const firstMeaningful = message.content.find(
          (c) =>
            (c.type === "text" && (c.text || "").trim().length > 0) ||
            (c.type === "thinking" && !c.redacted && (c.thinking || "").trim().length > 0),
        );
        if (firstMeaningful?.type === "text") {
          this.contentContainer.addChild(new Spacer(1));
        }
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

      for (const block of message.content) {
        if (block.type === "text" && (block.text || "").trim().length > 0) {
          // Blank line before body when it follows thinking in this message
          // (hasTextAfterThinking path adds spacer after thinking instead).
          this.contentContainer.addChild(
            new Markdown((block.text || "").trim(), 0, 0, this.markdownTheme as any),
          );
          continue;
        }

        if (block.type === "thinking" && hasThinking && !renderedThinking) {
          if (hasTextBeforeThinking) {
            this.contentContainer.addChild(new Spacer(1));
          }
          this.contentContainer.addChild(
            new ThinkingScrollComponent(
              uiTheme,
              this.markdownTheme,
              message.timestamp,
              thinkingBlocks.map((b) => ({
                text: b.thinking || "",
                redacted: b.redacted,
              })),
            ) as any,
          );
          renderedThinking = true;
          if (hasTextAfterThinking) {
            // chrome → prose gap
            this.contentContainer.addChild(new Spacer(1));
          }
        }
      }

      // Surface hard failures only when there's no tool row to own the error.
      // Keep to a single line so resume rebuild never paints a multi-line red wall.
      // Skip when we already show Thought chrome (abort-during-think is common).
      if (!hasToolCalls && !hasThinking) {
        if (message.stopReason === "aborted") {
          const raw =
            message.errorMessage && message.errorMessage !== "Request was aborted"
              ? message.errorMessage
              : "Aborted";
          const msg = raw.split("\n")[0]!.slice(0, 200);
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(safeFg(uiTheme, "error", msg), 0, 0) as any,
          );
        } else if (message.stopReason === "error") {
          const raw = (message.errorMessage || "Unknown").split("\n")[0]!.slice(0, 200);
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(safeFg(uiTheme, "error", `Error: ${raw}`), 0, 0) as any,
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
              0,
              0,
            ) as any,
          );
        }
      }

      this.hideThinkingBlock = false;
    } catch {
      // Prefer empty chrome over native full-thinking + red error walls.
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

  return () => {
    prototype.updateContent = originalUpdateContent;
    prototype.setHideThinkingBlock = originalSetHideThinkingBlock;
    prototype.setHiddenThinkingLabel = originalSetHiddenThinkingLabel;
  };
}
