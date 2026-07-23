/**
 * Monkey-patch AssistantMessageComponent to use ThinkingScrollComponent.
 */
import { Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
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

      if (hasThinking || hasText) {
        this.contentContainer.addChild(new Spacer(1));
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

      for (const block of message.content) {
        if (block.type === "text" && (block.text || "").trim().length > 0) {
          this.contentContainer.addChild(
            new Markdown((block.text || "").trim(), 1, 0, this.markdownTheme as any),
          );
          continue;
        }

        if (block.type === "thinking" && hasThinking && !renderedThinking) {
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
            this.contentContainer.addChild(new Spacer(1));
          }
        }
      }

      if (!hasToolCalls) {
        if (message.stopReason === "aborted") {
          const msg =
            message.errorMessage && message.errorMessage !== "Request was aborted"
              ? message.errorMessage
              : "Aborted";
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(uiTheme.fg("error", msg), 1, 0) as any,
          );
        } else if (message.stopReason === "error") {
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(
              uiTheme.fg("error", `Error: ${message.errorMessage || "Unknown"}`),
              1,
              0,
            ) as any,
          );
        }
      }

      this.hideThinkingBlock = false;
    } catch {
      try {
        originalUpdateContent.call(this, message);
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
