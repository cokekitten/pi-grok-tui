/**
 * User-message bubble body: Markdown + ❯ arrow + #0f1217 background.
 *
 * Reproduces, byte for byte, the render pipeline this extension used when it
 * wrapped Markdown in a full-width Box (the shape pi 1.0.0 removed upstream
 * because it kept a second full-width copy of every line): same Markdown
 * arguments, same wrap widths, same pad-then-ansiBgHex composition. The Box is
 * gone — the body pads and paints each line itself — and the output is cached
 * so repeated renders return identical string objects (keeps downstream
 * identity-based diffing cheap).
 */
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { ansiBgHex, ansiFgHex } from "./chrome.ts";

/** Near-black user bubble (requested). */
export const USER_MESSAGE_BG = "#0f1217";
/** Soft purple/iris arrow (requested). */
export const USER_MESSAGE_ARROW_FG = "#c4a7e7";
/** Arrow glyph — single cell wide in most terminals. */
export const USER_MESSAGE_ARROW = "❯";

export interface UserMessageBody {
  render(width: number): string[];
  invalidate?(): void;
}

type ThemeFg = (color: string, content: string) => string;

/**
 * Body that renders markdown with a colored arrow on the first line.
 *
 * Layout (total width W, outputPad = 1):
 *   [pad][❯ ][markdown wrapped at W - 2*outputPad - 2][pad]
 * plus one full-width background line above and below (Box paddingY parity).
 */
export function createArrowMarkdownBody(
  text: string,
  markdownTheme: unknown,
  themeFg: ThemeFg,
  outputPad = 1,
): UserMessageBody {
  const arrow = ansiFgHex(USER_MESSAGE_ARROW_FG, USER_MESSAGE_ARROW) + " ";
  // ❯ + space → 2 columns in typical terminals
  const firstPrefix = " ".repeat(outputPad) + arrow;
  const contPrefix = " ".repeat(outputPad) + "  ";

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

  // Cache: Markdown returns the same lines array on a cache hit, so an identity
  // check here is enough to return our own cached output unchanged.
  let cachedWidth: number | undefined;
  let cachedMdLines: readonly string[] | undefined;
  let cachedOut: string[] | undefined;

  /** Box.applyBg parity: pad to full width, then paint the background. */
  const bgLine = (line: string, width: number): string => {
    const padNeeded = Math.max(0, width - visibleWidth(line));
    return ansiBgHex(USER_MESSAGE_BG, line + " ".repeat(padNeeded));
  };

  return {
    render(width: number): string[] {
      // Wrap widths match the old Box pipeline exactly:
      // Box content width = W - 2*outputPad, markdown width = that - 2.
      const bodyWidth = Math.max(1, Math.max(1, width - outputPad * 2) - 2);
      let lines: string[];
      try {
        lines = md.render(bodyWidth);
      } catch {
        lines = [text];
      }
      if (lines === cachedMdLines && cachedWidth === width && cachedOut) {
        return cachedOut;
      }
      const out: string[] = [bgLine("", width)]; // top padding line
      if (lines.length === 0) {
        out.push(bgLine(" ".repeat(outputPad) + arrow.trimEnd(), width));
      } else {
        for (let i = 0; i < lines.length; i++) {
          out.push(
            bgLine((i === 0 ? firstPrefix : contPrefix) + lines[i], width),
          );
        }
      }
      out.push(bgLine("", width)); // bottom padding line
      cachedWidth = width;
      cachedMdLines = lines;
      cachedOut = out;
      return out;
    },
    invalidate() {
      try {
        (md as { invalidate?: () => void }).invalidate?.();
      } catch {
        /* ignore */
      }
      cachedWidth = undefined;
      cachedMdLines = undefined;
      cachedOut = undefined;
    },
  };
}
