/**
 * ThinkingScrollComponent — live 3-line scroll, finished title-only collapse.
 */
import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { getState } from "./state.js";

export const MAX_VISIBLE_LINES = 3;

export interface ThinkingThemeLike {
  fg(color: string, text: string): string;
  bold(text: string): string;
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
      // Finished: always title-only (no ≤3-line exception)
      lines = this.buildFinishedTitle(width);
    }

    this.cachedLines = lines;
    return lines;
  }

  /** Finished collapsed: single row `│ 已思考 (Alt+T)` */
  private buildFinishedTitle(width: number): string[] {
    const prefix = "│ ";
    const title = this.theme.fg("dim", "已思考");
    const hint = this.theme.fg("muted", " (Alt+T)");
    return [truncateToWidth(`${prefix}${title}${hint}`, width, "")];
  }

  private buildActive(fullText: string, width: number): string[] {
    const spinner = ThinkingScrollComponent.SPINNER[
      Math.floor(Date.now() / 100) % ThinkingScrollComponent.SPINNER.length
    ];

    const rendered = this.renderThinkingMarkdown(fullText, width - 2, {
      preserveLineBreaks: true,
    });
    const visible = rendered.slice(-MAX_VISIBLE_LINES);

    const lines: string[] = [];
    lines.push(
      truncateToWidth(
        `│ ${spinner} ${this.theme.bold(this.theme.fg("thinkingXhigh", "Thinking..."))}`,
        width,
        "",
      ),
    );

    for (const l of visible) {
      lines.push(truncateToWidth(`│ ${l}`, width, ""));
    }

    return lines;
  }

  private buildExpanded(fullText: string, width: number): string[] {
    const indent = "  ";
    const rendered = this.renderThinkingMarkdown(fullText, width - 2, {
      preserveLineBreaks: true,
    });
    return rendered.map((l) => (l.trim() === "" ? "" : `${indent}${l}`));
  }

  private thinkingDefaultStyle() {
    return {
      color: (text: string) => this.theme.fg("thinkingText", text),
      italic: true,
    };
  }

  private renderThinkingMarkdown(
    text: string,
    width: number,
    options?: { preserveLineBreaks?: boolean; maxSourceChars?: number },
  ): string[] {
    const preserveLineBreaks = options?.preserveLineBreaks ?? false;
    const maxSourceChars = options?.maxSourceChars;
    let source = preserveLineBreaks ? text.replace(/\n/g, "  \n") : text;
    if (maxSourceChars !== undefined && source.length > maxSourceChars) {
      source = source.slice(0, maxSourceChars);
    }

    const key = `${width}:${preserveLineBreaks ? 1 : 0}:${maxSourceChars ?? ""}:${source}`;
    if (this.cachedMarkdownKey === key && this.cachedMarkdownLines) {
      return this.cachedMarkdownLines;
    }

    const md = new Markdown(
      source,
      0,
      0,
      this.markdownTheme as any,
      this.thinkingDefaultStyle(),
    );
    const lines = md.render(Math.max(1, width));
    this.cachedMarkdownKey = key;
    this.cachedMarkdownLines = lines;
    return lines;
  }

  /** Kept for potential future width measurements; unused in title-only path. */
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
