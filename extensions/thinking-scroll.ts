/**
 * thinking-scroll - scrolling thinking display extension
 *
 * Replaces pi's default thinking rendering with:
 * 1. Live 5-line scrolling view during streaming (grows from 1 line)
 * 2. Auto-collapse to summary line when thinking ends
 * 3. Alt+T to expand/collapse full thinking content
 *
 * Uses monkey-patch on AssistantMessageComponent.prototype.updateContent
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  Key,
} from "@earendil-works/pi-tui";

// ── Constants ────────────────────────────────────────────
const MAX_VISIBLE_LINES = 5;

const INTERNAL_MODULES = {
  assistantMessageComponent: "dist/modes/interactive/components/assistant-message.js",
  theme: "dist/modes/interactive/theme/theme.js",
} as const;

// ── Global state ─────────────────────────────────────────
const STATE_KEY = Symbol.for("thinking-scroll.state");

interface ActiveEntry {
  messageTimestamp: number;
  contentIndex: number;
}

interface ThinkingScrollState {
  activeByTimestamp: Map<number, ActiveEntry>;
  globalExpanded: boolean;
  patchRefCount: number;
  patchCleanup?: (() => void) | undefined;
  patchInstallPromise?: Promise<() => void> | undefined;
  patchRelease?: (() => Promise<void>) | undefined;
}

function getState(): ThinkingScrollState {
  const existing = (globalThis as any)[STATE_KEY];
  if (existing && typeof existing === "object") return existing;
  const created: ThinkingScrollState = {
    activeByTimestamp: new Map(),
    globalExpanded: false,
    patchRefCount: 0,
  };
  (globalThis as any)[STATE_KEY] = created;
  return created;
}

// ── Internal module imports ──────────────────────────────

function getPackageRoot(packageName: string): string {
  const entryUrl = import.meta.resolve(packageName);
  const entryPath = fileURLToPath(entryUrl);
  return dirname(dirname(entryPath));
}

function resolveInternalModuleUrl(relativePath: string): string {
  const packageRoot = getPackageRoot("@earendil-works/pi-coding-agent");
  return pathToFileURL(join(packageRoot, relativePath)).href;
}

async function importInternal<T>(relativePath: string): Promise<T> {
  const moduleUrl = resolveInternalModuleUrl(relativePath);
  return (await import(moduleUrl)) as T;
}

// ── Types ────────────────────────────────────────────────

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

interface ThinkingThemeLike {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

// ── Thinking scroll component ────────────────────────────

/**
 * Renders thinking content with live scroll during streaming.
 * Style matches pi's native thinking rendering (plain white/thinkingText colored text,
 * word-wrapped, no truncation).
 */
class ThinkingScrollComponent {
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
    const totalLines = !isActive && !isExpanded
      ? this.wrapThinkingText(fullText, Math.max(20, width - 2)).length
      : 0;

    // Check cache (skip final line array cache when active, since spinner animates)
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
      // Always use active view with spinner during streaming
      lines = this.buildActive(fullText, width);
    } else if (isExpanded) {
      lines = this.buildExpanded(fullText, width);
    } else if (totalLines <= 3) {
      // Short thinking (≤3 lines): show inline, no collapse
      lines = this.buildInline(fullText, width);
    } else {
      lines = this.buildCollapsed(fullText, width);
    }

    this.cachedLines = lines;
    return lines;
  }

  // ── Collapsed: flatten source into one paragraph, render markdown, show first 3 lines ─

  private buildCollapsed(fullText: string, width: number): string[] {
    // Collapse original newlines/blank lines/list line breaks into spaces for preview.
    // Markdown still applies inline/code styling, but paragraphs/lists don't create visual gaps here.
    const flattened = fullText.replace(/\s+/g, " ").trim();
    const maxPreviewChars = 8000;
    const sourceWasTrimmed = flattened.length > maxPreviewChars;
    const rendered = this.renderThinkingMarkdown(flattened, width - 2, { maxSourceChars: maxPreviewChars })
      .filter((l) => this.stripAnsi(l).trim() !== "");
    const collapsed = rendered.slice(0, 3);

    if (collapsed.length === 0) return [];

    const hasMore = sourceWasTrimmed || rendered.length > 3;
    const lines: string[] = [];
    for (let i = 0; i < collapsed.length; i++) {
      const line = collapsed[i]!;
      const prefix = i === 0
        ? `│ ${this.theme.fg("dim", "Thinking")} `
        : "│ ";
      const renderedLine = `${prefix}${line}`;

      if (i === collapsed.length - 1 && hasMore) {
        lines.push(this.appendEllipsisToRenderedLine(line, prefix, width));
      } else {
        lines.push(truncateToWidth(renderedLine, width, ""));
      }
    }

    return lines;
  }

  private appendEllipsisToRenderedLine(line: string, prefix: string, width: number): string {
    const available = Math.max(1, width - visibleWidth(prefix) - 3);
    const shortened = this.trimAnsiEnd(truncateToWidth(line, available, ""));
    return truncateToWidth(`${prefix}${shortened}${this.theme.fg("thinkingText", "...")}`, width, "");
  }

  private trimAnsiEnd(text: string): string {
    const trailingAnsi = text.match(/((?:\x1b\[[0-9;]*[a-zA-Z])*)$/)?.[1] ?? "";
    const body = trailingAnsi ? text.slice(0, -trailingAnsi.length) : text;
    return `${body.replace(/\s+$/g, "")}${trailingAnsi}`;
  }

  /** Strip ANSI escape sequences */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  }

  // ── Active: live scroll (last N markdown-rendered lines) ──

  private buildActive(fullText: string, width: number): string[] {
    const spinner = ThinkingScrollComponent.SPINNER[
      Math.floor(Date.now() / 100) % ThinkingScrollComponent.SPINNER.length
    ];

    const rendered = this.renderThinkingMarkdown(fullText, width - 2, { preserveLineBreaks: true });
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

  // ── Expanded: full thinking content rendered as markdown ─

  private buildExpanded(fullText: string, width: number): string[] {
    const indent = "  ";
    const rendered = this.renderThinkingMarkdown(fullText, width - 2, { preserveLineBreaks: true });
    return rendered.map((l) => (l.trim() === "" ? "" : `${indent}${l}`));
  }

  // ── Inline: for short thinking (≤3 lines), rendered as markdown ─

  private buildInline(fullText: string, width: number): string[] {
    // Preserve line breaks with markdown hard-break syntax
    const rendered = this.renderThinkingMarkdown(fullText, width - 2, { preserveLineBreaks: true });
    return rendered.map((l, i) => {
      const prefix = i === 0
        ? `│ ${this.theme.fg("dim", "Thinking")} `
        : "│ ";
      return truncateToWidth(`${prefix}${l}`, width, "");
    });
  }

  // ── Helpers ────────────────────────────────────────────

  private thinkingDefaultStyle() {
    return {
      color: (text: string) => this.theme.fg("thinkingText", text),
      italic: true,
    };
  }

  private renderThinkingMarkdown(text: string, width: number, options?: { preserveLineBreaks?: boolean; maxSourceChars?: number }): string[] {
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

    const md = new Markdown(source, 0, 0, this.markdownTheme as any, this.thinkingDefaultStyle());
    const lines = md.render(Math.max(1, width));
    this.cachedMarkdownKey = key;
    this.cachedMarkdownLines = lines;
    return lines;
  }

  /** Wrap thinking text to a given width, preserving empty lines */
  private wrapThinkingText(text: string, width: number): string[] {
    const rawLines = text.split("\n");
    const result: string[] = [];

    for (const rawLine of rawLines) {
      if (rawLine.trim() === "") {
        result.push("");
        continue;
      }
      // Preserve leading whitespace (indentation)
      const match = rawLine.match(/^(\s*)(.*)$/);
      const indent = match?.[1] ?? "";
      const content = match?.[2] ?? rawLine;
      const indentWidth = visibleWidth(indent);
      const available = Math.max(10, width - indentWidth);

      if (visibleWidth(content) <= available) {
        result.push(rawLine);
      } else {
        // Word wrap
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

// ── Monkey-patch installation ────────────────────────────

async function installPatch(): Promise<() => void> {
  const [
    { AssistantMessageComponent: rawAmc },
    { theme: rawTheme },
  ] = await Promise.all([
    importInternal<{ AssistantMessageComponent: unknown }>(INTERNAL_MODULES.assistantMessageComponent),
    importInternal<{ theme: unknown }>(INTERNAL_MODULES.theme),
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
      const lastThinkingBlock = thinkingBlocks.length > 0 ? thinkingBlocks[thinkingBlocks.length - 1]! : null;
      const lastThinkingIndex = lastThinkingBlock ? message.content.indexOf(lastThinkingBlock) : -1;
      const hasTextAfterThinking = hasThinking && message.content.some(
        (c, i) => c.type === "text" && (c.text || "").trim().length > 0 && i > lastThinkingIndex,
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
              thinkingBlocks.map((b) => ({ text: b.thinking || "", redacted: b.redacted })),
            ) as any,
          );
          renderedThinking = true;
          if (hasTextAfterThinking) {
            this.contentContainer.addChild(new Spacer(1));
          }
        }
      }

      // Error / abort messages. Match Pi native behavior: tool execution rows render tool errors.
      if (!hasToolCalls) {
        if (message.stopReason === "aborted") {
          const msg = message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage : "Aborted";
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(new Text(uiTheme.fg("error", msg), 1, 0) as any);
        } else if (message.stopReason === "error") {
          this.contentContainer.addChild(new Spacer(1));
          this.contentContainer.addChild(
            new Text(uiTheme.fg("error", `Error: ${message.errorMessage || "Unknown"}`), 1, 0) as any,
          );
        }
      }

      this.hideThinkingBlock = false;
    } catch {
      try { originalUpdateContent.call(this, message); } catch { /* unrecoverable */ }
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

export async function retainPatch(): Promise<() => Promise<void>> {
  const state = getState();
  state.patchRefCount++;

  let cleanup = state.patchCleanup;
  if (!cleanup) {
    const existingPromise = state.patchInstallPromise;
    const promise = existingPromise ?? installPatch();
    if (!existingPromise) state.patchInstallPromise = promise;
    try {
      cleanup = await promise;
      if (!state.patchCleanup) state.patchCleanup = cleanup;
    } catch (error) {
      state.patchRefCount--;
      throw error;
    } finally {
      if (state.patchInstallPromise === promise) {
        state.patchInstallPromise = undefined;
      }
    }
  }

  let released = false;
  return async () => {
    if (released) return;
    state.patchRefCount = Math.max(0, state.patchRefCount - 1);
    if (state.patchRefCount > 0) { released = true; return; }
    const c = state.patchCleanup;
    if (!c) { released = true; return; }
    if (state.patchCleanup === c) state.patchCleanup = undefined;
    try { c(); released = true; } catch (error) {
      state.patchRefCount++;
      if (!state.patchCleanup) state.patchCleanup = c;
      throw error;
    }
  };
}

// ── Extension entry ──────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let degraded = false;

  pi.registerShortcut(Key.alt("t"), {
    description: "Toggle all thinking expand/collapse",
    handler: async (ctx) => {
      const state = getState();
      state.globalExpanded = !state.globalExpanded;
      if (ctx.hasUI) {
        ctx.ui.notify(
          state.globalExpanded ? "All thinking expanded" : "All thinking collapsed",
          "info",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const state = getState();
    state.activeByTimestamp.clear();
    state.globalExpanded = false;
    // Patch is global. Keep it across new/resume/fork, but recover if an older
    // version left a cleanup without a release handle.
    if (state.patchCleanup && state.patchRelease) return;
    if (state.patchCleanup && !state.patchRelease) {
      try {
        state.patchCleanup();
      } catch {
        // ignore; retainPatch below will either patch cleanly or report degraded mode
      } finally {
        state.patchCleanup = undefined;
        state.patchInstallPromise = undefined;
        state.patchRefCount = 0;
      }
    }

    try {
      state.patchRelease = await retainPatch();
      degraded = false;
    } catch (error) {
      degraded = true;
      if (ctx.hasUI) {
        ctx.ui.notify(
          `thinking-scroll: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
  });

  pi.on("message_update", async (event) => {
    if (degraded || event.message.role !== "assistant") return;

    const assistantEvent = event.assistantMessageEvent as { type?: string; contentIndex?: number } | undefined;
    const state = getState();
    const ts = event.message.timestamp;
    const type = assistantEvent?.type;

    if (type === "thinking_start" || type === "thinking_delta") {
      state.activeByTimestamp.set(ts, {
        messageTimestamp: ts,
        contentIndex: typeof assistantEvent?.contentIndex === "number" ? assistantEvent.contentIndex : -1,
      });
      return;
    }

    if (
      type === "thinking_end" ||
      type === "text_start" ||
      type === "text_delta" ||
      type === "text_end" ||
      type === "toolcall_start" ||
      type === "toolcall_delta" ||
      type === "toolcall_end"
    ) {
      state.activeByTimestamp.delete(ts);
    }
  });

  pi.on("message_end", async (event) => {
    if (degraded || event.message.role !== "assistant") return;
    getState().activeByTimestamp.delete(event.message.timestamp);
  });

  pi.on("agent_end", async () => {
    getState().activeByTimestamp.clear();
  });

  pi.on("session_shutdown", async (event) => {
    const state = getState();
    state.activeByTimestamp.clear();
    state.globalExpanded = false;

    // Keep patch installed across new/resume/fork for speed, but release on reload/quit
    // so code changes take effect and shutdown is clean.
    if ((event.reason === "reload" || event.reason === "quit") && state.patchRelease) {
      try {
        await state.patchRelease();
      } catch {
        // ignore cleanup failures; next startup can reinstall if needed
      } finally {
        state.patchRelease = undefined;
        state.patchCleanup = undefined;
        state.patchInstallPromise = undefined;
        state.patchRefCount = 0;
      }
    }
  });
}