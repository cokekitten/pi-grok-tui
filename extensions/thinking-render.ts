/**
 * ThinkingScrollComponent — live 3-line scroll, finished Grok-style title.
 */
import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { formatChromeLine, safeFg, type ChromeTheme } from "./chrome.js";
import { getState } from "./state.js";

export const MAX_VISIBLE_LINES = 3;

export interface ThinkingThemeLike extends ChromeTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

function stripAnsiLocal(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export class ThinkingScrollComponent {
  private static SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  private lastRenderedText = "";
  private cachedLines?: string[];
  private cachedWidth?: number;
  private cachedExpanded?: boolean;
  private cachedActive?: boolean;
  private cachedMarkdownKey?: string;
  private cachedMarkdownLines?: string[];

  constructor(
    private theme: ThinkingThemeLike,
    private markdownTheme: unknown,
    private messageTimestamp: number,
    private thinkingBlocks: { text: string; redacted?: boolean }[],
  ) {}

  render(width: number): string[] {
    const state = getState();
    const isExpanded = state.globalExpanded;
    const isActive = state.activeByTimestamp.has(this.messageTimestamp);
    const fullText = this.thinkingBlocks.map((b) => b.text).join("\n");

    if (
      !isActive &&
      this.cachedLines &&
      this.cachedWidth === width &&
      this.cachedExpanded === isExpanded &&
      this.cachedActive === isActive &&
      this.lastRenderedText === fullText
    ) {
      return this.cachedLines;
    }

    this.lastRenderedText = fullText;
    this.cachedWidth = width;
    this.cachedExpanded = isExpanded;
    this.cachedActive = isActive;

    let lines: string[];
    if (isActive) {
      lines = this.buildActive(fullText, width);
    } else if (isExpanded) {
      lines = this.buildExpanded(fullText, width);
    } else {
      lines = this.buildFinishedTitle(width);
    }

    this.cachedLines = lines;
    return lines;
  }

  /** Finished collapsed: `◆ Thought (Alt+T)` — same chrome family as tools. */
  private buildFinishedTitle(width: number): string[] {
    const line = formatChromeLine(this.theme, {
      kind: "thinking",
      label: "Thought",
      hint: " (Alt+T)",
    });
    return [truncateToWidth(line, width, "")];
  }

  private buildActive(fullText: string, width: number): string[] {
    const spinner = ThinkingScrollComponent.SPINNER[
      Math.floor(Date.now() / 100) % ThinkingScrollComponent.SPINNER.length
    ];

    const rendered = this.renderThinkingMarkdown(fullText, width - 2, {
      preserveLineBreaks: true,
      dimBody: true,
    });
    const visible = rendered.slice(-MAX_VISIBLE_LINES);

    const lines: string[] = [];
    const header = formatChromeLine(this.theme, {
      kind: "thinking",
      label: `${spinner} Thinking...`,
    });
    lines.push(truncateToWidth(header, width, ""));

    for (const l of visible) {
      // Body quieter than the Thinking... title
      const dimmed =
        l.trim() === "" ? "" : safeFg(this.theme, "dim", stripAnsiLocal(l));
      lines.push(truncateToWidth(dimmed ? `  ${dimmed}` : "", width, ""));
    }

    return lines;
  }

  private buildExpanded(fullText: string, width: number): string[] {
    // Header row + dimmer body (title stays muted diamond chrome)
    const header = formatChromeLine(this.theme, {
      kind: "thinking",
      label: "Thought",
      hint: " (Alt+T)",
    });
    const rendered = this.renderThinkingMarkdown(fullText, width - 2, {
      preserveLineBreaks: true,
      dimBody: true,
    });
    const body = rendered.map((l) => {
      if (l.trim() === "") return "";
      const plain = stripAnsiLocal(l);
      return `  ${safeFg(this.theme, "dim", plain)}`;
    });
    return [truncateToWidth(header, width, ""), ...body];
  }

  private thinkingDefaultStyle(dimBody = false) {
    return {
      color: (text: string) =>
        dimBody
          ? safeFg(this.theme, "dim", text)
          : safeFg(this.theme, "thinkingText", text),
      italic: true,
    };
  }

  private renderThinkingMarkdown(
    text: string,
    width: number,
    options?: {
      preserveLineBreaks?: boolean;
      maxSourceChars?: number;
      dimBody?: boolean;
    },
  ): string[] {
    const preserveLineBreaks = options?.preserveLineBreaks ?? false;
    const maxSourceChars = options?.maxSourceChars;
    const dimBody = options?.dimBody ?? false;
    let source = preserveLineBreaks ? text.replace(/\n/g, "  \n") : text;
    if (maxSourceChars !== undefined && source.length > maxSourceChars) {
      source = source.slice(0, maxSourceChars);
    }

    const key = `${width}:${preserveLineBreaks ? 1 : 0}:${dimBody ? 1 : 0}:${maxSourceChars ?? ""}:${source}`;
    if (this.cachedMarkdownKey === key && this.cachedMarkdownLines) {
      return this.cachedMarkdownLines;
    }

    const md = new Markdown(
      source,
      0,
      0,
      this.markdownTheme as any,
      this.thinkingDefaultStyle(dimBody),
    );
    const lines = md.render(Math.max(1, width));
    this.cachedMarkdownKey = key;
    this.cachedMarkdownLines = lines;
    return lines;
  }

  wrapThinkingText(text: string, width: number): string[] {
    const rawLines = text.split("\n");
    const result: string[] = [];

    for (const rawLine of rawLines) {
      if (rawLine.trim() === "") {
        result.push("");
        continue;
      }
      const match = rawLine.match(/^(\s*)(.*)$/);
      const indent = match?.[1] ?? "";
      const content = match?.[2] ?? rawLine;
      const indentWidth = visibleWidth(indent);
      const available = Math.max(10, width - indentWidth);

      if (visibleWidth(content) <= available) {
        result.push(rawLine);
      } else {
        const wrapped = wrapTextWithAnsi(content, available);
        for (const w of wrapped) {
          result.push(indent + w);
        }
      }
    }

    return result;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
    this.lastRenderedText = "";
    this.cachedMarkdownKey = undefined;
    this.cachedMarkdownLines = undefined;
  }
}
