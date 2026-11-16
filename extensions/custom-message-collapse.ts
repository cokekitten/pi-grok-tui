/**
 * Collapse CustomMessageComponent AND CustomEntryComponent (pi-subagents
 * supervisor requests/replies/notices, pi-intercom cards, background-task,
 * web-search notices, etc.) to a single Grok-style ◇ chrome line in chrome
 * mode, and strip native purple/status color blocks when expanded.
 */
import { Spacer, Text } from "@earendil-works/pi-tui";
import {
  bodyFg,
  RESPONSE_LEFT_PAD,
  type ChromeTheme,
} from "./chrome.js";
import { dimBodyTexts, stripBgDeep } from "./flat-style.js";
import {
  markBodyFoldDeep,
  unwrapMouseRegion,
  wrapFoldBodyComponent,
} from "./fold-body.js";
import {
  importInternal,
  PI_CODING_AGENT,
  INTERNAL_MODULES,
} from "./internal-import.js";
import {
  CUSTOM_CHROME_MARK,
  getNextSibling,
  getPreviousSibling,
  relayoutChild,
  shouldGapBefore,
} from "./parent-stamp.js";
import {
  clickableChromeChild,
  effectiveToolMode,
  toggleToolAt,
} from "./tool-click.js";
import { idForTarget, registerFoldHandler } from "./click-fold.js";

const PATCHED_GEN = Symbol.for("pi-grok-tui.customCollapseGen");
const LEAD_SPACER_KEY = Symbol("pi-grok-tui.customLeadSpacer");
const MAIN_CHILD_KEY = Symbol("pi-grok-tui.customMainChild");
const RENDER_CACHE_KEY = Symbol("pi-grok-tui.customRenderCache");

let currentGeneration = 0;

interface CustomMessageLike {
  customType?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  details?: unknown;
}

interface CustomEntryLike {
  customType?: string;
  data?: unknown;
}

interface RenderableChild {
  render(width: number): string[];
  invalidate?(): void;
}

interface RenderCache {
  width: number;
  lead: number;
  mainLines: readonly string[];
  out: string[];
}

interface CustomMessageProto {
  message: CustomMessageLike;
  customRenderer?: unknown;
  box?: unknown;
  customComponent?: unknown;
  markdownTheme?: unknown;
  _expanded: boolean;
  children?: unknown[];
  mouseLayout?: unknown;
  addChild(c: unknown): void;
  removeChild(c: unknown): void;
  clear?(): void;
  rebuild(): void;
  setExpanded?(expanded: boolean): void;
  render?(width: number): string[];
  [CUSTOM_CHROME_MARK]?: boolean;
  __syncCustomLeadSpacer?: () => void;
  [PATCHED_GEN]?: number;
  [LEAD_SPACER_KEY]?: Spacer;
  [MAIN_CHILD_KEY]?: RenderableChild;
  [RENDER_CACHE_KEY]?: RenderCache;
}

interface CustomEntryProto {
  entry: CustomEntryLike;
  renderer?: unknown;
  customComponent?: unknown;
  _expanded: boolean;
  children?: unknown[];
  mouseLayout?: unknown;
  addChild(c: unknown): void;
  removeChild?(c: unknown): void;
  clear(): void;
  hasContent?(): boolean;
  rebuild(): void;
  setExpanded?(expanded: boolean): void;
  render?(width: number): string[];
  [CUSTOM_CHROME_MARK]?: boolean;
  __syncCustomLeadSpacer?: () => void;
  [PATCHED_GEN]?: number;
  [LEAD_SPACER_KEY]?: Spacer;
  [MAIN_CHILD_KEY]?: RenderableChild;
  [RENDER_CACHE_KEY]?: RenderCache;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function stripTerminalEscapes(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function stripExpandHint(s: string): string {
  return s
    .replace(/\s*\((?:[^()]*?\bto expand|click|ctrl\+o[^()]*)\)\s*$/i, "")
    .replace(/\s+ctrl\+o\s+expands\s*$/i, "")
    .trim();
}

function extractText(message: CustomMessageLike | undefined): string {
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
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return chars.slice(0, max - 1).join("") + "…";
}

function formatIntercomChromeLabel(message: CustomMessageLike | undefined): string | undefined {
  if (!message || message.customType !== "intercom_message") return undefined;
  const details = isRecord(message.details) ? message.details : undefined;
  const from = isRecord(details?.from) ? details.from : undefined;
  const msgObj = isRecord(details?.message) ? details.message : undefined;
  const cross = isRecord(msgObj?.crossMachine) ? msgObj.crossMachine : undefined;
  const origin = isRecord(cross?.origin) ? cross.origin : undefined;
  const remoteName =
    typeof origin?.senderName === "string" && origin.senderName.trim()
      ? origin.senderName.trim()
      : undefined;
  const sender =
    remoteName ??
    (typeof from?.name === "string" && from.name.trim()
      ? from.name.trim()
      : typeof from?.id === "string" && from.id.trim()
        ? from.id.trim().slice(0, 8)
        : undefined);
  const contentObj = isRecord(msgObj?.content) ? msgObj.content : undefined;
  const rawBody =
    (typeof details?.bodyText === "string" && details.bodyText) ||
    (typeof contentObj?.text === "string" && contentObj.text) ||
    "";
  if (sender) {
    const preview = oneLine(rawBody, 72);
    return preview ? `[intercom] From ${sender}: ${preview}` : `[intercom] From ${sender}`;
  }

  const raw = extractText(message).trim();
  const m = /^\*\*From\s+([^*]+)\*\*(?:\s*\([^)\n]*\))?\s*(?:\n+_[^_\n]+_\s*)?([\s\S]*)$/.exec(raw);
  if (m) {
    const fallbackSender = m[1]!.trim();
    const preview = oneLine(m[2] ?? "", 72);
    return preview
      ? `[intercom] From ${fallbackSender}: ${preview}`
      : `[intercom] From ${fallbackSender}`;
  }
  return undefined;
}

function extractRendererHeadline(
  component: unknown,
  customType?: string,
): string | undefined {
  if (!component || typeof component !== "object") return undefined;
  const renderFn = (component as { render?: (width: number) => string[] }).render;
  if (typeof renderFn !== "function") return undefined;
  let lines: string[];
  try {
    lines = renderFn.call(component, 240);
  } catch {
    return undefined;
  }
  if (!Array.isArray(lines)) return undefined;
  for (const raw of lines) {
    if (typeof raw !== "string") continue;
    const stripped = stripExpandHint(stripTerminalEscapes(raw))
      .replace(/\s+/g, " ")
      .trim();
    if (!stripped) continue;
    const unboxed = stripped
      .replace(/^[╭┌┏╰└┗│┃─━═]+|[╮┐┓╯┘┛│┃─━═]+$/g, "")
      .trim();
    const candidate = stripExpandHint(unboxed);
    if (!candidate) continue;
    const prefixed =
      customType?.startsWith("subagent") && !candidate.startsWith("[")
        ? `[subagent] ${candidate}`
        : candidate;
    return oneLine(prefixed, 96);
  }
  return undefined;
}

function clearTargetChildren(target: {
  children?: unknown[];
  clear?: () => void;
  removeChild?: (c: unknown) => void;
  customComponent?: unknown;
  [MAIN_CHILD_KEY]?: unknown;
  [RENDER_CACHE_KEY]?: unknown;
}): void {
  if (typeof target.clear === "function") {
    target.clear();
  } else {
    for (const child of [...(target.children ?? [])]) {
      try {
        target.removeChild?.(child);
      } catch {
        /* ignore */
      }
    }
  }
  target[MAIN_CHILD_KEY] = undefined;
  target[RENDER_CACHE_KEY] = undefined;
}

function computeLeadLines(target: { _expanded?: boolean }): number {
  const prev = getPreviousSibling(target);
  if (target._expanded) {
    return prev ? 1 : 0;
  }
  return shouldGapBefore(target) ? 1 : 0;
}

function ensureLeadSpacer(target: {
  _expanded?: boolean;
  [LEAD_SPACER_KEY]?: Spacer;
  [RENDER_CACHE_KEY]?: RenderCache;
}): Spacer {
  let spacer = target[LEAD_SPACER_KEY];
  const want = computeLeadLines(target);
  if (!spacer) {
    spacer = new Spacer(want);
    target[LEAD_SPACER_KEY] = spacer;
  } else if (spacer.lines !== want) {
    spacer.setLines(want);
    target[RENDER_CACHE_KEY] = undefined;
  }
  return spacer;
}

function flattenExpandedCustomTree(node: unknown, depth = 0): void {
  if (!node || typeof node !== "object" || depth > 10) return;
  const n = node as {
    setBgFn?: (fn: (t: string) => string) => void;
    paddingX?: number;
    paddingY?: number;
    setText?: (t: string) => void;
    defaultTextStyle?: Record<string, unknown>;
    defaultStylePrefix?: unknown;
    clearRenderCache?: () => void;
    children?: unknown[];
    child?: unknown;
  };

  // Zero outer/inner Box horizontal & vertical padding so wrapCustomExpandedBody
  // aligns every expanded block at exact RESPONSE_LEFT_PAD.
  if (typeof n.setBgFn === "function") {
    if (typeof n.paddingX === "number") n.paddingX = 0;
    if (typeof n.paddingY === "number") n.paddingY = 0;
  }

  // Quiet Markdown body text to bodyFg while preserving bold/code/links.
  if (
    typeof n.setText === "function" &&
    "defaultTextStyle" in n &&
    typeof n.clearRenderCache === "function"
  ) {
    n.defaultTextStyle = {
      ...(n.defaultTextStyle ?? {}),
      color: (t: string) => bodyFg(t),
      bgColor: undefined,
    };
    n.defaultStylePrefix = undefined;
    try {
      n.clearRenderCache();
    } catch {
      /* ignore */
    }
  }

  if (Array.isArray(n.children)) {
    // Drop leading Spacers inside lazy containers (e.g. createSlashResultComponent)
    while (
      depth === 0 &&
      n.children.length > 1 &&
      isRecord(n.children[0]) &&
      typeof (n.children[0] as { lines?: unknown }).lines === "number" &&
      !("children" in (n.children[0] as object))
    ) {
      n.children.shift();
    }
    for (let i = 0; i < n.children.length; i++) {
      // Unwrap MouseRegion inside SubagentMessageBlock so clicks fold cleanly.
      n.children[i] = unwrapMouseRegion(n.children[i]);
      flattenExpandedCustomTree(n.children[i], depth + 1);
    }
  }
  if (n.child && typeof n.child === "object") {
    flattenExpandedCustomTree(n.child, depth + 1);
  }
}

function wrapCustomExpandedBody(
  component: RenderableChild,
  target: object,
  pad: number,
): RenderableChild {
  const id = idForTarget(target);
  const inner = unwrapMouseRegion(component) as RenderableChild & {
    children?: unknown[];
  };
  // Warm lazy containers (e.g. SLASH_RESULT_TYPE) before stripping boxes.
  if (Array.isArray(inner.children) && inner.children.length === 0) {
    try {
      inner.render(120);
    } catch {
      /* ignore */
    }
  }
  stripBgDeep(inner);
  flattenExpandedCustomTree(inner);
  stripBgDeep(inner);
  markBodyFoldDeep(inner, id, []);

  const wrapped = wrapFoldBodyComponent(inner, id, pad);
  return {
    render(width: number) {
      registerFoldHandler(id, () => {
        toggleToolAt(target, "custom");
      });
      return wrapped.render(width);
    },
    invalidate() {
      wrapped.invalidate?.();
    },
    // Omit handleMouse so inner MouseRegion / InlineMessageComponent.handleMouse
    // never intercepts fullscreen body clicks before TuiAltScreen's fold seam.
  };
}

function attachManagedChildren(
  target: CustomMessageProto | CustomEntryProto,
  mainChild: RenderableChild,
  keepCustomComponent: boolean,
): void {
  clearTargetChildren(target);
  const spacer = ensureLeadSpacer(target);
  target[CUSTOM_CHROME_MARK] = true;
  target[MAIN_CHILD_KEY] = mainChild;
  target.__syncCustomLeadSpacer = () => {
    ensureLeadSpacer(target);
  };
  target.addChild(spacer);
  target.addChild(mainChild);
  target.customComponent = keepCustomComponent ? mainChild : undefined;
}

function renderManagedCustom(
  self: CustomMessageProto | CustomEntryProto,
  width: number,
  generation: number,
  originalRender: (width: number) => string[],
): string[] {
  if (self[PATCHED_GEN] !== generation) {
    self[PATCHED_GEN] = generation;
    try {
      self.rebuild();
    } catch {
      /* keep pre-existing children on unexpected throw */
    }
  }
  const spacer = self[LEAD_SPACER_KEY];
  const main = self[MAIN_CHILD_KEY];
  if (!spacer || !main) {
    return originalRender.call(self, width);
  }
  const lead = spacer.lines;
  const mainLines = main.render(width);
  if (lead <= 0) {
    self.mouseLayout = {
      width,
      children: [
        { component: spacer, height: 0 },
        { component: main, height: mainLines.length },
      ],
    };
    return mainLines;
  }
  const hit = self[RENDER_CACHE_KEY];
  if (
    hit &&
    hit.width === width &&
    hit.lead === lead &&
    hit.mainLines === mainLines
  ) {
    self.mouseLayout = {
      width,
      children: [
        { component: spacer, height: lead },
        { component: main, height: mainLines.length },
      ],
    };
    return hit.out;
  }
  const out: string[] = [];
  for (let i = 0; i < lead; i++) out.push("");
  for (const line of mainLines) out.push(line);
  self[RENDER_CACHE_KEY] = { width, lead, mainLines, out };
  self.mouseLayout = {
    width,
    children: [
      { component: spacer, height: lead },
      { component: main, height: mainLines.length },
    ],
  };
  return out;
}

function resolveCustomEntryPrototype(piMod: Record<string, unknown>): CustomEntryProto | undefined {
  const direct = piMod.CustomEntryComponent as { prototype?: CustomEntryProto } | undefined;
  if (direct?.prototype?.rebuild) return direct.prototype;

  const IM = piMod.InteractiveMode as
    | { prototype?: { addCustomEntryToChat?: (entry: unknown) => void } }
    | undefined;
  const addEntry = IM?.prototype?.addCustomEntryToChat;
  if (typeof addEntry !== "function") return undefined;

  let captured: unknown;
  try {
    addEntry.call(
      {
        outputPad: 1,
        toolOutputExpanded: false,
        session: {
          extensionRunner: {
            getEntryRenderer: () => () => new Text("", 0, 0),
          },
        },
        chatContainer: {
          children: [],
          addChild(c: unknown) {
            captured = c;
          },
        },
      },
      {
        type: "custom",
        customType: "__pi_grok_tui_probe__",
        id: "__probe__",
        parentId: null,
        timestamp: "",
      },
    );
  } catch {
    return undefined;
  }
  if (!captured || typeof captured !== "object") return undefined;
  const proto = Object.getPrototypeOf(captured) as CustomEntryProto | null;
  return typeof proto?.rebuild === "function" ? proto : undefined;
}

export async function installCustomMessageCollapsePatch(): Promise<() => void> {
  const [piMod, { theme: rawTheme }] = await Promise.all([
    importInternal<Record<string, unknown>>(
      PI_CODING_AGENT,
      INTERNAL_MODULES.customMessage,
    ),
    importInternal<{ theme: unknown }>(PI_CODING_AGENT, INTERNAL_MODULES.theme),
  ]);

  const rawMsg = piMod.CustomMessageComponent;
  if (!rawMsg || (typeof rawMsg !== "function" && typeof rawMsg !== "object")) {
    throw new Error("pi-grok-tui: CustomMessageComponent missing");
  }

  const msgProto = (rawMsg as { prototype: CustomMessageProto }).prototype;
  const theme = rawTheme as ChromeTheme;

  if (typeof msgProto.rebuild !== "function") {
    throw new Error("pi-grok-tui: CustomMessageComponent.rebuild missing");
  }

  const generation = ++currentGeneration;

  // ── 1. Patch CustomMessageComponent ────────────────────────────────────────
  const origMsgRebuild = msgProto.rebuild;
  const origMsgSetExpanded = msgProto.setExpanded;
  const origMsgRender = msgProto.render;

  msgProto.rebuild = function (this: CustomMessageProto) {
    this[PATCHED_GEN] = generation;
    const prevExpanded = this._expanded;
    try {
      const mode = effectiveToolMode(this, "custom");
      const showBody = mode !== "chrome";
      this._expanded = showBody;

      if (showBody) {
        clearTargetChildren(this);
        this.customComponent = undefined;
        origMsgRebuild.call(this);
        const rawBody = (this.customComponent ?? this.box) as RenderableChild | undefined;
        if (!rawBody || typeof rawBody.render !== "function") return;
        if (!this.customComponent && this.box) {
          // Default [customType] + Markdown box: quiet Text/Markdown body
          dimBodyTexts(this.box, (t) => bodyFg(t), []);
        }
        const wrapped = wrapCustomExpandedBody(rawBody, this, RESPONSE_LEFT_PAD);
        attachManagedChildren(this, wrapped, Boolean(this.customComponent));
      } else {
        clearTargetChildren(this);
        this.customComponent = undefined;

        const customType = this.message?.customType || "message";
        let label = formatIntercomChromeLabel(this.message);

        if (!label && this.customRenderer) {
          origMsgRebuild.call(this);
          if (this.customComponent) {
            label = extractRendererHeadline(this.customComponent, customType);
          }
          clearTargetChildren(this);
          this.customComponent = undefined;
        }

        if (!label) {
          const body = oneLine(extractText(this.message));
          label = body ? `[${customType}] ${body}` : `[${customType}]`;
        }

        const chrome = clickableChromeChild(theme, {
          target: this,
          toolName: "custom",
          kind: "group",
          label,
          pad: RESPONSE_LEFT_PAD,
        });
        attachManagedChildren(this, chrome, false);
      }

      if (prevExpanded !== this._expanded) {
        const next = getNextSibling(this);
        if (next) relayoutChild(next);
      }
    } catch {
      try {
        origMsgRebuild.call(this);
      } catch {
        /* unrecoverable */
      }
    }
  };

  if (typeof origMsgSetExpanded === "function") {
    msgProto.setExpanded = function (this: CustomMessageProto, expanded: boolean) {
      this._expanded = expanded;
      this.rebuild();
    };
  }

  if (typeof origMsgRender === "function") {
    msgProto.render = function (this: CustomMessageProto, width: number): string[] {
      return renderManagedCustom(this, width, generation, origMsgRender);
    };
  }

  // ── 2. Patch CustomEntryComponent (pi.registerEntryRenderer) ───────────────
  const entryProto = resolveCustomEntryPrototype(piMod);
  let undoEntry: (() => void) | undefined;

  if (entryProto) {
    const origEntryRebuild = entryProto.rebuild;
    const origEntrySetExpanded = entryProto.setExpanded;
    const origEntryRender = entryProto.render;

    entryProto.rebuild = function (this: CustomEntryProto) {
      this[PATCHED_GEN] = generation;
      const prevExpanded = this._expanded;
      try {
        const mode = effectiveToolMode(this, "custom");
        const showBody = mode !== "chrome";
        this._expanded = showBody;

        clearTargetChildren(this);
        this.customComponent = undefined;
        origEntryRebuild.call(this);

        // If the entry renderer declined (returned undefined), keep hasContent() === false.
        if (!this.customComponent) {
          clearTargetChildren(this);
          this.customComponent = undefined;
          return;
        }

        const rawComponent = this.customComponent as RenderableChild;
        if (showBody) {
          const wrapped = wrapCustomExpandedBody(rawComponent, this, RESPONSE_LEFT_PAD);
          attachManagedChildren(this, wrapped, true);
        } else {
          const customType = this.entry?.customType || "entry";
          const label =
            extractRendererHeadline(rawComponent, customType) ?? `[${customType}]`;
          const chrome = clickableChromeChild(theme, {
            target: this,
            toolName: "custom",
            kind: "group",
            label,
            pad: RESPONSE_LEFT_PAD,
          });
          // Keep customComponent truthy so InteractiveMode.addCustomEntryToChat
          // sees hasContent() === true and mounts the collapsed row.
          attachManagedChildren(this, chrome, true);
        }

        if (prevExpanded !== this._expanded) {
          const next = getNextSibling(this);
          if (next) relayoutChild(next);
        }
      } catch {
        try {
          origEntryRebuild.call(this);
        } catch {
          /* unrecoverable */
        }
      }
    };

    if (typeof origEntrySetExpanded === "function") {
      entryProto.setExpanded = function (this: CustomEntryProto, expanded: boolean) {
        this._expanded = expanded;
        this.rebuild();
      };
    }

    if (typeof origEntryRender === "function") {
      entryProto.render = function (this: CustomEntryProto, width: number): string[] {
        return renderManagedCustom(this, width, generation, origEntryRender);
      };
    }

    undoEntry = () => {
      entryProto.rebuild = origEntryRebuild;
      if (typeof origEntrySetExpanded === "function") {
        entryProto.setExpanded = origEntrySetExpanded;
      }
      if (typeof origEntryRender === "function") {
        entryProto.render = origEntryRender;
      }
    };
  }

  return () => {
    msgProto.rebuild = origMsgRebuild;
    if (typeof origMsgSetExpanded === "function") {
      msgProto.setExpanded = origMsgSetExpanded;
    }
    if (typeof origMsgRender === "function") {
      msgProto.render = origMsgRender;
    }
    undoEntry?.();
  };
}
