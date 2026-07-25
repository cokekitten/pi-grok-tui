/**
 * Thinking expand shortcuts.
 *
 * On macOS, Option+letter usually inserts a special character instead of
 * sending alt+key — unless the terminal maps Option as Esc+/Meta.
 * Option+T → † (DAGGER U+2020).
 *
 * Important: pi's matchesKey() only accepts a–z / digits / a fixed symbol set
 * for bare single-char keys. Registering "†" via pi.registerShortcut does
 * nothing (matchesKey("†","†") === false). We must intercept raw input via
 * ctx.ui.onTerminalInput and compare the character directly.
 */
import { Key, matchesKey } from "@earendil-works/pi-tui";

export const isMac = process.platform === "darwin";

/** macOS Option+T produces this character when Option is not Meta. */
export const MAC_OPTION_T = "†";

/** Hint shown next to Thought chrome. */
export const THINKING_EXPAND_HINT = isMac ? " (⌥T)" : " (Alt+T)";

/**
 * Shortcut ids that matchesKey can actually match.
 * Do NOT include MAC_OPTION_T here — registerShortcut cannot match it.
 */
export function thinkingExpandShortcutIds(): string[] {
  // alt+t: terminals with Option-as-Meta / Esc+letter
  // ctrl+shift+h: reliable fallback (avoid ctrl+shift+t — pi-goal-x steals it)
  return [Key.alt("t"), Key.ctrlShift("h")];
}

/** True if raw terminal input should toggle thinking expand. */
export function isThinkingExpandInput(data: string): boolean {
  if (!data) return false;
  // macOS Option+T as composed character (Terminal.app / iTerm default Option)
  if (data === MAC_OPTION_T) return true;
  // UTF-8 bytes if somehow delivered without decoding (unlikely but cheap)
  if (data === "\u2020") return true;
  try {
    if (matchesKey(data, Key.alt("t"))) return true;
    if (matchesKey(data, Key.ctrlShift("h"))) return true;
    // still accept ctrl+shift+t if goal-x is not installed / doesn't consume first
    if (matchesKey(data, Key.ctrlShift("t"))) return true;
  } catch {
    /* ignore */
  }
  return false;
}
