import { useStore } from "../store";
import { agentName, type Provider } from "../agent-name";

/** The way to the agent, in one place at every width.
 *
 *  It used to be two controls that were never both present: a vertical
 *  strip at the right edge above 1400px, and a button in the editor's tab
 *  row below it. The tab-row button lives inside the editor pane, which is
 *  hidden when the source is folded away and when the preview has the
 *  window below 900px -- so in two ordinary layouts there was no way to
 *  reach the agent with a mouse at all, only the keyboard shortcut.
 *
 *  So: one control, in the shell rather than in any pane, in the same
 *  corner whatever the layout is doing. It floats over whatever is open,
 *  which is the point -- it belongs to the window, not to a pane.
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

export default function AgentButton({
  open,
  onToggle,
  right,
}: {
  open: boolean;
  onToggle: () => void;
  /** How far in from the window's edge, so the pill travels with the panel
   *  rather than being covered by it. */
  right: number;
}) {
  const provider = useStore((s) => s.agent?.provider) as Provider | undefined;
  const thinking = useStore((s) => s.thinking);
  const waiting = useStore((s) => s.awaitingPermission);
  const name = agentName(provider);

  return (
    <button
      className={[
        "nx-agent-button group fixed z-[35] flex h-[34px] items-center gap-[7px]",
        "rounded-full border border-line pl-[11px] pr-[13px]",
        "shadow-[var(--float)] transition-[background-color,color,right] duration-150",
        open
          ? "bg-surface-3 text-ink"
          : "bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink",
      ].join(" ")}
      style={{ right, bottom: 34 }}
      data-testid={`agent-button-${name.toLowerCase()}`}
      aria-expanded={open}
      aria-label={open ? `Hide ${name}` : `Show ${name} (Ctrl/Cmd-Alt-A)`}
      title={open ? `Hide ${name}` : `Show ${name} (Ctrl/Cmd-Alt-A)`}
      onClick={onToggle}
    >
      <span className="relative flex items-center text-pen">
        {provider === "openai" ? <OpenAIMark /> : <ClaudeMark />}
        {/* The state, on the mark rather than beside it.  "The agent is
            waiting for you to allow something" was invisible whenever the
            panel was closed, which is exactly when it needed saying. */}
        {waiting ? (
          <span
            data-testid="agent-state"
            data-state="waiting"
            className="absolute -bottom-[2px] -right-[3px] h-[8px] w-[8px] rounded-full border-2 border-surface-2 bg-warn"
          />
        ) : thinking ? (
          <span
            data-testid="agent-state"
            data-state="working"
            className="nx-agent-working absolute -bottom-[2px] -right-[3px] h-[8px] w-[8px] rounded-full border-2 border-surface-2 bg-hint"
          />
        ) : null}
      </span>
      <span className="t-meta">{name}</span>
    </button>
  );
}
