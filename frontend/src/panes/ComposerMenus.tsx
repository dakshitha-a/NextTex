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
import { MenuHeader, MenuItem } from "../ui/Menu";
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
      className="nx-menu-anchored nx-arrive bottom-[34px] left-0 w-[260px]"
    >
      <MenuHeader>Which model answers here</MenuHeader>
      {(models.length ? models : [{ id: "", name: "Default", note: "" }]).map(
        (entry) => (
          <MenuItem
            key={entry.id}
            role="menuitemradio"
            aria-checked={current === entry.id}
            aria-pressed={current === entry.id}
            note={entry.note || undefined}
            onClick={() => onChoose(entry.id)}
          >
            {entry.name}
          </MenuItem>
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
      className="nx-menu-anchored nx-arrive bottom-[34px] left-0 w-[300px]"
      // The role's promise, kept: arrows walk the three, Escape closes and
      // gives the bolt its focus back.
      onKeyDown={(event) => {
        if (walkMenu(event, onClose) && event.key === "Escape") onEscape();
      }}
    >
      <MenuHeader>What it asks about</MenuHeader>
      {(["ask", "project", "all"] as const).map((option) => (
        <MenuItem
          key={option}
          role="menuitemradio"
          aria-checked={mode === option}
          data-testid={`mode-${option}`}
          note={MODE_NOTES[option]}
          className={option === "all" ? "text-warn" : undefined}
          onClick={() => onChoose(option)}
        >
          {MODE_TITLES[option]}
        </MenuItem>
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
