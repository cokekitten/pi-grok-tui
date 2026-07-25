/**
 * Strip SkillInvocationMessageComponent color blocks; dim body when expanded.
 */
import { safeFg, type ChromeTheme } from "./chrome.js";
import { dimBodyTexts, stripBgDeep } from "./flat-style.js";
import { importInternal, PI_CODING_AGENT } from "./internal-import.js";

export async function installSkillFlatPatch(): Promise<() => void> {
  const [mod, themeMod] = await Promise.all([
    importInternal<{ SkillInvocationMessageComponent?: unknown }>(
      PI_CODING_AGENT,
      "dist/modes/interactive/components/skill-invocation-message.js",
    ),
    importInternal<{ theme: unknown }>(
      PI_CODING_AGENT,
      "dist/modes/interactive/theme/theme.js",
    ),
  ]);

  const Ctor = mod.SkillInvocationMessageComponent as
    | { prototype: { updateDisplay?: () => void; children?: unknown[] } }
    | undefined;

  if (!Ctor?.prototype?.updateDisplay) {
    throw new Error("thinking-scroll: SkillInvocationMessageComponent missing");
  }

  const proto = Ctor.prototype;
  const original = proto.updateDisplay!;
  const theme = themeMod.theme as ChromeTheme;

  proto.updateDisplay = function (this: {
    children?: unknown[];
    expanded?: boolean;
  }) {
    original.call(this);
    try {
      stripBgDeep(this);
      // Dim body when expanded (skip first label line roughly by dimming all Text under)
      if (this.expanded) {
        dimBodyTexts(this, (t) => safeFg(theme, "dim", t), []);
      }
    } catch {
      /* ignore */
    }
  };

  return () => {
    proto.updateDisplay = original;
  };
}
