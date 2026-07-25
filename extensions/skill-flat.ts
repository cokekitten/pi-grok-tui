/**
 * Strip SkillInvocationMessageComponent color blocks; dim body when expanded.
 */
import { bodyFg } from "./chrome.js";
import { dimBodyTexts, stripBgDeep } from "./flat-style.js";
import { importInternal, PI_CODING_AGENT } from "./internal-import.js";

export async function installSkillFlatPatch(): Promise<() => void> {
  const mod = await importInternal<{
    SkillInvocationMessageComponent?: unknown;
  }>(
    PI_CODING_AGENT,
    "dist/modes/interactive/components/skill-invocation-message.js",
  );

  const Ctor = mod.SkillInvocationMessageComponent as
    | { prototype: { updateDisplay?: () => void; children?: unknown[] } }
    | undefined;

  if (!Ctor?.prototype?.updateDisplay) {
    throw new Error("pi-grok-tui: SkillInvocationMessageComponent missing");
  }

  const proto = Ctor.prototype;
  const original = proto.updateDisplay!;

  proto.updateDisplay = function (this: {
    children?: unknown[];
    expanded?: boolean;
  }) {
    original.call(this);
    try {
      stripBgDeep(this);
      // Dim body when expanded
      if (this.expanded) {
        dimBodyTexts(this, (t) => bodyFg(t), []);
      }
    } catch {
      /* ignore */
    }
  };

  return () => {
    proto.updateDisplay = original;
  };
}
