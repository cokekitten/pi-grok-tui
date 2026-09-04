/**
 * Pure compaction chrome helpers — no pi-coding-agent import, so node:test
 * can load this without the 0.85 package root pulling @earendil-works/pi-server.
 */
import { Markdown } from "@earendil-works/pi-tui";
import {
  bodyFg,
  RESPONSE_LEFT_PAD,
  type ChromeTheme,
} from "./chrome.ts";
import { stripBgDeep } from "./flat-style.ts";
import { markBodyFoldDeep } from "./fold-body.ts";
import { clickableChromeChild, effectiveToolMode } from "./tool-click.ts";
import { idForTarget } from "./click-fold.ts";

const passthrough = (t: string) => t;

export interface CompactionChromeTarget {
  expanded: boolean;
  message: { tokensBefore: number; summary: string };
  markdownTheme: unknown;
  paddingX?: number;
  paddingY?: number;
  children?: unknown[];
  setBgFn?(fn: (text: string) => string): void;
  clear(): void;
  addChild(c: unknown): void;
}

export function compactedLabel(tokensBefore: number): string {
  return `Compacted from ${tokensBefore.toLocaleString()} tokens`;
}

export function paintCompactionChrome(
  self: CompactionChromeTarget,
  theme: ChromeTheme,
): void {
  const showBody = effectiveToolMode(self, "custom") !== "chrome";
  self.expanded = showBody;
  if (typeof self.paddingX === "number") self.paddingX = RESPONSE_LEFT_PAD;
  if (typeof self.paddingY === "number") self.paddingY = 0;
  if (typeof self.setBgFn === "function") self.setBgFn(passthrough);
  self.clear();

  const label = compactedLabel(self.message?.tokensBefore ?? 0);
  self.addChild(
    clickableChromeChild(theme, {
      target: self,
      toolName: "custom",
      kind: "group",
      label,
    }) as never,
  );

  if (showBody && self.message?.summary) {
    self.addChild(
      new Markdown(self.message.summary, 0, 0, self.markdownTheme as never, {
        color: (text) => bodyFg(text),
      }),
    );
    markBodyFoldDeep(self, idForTarget(self), []);
  }
  stripBgDeep(self);
}
