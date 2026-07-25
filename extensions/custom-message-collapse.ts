/**
 * Collapse CustomMessageComponent (e.g. pi-web-access [web-search-content-ready])
 * to a single Grok-style chrome line when tools are not expanded.
 */
import { Text } from "@earendil-works/pi-tui";
import { formatChromeLine, type ChromeTheme } from "./chrome.js";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import { getToolViewMode } from "./state.js";

interface CustomMessageProto {
  message: {
    customType?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };
  customRenderer?: unknown;
  box?: unknown;
  customComponent?: unknown;
  markdownTheme?: unknown;
  _expanded: boolean;
  children?: unknown[];
  addChild(c: unknown): void;
  removeChild(c: unknown): void;
  rebuild(): void;
}

function extractText(message: CustomMessageProto["message"]): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!)
      .join(" ");
  }
  return "";
}

function oneLine(s: string, max = 72): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if ([...flat].length <= max) return flat;
  return [...flat].slice(0, max - 1).join("") + "…";
}

export async function installCustomMessageCollapsePatch(): Promise<() => void> {
  const [
    { CustomMessageComponent: raw },
    { theme: rawTheme },
  ] = await Promise.all([
    importInternal<{ CustomMessageComponent: unknown }>(
      PI_CODING_AGENT,
      INTERNAL_MODULES.customMessage,
    ),
    importInternal<{ theme: unknown }>(PI_CODING_AGENT, INTERNAL_MODULES.theme),
  ]);

  if (!raw || (typeof raw !== "function" && typeof raw !== "object")) {
    throw new Error("thinking-scroll: CustomMessageComponent missing");
  }

  const Ctor = raw as { prototype: CustomMessageProto };
  const proto = Ctor.prototype;
  const theme = rawTheme as ChromeTheme;

  if (typeof proto.rebuild !== "function") {
    throw new Error("thinking-scroll: CustomMessageComponent.rebuild missing");
  }

  const originalRebuild = proto.rebuild;

  proto.rebuild = function (this: CustomMessageProto) {
    try {
      // chrome → one-line; truncated/full → native custom body
      if (this._expanded || getToolViewMode() !== "chrome") {
        return originalRebuild.call(this);
      }

      // Clear whatever rebuild previously attached
      const kids = [...(this.children ?? [])];
      for (const k of kids) {
        try {
          this.removeChild(k);
        } catch {
          /* ignore */
        }
      }
      this.customComponent = undefined;

      const type = this.message?.customType || "message";
      const body = oneLine(extractText(this.message));
      const label = body ? `[${type}] ${body}` : `[${type}]`;
      const line = formatChromeLine(theme, {
        kind: "group",
        label,
        hint: " (Ctrl+O)",
      });
      this.addChild(new Text(line, 0, 0) as any);
    } catch {
      try {
        originalRebuild.call(this);
      } catch {
        /* unrecoverable */
      }
    }
  };

  return () => {
    proto.rebuild = originalRebuild;
  };
}
