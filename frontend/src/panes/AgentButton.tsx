import { useStore } from "../store";
import { agentName, type Provider } from "../agent-name";
import { shortcut } from "../keys";
import { Pressable } from "../ui/controls";

/** The way to the agent while the column is an overlay and parked.
 *
 *  Below the `narrow` breakpoint the column slides in over the page, and
 *  when it is slid away nothing on screen stands for it: no strip, no
 *  header, no tab.  This pill is that thing, in the same corner whatever
 *  the panes are doing, floating over whichever of them is open.
 *
 *  It is not shown in the other two states.  While the column is open, in
 *  either form, the column's own fold control closes it and a second
 *  control for the same act is one more thing to hold in mind.  While the
 *  column is docked and folded, the `Collapsed` strip labelled "Claude"
 *  stands in for it, as the Source and Preview strips stand in for theirs,
 *  and the strip carries the same state dot.  It used to float in all
 *  three, which is what the three screenshots under `docs/` show; the
 *  overhaul's direction is that the pill goes while the column is docked.
 */

/** The provider's mark, drawn rather than fetched.
 *
 *  Drawn, because the app makes no network request for an image and a
 *  remote logo is a tracking pixel wearing a nice hat. Drawn as clean
 *  geometry rather than traced, because a trademark reproduced badly from
 *  memory looks worse than no logo at all -- these are recognisable forms
 *  at the app's own weight, and the provider's name is beside them either
 *  way, which is what actually identifies it.
 */
function ClaudeMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"
         stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
      <path d="M12.0 8.8L12.0 1.8" />
      <path d="M14.3 9.7L19.2 4.8" />
      <path d="M15.2 12.0L22.2 12.0" />
      <path d="M14.3 14.3L19.2 19.2" />
      <path d="M12.0 15.2L12.0 22.2" />
      <path d="M9.7 14.3L4.8 19.2" />
      <path d="M8.8 12.0L1.8 12.0" />
      <path d="M9.7 9.7L4.8 4.8" />
    </svg>
  );
}

function OpenAIMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 2.9 19.6 7.3v8.8L12 20.5 4.4 16.1V7.3z" />
      <path d="M12 11.7 19.6 7.3M12 11.7v8.8M12 11.7 4.4 7.3" />
    </svg>
  );
}

/** The agent's state as a dot: waiting for an answer, or working.
 *
 *  "The agent is waiting for you to allow something" was invisible whenever
 *  the column was closed, which is exactly when it needed saying, so the
 *  dot sits on whatever stands for the closed column: the pill's mark on
 *  the overlay, the folded strip when the column is docked.  Nothing while
 *  the agent is idle; a dot that is always there says nothing. */
export function AgentStateDot({ className = "" }: { className?: string }) {
  const thinking = useStore((s) => s.thinking);
  const waiting = useStore((s) => s.awaitingPermission);
  if (waiting) {
    return (
      <span
        data-testid="agent-state"
        data-state="waiting"
        className={`h-2 w-2 rounded-full border-2 border-surface-2 bg-warn ${className}`}
      />
    );
  }
  if (thinking) {
    return (
      <span
        data-testid="agent-state"
        data-state="working"
        className={`nx-agent-working h-2 w-2 rounded-full border-2 border-surface-2 bg-hint ${className}`}
      />
    );
  }
  return null;
}

export default function AgentButton({ onShow }: { onShow: () => void }) {
  const provider = useStore((s) => s.agent?.provider) as Provider | undefined;
  const name = agentName(provider);
  const label = `Show ${name} (${shortcut("Mod-Alt-A").both})`;

  // The kit's card, as the direction page redrew it and the writer chose
  // (20 September): the provider's mark in the pen colour with the state
  // dot on it, and the name, nothing else on its face.  The shortcut, in
  // both its forms, is the tooltip the title gives on hover and what a
  // screen reader hears, not a hint drawn on the button.
  return (
    <Pressable
      className="nx-agent-button fixed z-[35]"
      style={{ right: 14, bottom: 34 }}
      data-testid={`agent-button-${name.toLowerCase()}`}
      // Only ever rendered while the column it opens is parked.
      aria-expanded={false}
      aria-label={label}
      title={label}
      onClick={onShow}
    >
      <span className="relative flex items-center text-pen">
        {provider === "openai" ? <OpenAIMark /> : <ClaudeMark />}
        <AgentStateDot className="absolute -bottom-0.5 -right-0.75" />
      </span>
      <span className="t-ui">{name}</span>
    </Pressable>
  );
}
