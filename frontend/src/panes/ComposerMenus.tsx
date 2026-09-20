/** The two things that open from the row under the composer: the one
 *  menu under the chip, and the prompt menu a `/` opens.
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
 *  nothing. And the words the chip reads live in `mode-words.ts`,
 *  imported by both sides.
 */
import { forwardRef, useEffect, useRef } from "react";
import { focusFirst, walkMenu } from "./menu-keys";
import { MenuDivider, MenuHeader, MenuItem } from "../ui/Menu";
import { MODE_NOTES, MODE_TITLES, type Mode } from "./mode-words";

type ModelEntry = { id: string; name: string; note: string };

/** One menu under the composer's chip: which model answers, and, for
 *  the agent that asks, what it asks about, below a rule. The two halves
 *  keep their testids, `model-menu` and `mode-menu`, since each is still
 *  the thing a spec reaches for; the arrows walk both as one list and
 *  Escape gives the chip its focus back. */
export const ComposerMenu = forwardRef<
  HTMLDivElement,
  {
    models: ModelEntry[];
    current: string;
    onChooseModel: (id: string) => void;
    /** Whether this agent ever asks: only Claude puts a card up, and a
     *  control on the others would promise a change that does not happen. */
    asks: boolean;
    mode: Mode;
    onChooseMode: (mode: Mode) => void;
    onClose: () => void;
    onEscape: () => void;
  }
>(function ComposerMenu({ models, current, onChooseModel, asks, mode, onChooseMode, onClose, onEscape }, ref) {
  const own = useRef<HTMLDivElement | null>(null);
  // Focus goes into the menu once, when it mounts, which is when it
  // opens, and onto the model in use rather than the first row.
  useEffect(() => {
    const chosen = own.current?.querySelector<HTMLElement>('[data-testid="model-menu"] [aria-checked="true"]');
    if (chosen) chosen.focus();
    else focusFirst(own.current);
  }, []);
  return (
    <div
      ref={(node) => {
        own.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      role="menu"
      data-testid="composer-menu"
      className="nx-menu-anchored nx-arrive bottom-[38px] left-0 w-[300px]"
      onKeyDown={(event) => {
        if (walkMenu(event, onClose) && event.key === "Escape") onEscape();
      }}
    >
      <div data-testid="model-menu">
        <MenuHeader>Which model answers here</MenuHeader>
        {(models.length ? models : [{ id: "", name: "Default", note: "" }]).map((entry) => (
          <MenuItem
            key={entry.id}
            role="menuitemradio"
            aria-checked={current === entry.id}
            note={entry.note || undefined}
            onClick={() => onChooseModel(entry.id)}
          >
            {entry.name}
          </MenuItem>
        ))}
      </div>
      {asks ? (
        <div data-testid="mode-menu">
          <MenuDivider />
          <MenuHeader>What it asks about</MenuHeader>
          {(["ask", "project", "all"] as const).map((option) => (
            <MenuItem
              key={option}
              role="menuitemradio"
              aria-checked={mode === option}
              data-testid={`mode-${option}`}
              note={MODE_NOTES[option]}
              className={option === "all" ? "text-warn" : undefined}
              onClick={() => onChooseMode(option)}
            >
              {MODE_TITLES[option]}
            </MenuItem>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/** The reusable prompts a `/` at the start of the composer can name.
 *
 *  Drawn above the box while the draft is one line beginning with a
 *  slash, listing what it could still mean with each prompt's first
 *  line as its hint. The arrow keys and Enter belong to the composer,
 *  which tells this which row is chosen, and a click picks a row. A
 *  prompt from the project is marked, since a group's own review is a
 *  different thing from the one that ships. */
export const PromptMenu = forwardRef<
  HTMLDivElement,
  {
    prompts: { name: string; said: string; source: string; hint: string }[];
    selected: number;
    onPick: (index: number) => void;
    onHover: (index: number) => void;
  }
>(function PromptMenu({ prompts, selected, onPick, onHover }, ref) {
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Reusable prompts"
      data-testid="prompt-menu"
      className="nx-menu-anchored nx-arrive bottom-full left-0 right-0 mb-1"
    >
      <MenuHeader>A reusable prompt: Enter fills it in, and you send when you are ready</MenuHeader>
      {prompts.map((prompt, index) => (
        <MenuItem
          key={prompt.name}
          role="option"
          hover="none"
          aria-selected={index === selected}
          data-testid="prompt-row"
          note={prompt.hint}
          onPointerMove={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(index)}
        >
          <span className="font-mono text-[13px]">/{prompt.said}</span>
          {prompt.source === "project" ? (
            <span className="t-micro ml-2 text-ink-3">this project's</span>
          ) : null}
        </MenuItem>
      ))}
    </div>
  );
});
