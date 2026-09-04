/**
 * Restyle CompactionSummaryMessageComponent to grok chrome (no native purple block).
 */
import type { ChromeTheme } from "./chrome.js";
import {
  importInternal,
  PI_CODING_AGENT,
} from "./internal-import.js";
import {
  paintCompactionChrome,
  type CompactionChromeTarget,
} from "./compaction-chrome.js";

interface CompactionProto extends CompactionChromeTarget {
  updateDisplay(): void;
}

export async function installCompactionStylePatch(): Promise<() => void> {
  const [{ CompactionSummaryMessageComponent: raw }, { theme: rawTheme }] =
    await Promise.all([
      importInternal<{ CompactionSummaryMessageComponent?: unknown }>(
        PI_CODING_AGENT,
        "dist/modes/interactive/components/compaction-summary-message.js",
      ),
      importInternal<{ theme: unknown }>(
        PI_CODING_AGENT,
        "dist/modes/interactive/theme/theme.js",
      ),
    ]);

  const Ctor = raw as { prototype: CompactionProto } | undefined;
  if (!Ctor?.prototype?.updateDisplay) {
    throw new Error("pi-grok-tui: CompactionSummaryMessageComponent missing");
  }

  const proto = Ctor.prototype;
  const theme = rawTheme as ChromeTheme;
  const original = proto.updateDisplay;

  proto.updateDisplay = function (this: CompactionProto) {
    try {
      paintCompactionChrome(this, theme);
    } catch {
      try {
        original.call(this);
      } catch {
        /* unrecoverable */
      }
    }
  };

  return () => {
    proto.updateDisplay = original;
  };
}
