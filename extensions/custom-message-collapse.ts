/**
 * Collapse CustomMessageComponent (e.g. pi-web-access [web-search-content-ready])
 * to a single Grok-style chrome line when tools are not expanded.
 */
import {
  bodyFg,
  RESPONSE_LEFT_PAD,
  type ChromeTheme,
} from "./chrome.js";
import { dimBodyTexts, stripBgDeep } from "./flat-style.js";
import { markBodyFoldDeep } from "./fold-body.js";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import { clickableChromeChild, effectiveToolMode } from "./tool-click.js";
import { idForTarget } from "./click-fold.js";

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
    throw new Error("pi-grok-tui: CustomMessageComponent missing");
  }

  const Ctor = raw as { prototype: CustomMessageProto };
  const proto = Ctor.prototype;
  const theme = rawTheme as ChromeTheme;

  if (typeof proto.rebuild !== "function") {
    throw new Error("pi-grok-tui: CustomMessageComponent.rebuild missing");
  }

  const originalRebuild = proto.rebuild;

  proto.rebuild = function (this: CustomMessageProto) {
    try {
      const mode = effectiveToolMode(this, "custom");
      const showBody = mode !== "chrome";
      this._expanded = showBody;

      // chrome → one-line; truncated/full → body without color block, dim text
      if (showBody) {
        originalRebuild.call(this);
        try {
          stripBgDeep(this);
          dimBodyTexts(this, (t) => bodyFg(t), []);
          // Body rows share the chrome title's fold link: clicking the
          // expanded body collapses the custom message (fullscreen only).
          markBodyFoldDeep(this, idForTarget(this), []);
        } catch {
          /* ignore */
        }
        return;
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
      this.addChild(
        clickableChromeChild(theme, {
          target: this,
          toolName: "custom",
          kind: "group",
          label,
          pad: RESPONSE_LEFT_PAD,
        }) as any,
      );
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
