/**
 * Style UserMessageComponent:
 * - background block → #0f1217
 * - leading arrow → #c4a7e7 (❯)
 *
 * Display-only; does not change session data.
 */
import { Box, Markdown } from "@earendil-works/pi-tui";
import { ansiBgHex, ansiFgHex } from "./chrome.js";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";

/** Near-black user bubble (requested). */
export const USER_MESSAGE_BG = "#0f1217";
/** Soft purple/iris arrow (requested). */
export const USER_MESSAGE_ARROW_FG = "#c4a7e7";
/** Arrow glyph — single cell wide in most terminals. */
export const USER_MESSAGE_ARROW = "❯";

interface UserMessageProto {
  text: string;
  markdownTheme: unknown;
  outputPad: number;
  clear(): void;
  addChild(c: unknown): void;
  rebuild(): void;
}

/** Body that renders markdown with a colored arrow on the first line. */
function createArrowMarkdownBody(
  text: string,
  markdownTheme: unknown,
  themeFg: (color: string, content: string) => string,
): { render(width: number): string[]; invalidate?(): void } {
  const arrow = ansiFgHex(USER_MESSAGE_ARROW_FG, USER_MESSAGE_ARROW) + " ";
  // ❯ + space → 2 columns in typical terminals
  const pad = "  ";

  const md = new Markdown(
    text,
    0,
    0,
    markdownTheme as any,
    {
      color: (content: string) => themeFg("userMessageText", content),
    },
    { preserveOrderedListMarkers: true, preserveBackslashEscapes: true },
  );

  return {
    render(width: number): string[] {
      const bodyWidth = Math.max(1, width - 2);
      let lines: string[];
      try {
        lines = md.render(bodyWidth);
      } catch {
        lines = [text];
      }
      if (lines.length === 0) return [arrow.trimEnd()];
      return lines.map((line, i) => (i === 0 ? arrow + line : pad + line));
    },
    invalidate() {
      try {
        (md as { invalidate?: () => void }).invalidate?.();
      } catch {
        /* ignore */
      }
    },
  };
}

export async function installUserMessageStylePatch(): Promise<() => void> {
  const [{ UserMessageComponent: rawUmc }, { theme: rawTheme }] =
    await Promise.all([
      importInternal<{ UserMessageComponent: unknown }>(
        PI_CODING_AGENT,
        "dist/modes/interactive/components/user-message.js",
      ),
      importInternal<{ theme: { fg: (c: string, t: string) => string } }>(
        PI_CODING_AGENT,
        INTERNAL_MODULES.theme,
      ),
    ]);

  if (!rawUmc || (typeof rawUmc !== "function" && typeof rawUmc !== "object")) {
    throw new Error("pi-grok-tui: UserMessageComponent missing");
  }

  const Umc = rawUmc as { prototype: UserMessageProto };
  const prototype = Umc.prototype;
  const theme = rawTheme;

  if (typeof prototype.rebuild !== "function") {
    throw new Error("pi-grok-tui: UserMessageComponent.rebuild missing");
  }

  const originalRebuild = prototype.rebuild;

  prototype.rebuild = function (this: UserMessageProto) {
    try {
      this.clear();
      // Same padding as native (outputPad, paddingY=1); bg is #0f1217.
      const contentBox = new Box(this.outputPad ?? 1, 1, (content: string) =>
        ansiBgHex(USER_MESSAGE_BG, content),
      );
      contentBox.addChild(
        createArrowMarkdownBody(
          this.text,
          this.markdownTheme,
          (color, content) => {
            try {
              return theme.fg(color, content);
            } catch {
              return content;
            }
          },
        ) as any,
      );
      this.addChild(contentBox);
    } catch {
      // Fall back to native rebuild if anything goes wrong
      try {
        originalRebuild.call(this);
      } catch {
        /* unrecoverable */
      }
    }
  };

  return () => {
    prototype.rebuild = originalRebuild;
  };
}
