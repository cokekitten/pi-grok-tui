/**
 * Thinking expand shortcuts.
 *
 * On macOS, Option (Alt) + letter usually inserts a special character instead
 * of sending alt+key, unless the terminal maps Option as Esc+/Meta.
 * Option+T → † (DAGGER U+2020). We register that so ⌥T works out of the box.
 */
import { Key } from "@earendil-works/pi-tui";

export const isMac = process.platform === "darwin";

/** macOS Option+T produces this character when Option is not Meta. */
export const MAC_OPTION_T = "†";

/** Hint shown next to Thought chrome. */
export const THINKING_EXPAND_HINT = isMac ? " (⌥T)" : " (Alt+T)";

/** All shortcut ids to register for toggle-thinking. */
export function thinkingExpandShortcutIds(): string[] {
  const ids = [Key.alt("t"), Key.ctrlShift("t")];
  if (isMac) {
    // Raw character when Terminal/iTerm leave Option as compose key
    ids.push(MAC_OPTION_T);
  }
  return ids;
}
