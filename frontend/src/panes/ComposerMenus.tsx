/** The three things that open from the strip under the composer: the model
 *  menu, the permission menu and the template-and-voice panel.
 *
 *  Fetched when one of them is first opened rather than shipped ahead of
 *  every session, the way the past-conversation list and the version panel
 *  already are. Each draws nothing until its trigger is pressed, and a
 *  session that never touches the strip never pays for them; the strip's
 *  buttons themselves stay in `Chat.tsx`, because they are always drawn.
 *
 *  Three rules make the split hold. Each component takes its `ref` from
 *  the panel, because `useDismiss` in `Chat.tsx` reads `ref.current` at
 *  the moment of a press, so a ref filled on mount is enough. Each puts
 *  focus into itself on mount, because the effect that used to do that
 *  from `Chat.tsx` now fires before the chunk has arrived and would focus
 *  nothing. And the words the bolt's aria-label reads live in
 *  `mode-words.ts`, imported by both sides.
 */
import { forwardRef, useEffect, useRef } from "react";
import { focusFirst, walkMenu } from "./menu-keys";
import { WELCOME_ACTIONS } from "../welcome";
import { MODE_NOTES, MODE_TITLES, type Mode } from "./mode-words";

type ModelEntry = { id: string; name: string; note: string };

export const ModelMenu = forwardRef<
  HTMLDivElement,
  { models: ModelEntry[]; current: string; onChoose: (id: string) => void }
>(function ModelMenu({ models, current, onChoose }, ref) {
  return (
    <div
      ref={ref}
      data-testid="model-menu"
      className="nx-arrive absolute bottom-[30px] left-0 z-40 w-[230px] overflow-hidden rounded-[5px] border border-line bg-surface shadow-float"
    >
      <div className="t-micro px-[10px] pb-1 pt-2 text-ink-2">
        Which model answers here
      </div>
      {(models.length ? models : [{ id: "", name: "Default", note: "" }]).map(
        (entry) => (
          <button
            key={entry.id}
            className="flex w-full items-start gap-2 border-t border-line px-[10px] py-[6px] text-left transition-colors duration-[90ms] hover:bg-surface-2"
            aria-pressed={current === entry.id}
            onClick={() => onChoose(entry.id)}
          >
            <span
              className={`mt-[6px] h-[4px] w-[4px] shrink-0 rounded-full ${
                current === entry.id ? "bg-pen" : "bg-transparent"
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="t-ui block truncate text-ink">{entry.name}</span>
              {entry.note ? (
                <span className="t-meta block text-ink-2">{entry.note}</span>
              ) : null}
            </span>
          </button>
        ),
      )}
    </div>
  );
});

export const ModeMenu = forwardRef<
  HTMLDivElement,
  {
    mode: Mode;
    onChoose: (mode: Mode) => void;
    onClose: () => void;
    /** Where focus goes when Escape closes the menu: the bolt. */
    onEscape: () => void;
  }
>(function ModeMenu({ mode, onChoose, onClose, onEscape }, ref) {
  const own = useRef<HTMLDivElement | null>(null);
  // Focus goes into the menu once, when it mounts, which is when it opens:
  // the same lesson the strip menus learned about refs.
  useEffect(() => {
    focusFirst(own.current);
  }, []);
  return (
    <div
      ref={(node) => {
        own.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      role="menu"
      data-testid="mode-menu"
      className="nx-arrive absolute bottom-[30px] left-0 z-20 w-[288px] rounded-[5px] border border-line bg-surface-2 p-1 shadow-float"
      // The role's promise, kept: arrows walk the three, Escape closes and
      // gives the bolt its focus back.
      onKeyDown={(event) => {
        if (walkMenu(event, onClose) && event.key === "Escape") onEscape();
      }}
    >
      {(["ask", "project", "all"] as const).map((option) => (
        <button
          key={option}
          role="menuitemradio"
          aria-checked={mode === option}
          data-testid={`mode-${option}`}
          className={`flex w-full items-start gap-2 rounded-[3px] px-2 py-[6px] text-left transition-colors duration-[90ms] hover:bg-surface-3 ${
            mode === option ? "bg-surface-3" : ""
          }`}
          onClick={() => onChoose(option)}
        >
          {/* The same 4px dot the model popover one icon along the strip
              uses for its selection. This marked the current position
              with a fill alone, and two popovers on the same strip saying
              the same thing two different ways is a difference a reader
              has to learn rather than read. */}
          <span
            className={`mt-[6px] h-[4px] w-[4px] shrink-0 rounded-full ${
              mode === option ? "bg-pen" : "bg-transparent"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span
              className={`t-ui block ${
                option === "all" ? "text-warn" : "text-ink"
              }`}
            >
              {MODE_TITLES[option]}
            </span>
            <span className="t-micro mt-[2px] block text-ink-3">
              {MODE_NOTES[option]}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
});

export const SetupPanel = forwardRef<
  HTMLDivElement,
  { onPick: (kind: (typeof WELCOME_ACTIONS)[number]["kind"]) => void }
>(function SetupPanel({ onPick }, ref) {
  const own = useRef<HTMLDivElement | null>(null);
  // The panel opens *above* the composer and its trigger comes after the
  // box in the DOM, so Tab from the trigger walks away from the thing it
  // just opened: focus is moved by hand, onto the first choice.
  useEffect(() => {
    own.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={(node) => {
        own.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      id="nx-setup"
      role="group"
      aria-label="Template and voice"
      className="mb-2 flex flex-col gap-2 rounded-[3px] border border-line bg-surface-2 p-2"
    >
      {WELCOME_ACTIONS.map((action) => (
        <button
          key={action.kind}
          className="ghost-button nx-press px-3 py-2 text-left"
          onClick={() => onPick(action.kind)}
        >
          <span className="t-ui block">{action.label}</span>
          <span className="t-meta block text-ink-2">{action.detail}</span>
        </button>
      ))}
    </div>
  );
});
