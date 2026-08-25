/**
 * Fullscreen click-to-expand: OSC 8 chrome targets + TUI mouse intercept.
 */
import {
  hyperlink,
  truncateToWidth,
  TuiAltScreen,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import {
  formatChromeLine,
  type ChromeKind,
  type ChromeTheme,
} from "./chrome.ts";
import {
  chromeHint,
  foldUrl,
  isGrokFoldScheme,
  parseFoldId,
} from "./click-fold-core.ts";
import { getState } from "./state.ts";

const handlers = new Map<string, () => void>();
const targetIds = new WeakMap<object, string>();
let nextId = 1;

export function resetFoldHandlers(): void {
  handlers.clear();
}

export function registerFoldHandler(id: string, handler: () => void): void {
  handlers.set(id, handler);
}

export function dispatchGrokFoldUrl(url: string): boolean {
  if (!isGrokFoldScheme(url)) return false;
  const id = parseFoldId(url);
  if (id) {
    const handler = handlers.get(id);
    if (handler) {
      try {
        handler();
      } catch {
        /* swallow — never openBrowser a pi-grok-tui URL */
      }
    }
  }
  return true;
}

export function newFoldId(): string {
  const id = `f${nextId}`;
  nextId += 1;
  return id;
}

export function idForTarget(target: object): string {
  const existing = targetIds.get(target);
  if (existing) return existing;
  const id = newFoldId();
  targetIds.set(target, id);
  return id;
}

export function thinkingFoldId(timestamp: number): string {
  return `think-${timestamp}`;
}

export function groupFoldId(header: object): string {
  return `${idForTarget(header)}:g`;
}

type OpenUrlHost = { openUrl?: (url: string) => void };

/** Swap openUrl for the duration of `fn` so grok fold URLs never hit the browser. */
export function withFoldOpenUrl<T>(host: OpenUrlHost, fn: () => T): T {
  const previous = host.openUrl;
  host.openUrl = (url: string) => {
    if (dispatchGrokFoldUrl(url)) return;
    previous?.(url);
  };
  try {
    return fn();
  } finally {
    host.openUrl = previous;
  }
}

export function renderClickableChrome(
  width: number,
  theme: ChromeTheme,
  opts: {
    kind: ChromeKind;
    label: string;
    failedSuffix?: string;
    hintKind: "thinking" | "tool";
    id?: string;
    onClick?: () => void;
  },
): string {
  const state = getState();
  const hint = chromeHint(opts.hintKind, {
    tuiMode: state.tuiMode,
    clickFoldReady: state.clickFoldReady,
  });
  const styled = formatChromeLine(theme, {
    kind: opts.kind,
    label: opts.label,
    failedSuffix: opts.failedSuffix,
    hint,
  });
  const truncated = truncateToWidth(styled, Math.max(1, width), "");
  const clickable =
    state.tuiMode === "fullscreen" &&
    state.clickFoldReady &&
    typeof opts.id === "string" &&
    opts.id.length > 0 &&
    typeof opts.onClick === "function";
  if (!clickable) return truncated;
  registerFoldHandler(opts.id!, opts.onClick!);
  try {
    return hyperlink(truncated, foldUrl(opts.id!));
  } catch {
    return truncated;
  }
}

function wrapDoRender(
  Ctor: { prototype: { doRender?: () => void } },
  mode: "fullscreen" | "regular",
): (() => void) | undefined {
  const original = Ctor.prototype.doRender;
  if (typeof original !== "function") return undefined;
  Ctor.prototype.doRender = function (this: unknown) {
    getState().tuiMode = mode;
    return original.call(this);
  };
  return () => {
    Ctor.prototype.doRender = original;
  };
}

export function installClickFoldPatch(): () => void {
  const state = getState();
  state.clickFoldReady = false;

  const altProto = TuiAltScreen.prototype as unknown as {
    handleSelectionMouseEvent?: (event: unknown) => unknown;
    doRender?: () => void;
  };
  const originalMouse = altProto.handleSelectionMouseEvent;
  const restoreAltRender = wrapDoRender(TuiAltScreen, "fullscreen");
  const restoreMainRender = wrapDoRender(TuiMainScreen, "regular");

  if (
    typeof originalMouse !== "function" ||
    !restoreAltRender ||
    !restoreMainRender
  ) {
    restoreAltRender?.();
    restoreMainRender?.();
    return () => {
      state.clickFoldReady = false;
    };
  }

  altProto.handleSelectionMouseEvent = function (this: OpenUrlHost, event: unknown) {
    return withFoldOpenUrl(this, () => originalMouse.call(this, event));
  };
  state.clickFoldReady = true;

  return () => {
    altProto.handleSelectionMouseEvent = originalMouse;
    restoreAltRender();
    restoreMainRender();
    state.clickFoldReady = false;
  };
}
