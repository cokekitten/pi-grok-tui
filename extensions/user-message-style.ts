/**
 * Style UserMessageComponent:
 * - background block → #0f1217
 * - leading arrow → #c4a7e7 (❯)
 *
 * Display-only; does not change session data.
 *
 * Reload self-healing: prototype patches only affect rebuilds that happen
 * after install, so instances created earlier (resumed transcripts rendered
 * before extension bind, or before a `/reload`) keep their old children.
 * Every install bumps a process-global generation counter (Symbol.for, so it
 * survives jiti module re-imports). The patched render lazily rebuilds any
 * instance not yet styled by the current generation — exactly once, at its
 * next paint.
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

type ThemeLike = { fg: (color: string, content: string) => string };
type MarkRows = (lines: readonly string[]) => string[];

const GENERATION_KEY = Symbol.for("pi-grok-tui.userMessageStyle.generation");
const STYLED_KEY = Symbol.for("pi-grok-tui.userMessageStyle.styledGeneration");

/** Monotonic per-install generation, shared across extension reloads. */
function nextGeneration(): number {
  const store = globalThis as Record<symbol, unknown>;
  const current = store[GENERATION_KEY];
  const next = (typeof current === "number" ? current : 0) + 1;
  store[GENERATION_KEY] = next;
  return next;
}

function styledGenerationOf(target: object): number | undefined {
  return (target as Record<symbol, number | undefined>)[STYLED_KEY];
}

function markStyledGeneration(target: object, generation: number): void {
  (target as Record<symbol, number | undefined>)[STYLED_KEY] = generation;
}

/**
 * Patch a UserMessageComponent-shaped prototype in place.
 *
 * Split from installUserMessageStylePatch so tests can drive the patch
 * against a fake prototype without importing pi internals.
 */
export function createUserMessagePrototypePatch(
  prototype: {
    rebuild: (this: UserMessageProto) => void;
    render: (this: UserMessageProto, width: number) => string[];
  },
  theme: ThemeLike,
  markRows: MarkRows = (lines) => [...lines],
): () => void {
  if (typeof prototype.rebuild !== "function") {
    throw new Error("pi-grok-tui: UserMessageComponent.rebuild missing");
  }

  const generation = nextGeneration();
  const originalRebuild = prototype.rebuild;
  const originalRender = prototype.render;

  // Mark the actual component boundary, not the ❯ glyph or generic OSC 133.
  // This also works for message components created before /reload — and now
  // restyles them: render dispatches through the prototype, so the very
  // first paint after (re)install rebuilds any instance that an older
  // generation (or no patch at all) built.
  prototype.render = function (this: UserMessageProto, width: number) {
    if (styledGenerationOf(this) !== generation) {
      // Mark before rebuilding so a throwing rebuild cannot retrigger on
      // every paint; worst case the instance keeps its current children.
      markStyledGeneration(this, generation);
      try {
        this.rebuild();
      } catch {
        /* keep whatever children the failed rebuild left behind */
      }
    }
    return markRows(originalRender.call(this, width));
  };

  prototype.rebuild = function (this: UserMessageProto) {
    markStyledGeneration(this, generation);
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

  const prototype = (rawUmc as { prototype: unknown }).prototype as {
    rebuild: (this: UserMessageProto) => void;
    render: (this: UserMessageProto, width: number) => string[];
  };

  return createUserMessagePrototypePatch(prototype, rawTheme, markUserMessageRows);
}
