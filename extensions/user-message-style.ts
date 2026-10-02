/**
 * Style UserMessageComponent:
 * - background block → #0f1217
 * - leading arrow → #c4a7e7 (❯)
 *
 * Display-only; does not change session data.
 */
import { markUserMessageRows } from "./prompt-jump-core.ts";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.ts";
import { createArrowMarkdownBody } from "./user-message-body.ts";

export {
  USER_MESSAGE_BG,
  USER_MESSAGE_ARROW_FG,
  USER_MESSAGE_ARROW,
} from "./user-message-body.ts";

interface UserMessageProto {
  text: string;
  markdownTheme: unknown;
  outputPad: number;
  clear(): void;
  addChild(c: unknown): void;
  rebuild(): void;
  render(width: number): string[];
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
  const originalRender = prototype.render;
  // Mark the actual component boundary, not the ❯ glyph or generic OSC 133.
  // This also works for message components created before /reload.
  prototype.render = function (this: UserMessageProto, width: number) {
    return markUserMessageRows(originalRender.call(this, width));
  };

  prototype.rebuild = function (this: UserMessageProto) {
    try {
      this.clear();
      // No Box: pi 1.0.0 removed that shape upstream (a full-width copy of
      // every line, and its per-line cache misses defeated Box's identity
      // check every frame). user-message-body.ts reproduces the exact pad+bg
      // pipeline and wrap widths instead, so the rendered bytes are unchanged.
      this.addChild(
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
          this.outputPad ?? 1,
        ),
      );
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
    prototype.render = originalRender;
  };
}
