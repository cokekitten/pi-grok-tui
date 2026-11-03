/** Preserve Pi's display-only Markdown transformer contract in custom shells. */
import type { MarkdownTransformContext, MarkdownTransformer } from "@earendil-works/pi-coding-agent";

export interface MarkdownTransformSource {
  markdownTransformers?: readonly MarkdownTransformer[];
  isStreaming?: boolean;
  /** Session-entry metadata, not the model message's numeric timestamp. */
  messageId?: string;
  timestamp?: string;
}

export function markdownTransformFor(
  source: MarkdownTransformSource,
  messageType: MarkdownTransformContext["messageType"],
): (markdown: string, availableWidth: number) => string {
  return (markdown, availableWidth) => {
    const context: MarkdownTransformContext = {
      messageType,
      isStreaming: messageType === "user" ? false : (source.isStreaming ?? false),
      availableWidth,
      messageId: source.messageId,
      timestamp: source.timestamp,
    };
    let result = markdown;
    for (const transformer of source.markdownTransformers ?? []) {
      try {
        const transformed = transformer(result, context);
        if (typeof transformed === "string") result = transformed;
      } catch {
        // A broken extension must not prevent the remaining transformers/render.
      }
    }
    return result;
  };
}
