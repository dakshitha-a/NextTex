import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/** A text field.
 *
 *  32 px tall, 4 px round, on the second surface with a hairline inset,
 *  and the hint colour's ring when focused.  An icon may sit before the
 *  text and anything may sit after it (a count, a toggle, a shortcut).
 *  The input itself is the element a spec reaches, so `placeholder`,
 *  `aria-label`, `id` and `data-testid` go to it and not to the frame. */
export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  leading?: ReactNode;
  trailing?: ReactNode;
  frameClassName?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { leading, trailing, frameClassName, className, ...rest },
  ref,
) {
  return (
    <span className={`nx-field${frameClassName ? ` ${frameClassName}` : ""}`}>
      {leading}
      <input ref={ref} className={`nx-field-input${className ? ` ${className}` : ""}`} {...rest} />
      {trailing}
    </span>
  );
});

/** A text box of several lines. It takes the look its place gives it
 *  through `className` (the comment cards' field, the sheets' box), and is
 *  here so a component never writes a raw `<textarea>` (Q-038). */
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea(props, ref) {
    return <textarea ref={ref} {...props} />;
  },
);

/** Something pressed whose look is its content: a row, a tab, a hit in a
 *  list, a word in a sentence that does something. `Button` and
 *  `IconButton` are for controls that look like controls; this is for the
 *  rest, which take their look from the class their place gives them, as
 *  `TextArea` does. It is `type="button"` unless told otherwise, so it
 *  never submits a form by accident (Q-038). */
export const Pressable = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function Pressable({ type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} {...rest} />;
  },
);

/** An input that is not a field: a name typed in place in a row, a page
 *  number in a toolbar, a check box beside its sentence. It takes its look
 *  from its place, as `TextArea` does; `Field` is the framed text field
 *  (Q-038). */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} />;
  },
);

/** A choice from a short list the browser draws, in a toolbar or a row.
 *  It takes its look from its place, as `TextArea` does (Q-038). */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return <select ref={ref} {...props} />;
  },
);

/** A small labelled thing: a file name, an added word, a format.
 *
 *  24 px tall on the second surface.  `mono` sets the label in the code
 *  face, for a literal string the machine produced, which is the rule
 *  for monospace everywhere in the app.  `onRemove` adds the small close
 *  at its end, named after what it removes. */
export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  mono?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
};

export function Chip({ mono = false, onRemove, removeLabel, className, children, ...rest }: ChipProps) {
  return (
    <span className={`nx-chip${mono ? " nx-chip-mono" : ""}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
      {onRemove ? (
        <button type="button" className="nx-chip-remove" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

/** A chip that does something: a format to download, in the code face.
 *  `tone` names the surface it sits on, so it stays a step lighter than
 *  its ground on the second surface as on the first.  Disabled, it is
 *  outlined in the third ink: the thing it would give does not exist yet. */
export type ChipButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "surface" | "surface-2";
};

export function ChipButton({ tone = "surface-2", className, type = "button", children, ...rest }: ChipButtonProps) {
  return (
    <button
      type={type}
      className={`nx-chip nx-chip-mono nx-chip-button${className ? ` ${className}` : ""}`}
      data-tone={tone}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A chip that is on or off among several that are not exclusive: which
 *  cards the editor shows on hover.  Where a switch answers one question
 *  and a segmented control picks one of a few, this is many small yes or
 *  no questions in one line, which is what six switch rows would have
 *  said in six times the height.
 *
 *  `aria-pressed` carries the state.  On, it is the chip's own shape on
 *  the second surface in the ink; off, hollow, outlined in the line
 *  colour in the third ink, the shape `ChipButton` takes for a thing that
 *  does not exist yet.  Fill against outline is a shape difference, so no
 *  glyph is added to say which is which. */
export type ChipToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
};

export function ChipToggle({ pressed, onChange, className, type = "button", onClick, children, ...rest }: ChipToggleProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={`nx-chip nx-chip-toggle${className ? ` ${className}` : ""}`}
      onClick={(event) => {
        onChange(!pressed);
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A switch: on or off, and nothing in between.
 *
 *  `role="switch"` with `aria-checked`, named by the label text a caller
 *  puts beside it through `aria-labelledby` or `aria-label`.  The track
 *  takes the hint colour when on, because on is the state "a switch that
 *  is on" the palette reserves that colour for. */
export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function Switch({ checked, onChange, className, type = "button", onClick, ...rest }: SwitchProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      className={`nx-switch${className ? ` ${className}` : ""}`}
      onClick={(event) => {
        onChange(!checked);
        onClick?.(event);
      }}
      {...rest}
    >
      <span className="nx-switch-knob" />
    </button>
  );
}

/** A choice among a few, all visible.
 *
 *  A group of pressed buttons, not a tablist: nothing is associated with
 *  any of them and the arrow keys do not move between them, so claiming
 *  the role would tell a screen reader something untrue.  Each option
 *  carries `aria-pressed` and, when given, its own testid, which is how
 *  the appearance specs reach `theme-light` and `editor-theme-white`. */
export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  testid?: string;
  title?: string;
  /** A name for the accessibility tree when the label alone is ambiguous:
   *  "Heavier" means one thing beside "Editor weight" and nothing on its
   *  own. */
  ariaLabel?: string;
};

export type SegmentedProps<T extends string> = {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  testid?: string;
  className?: string;
  /** `sm` is the strip's: 20 px segments with no tray, the chosen one on
   *  the wash, as the direction page draws Scroll and Page under the
   *  preview.  The default sits on its own tray at 24 px. */
  size?: "md" | "sm";
  /** `drawer` is for a control on the second surface, where the tray
   *  would vanish: the tray takes the first surface and the chosen
   *  segment the wash, as the page draws the History drawer's switch. */
  tone?: "surface" | "drawer";
};

export function Segmented<T extends string>({ value, options, onChange, label, testid, className, size = "md", tone = "surface" }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} data-testid={testid} data-size={size} data-tone={tone} className={`nx-segmented${className ? ` ${className}` : ""}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-testid={option.testid}
          title={option.title}
          aria-label={option.ariaLabel}
          className="nx-segment"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A heading inside a pane, a drawer or a sheet: the kit's `t-ui-lg`,
 *  Source Sans 3 at 15 on 20 and 600, as a real heading element so a
 *  spec and a screen reader both find it. */
export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  level?: 1 | 2 | 3;
  display?: boolean;
};

export function Heading({ level = 2, display = false, className, children, ...rest }: HeadingProps) {
  const Tag = (`h${level}`) as "h1" | "h2" | "h3";
  return (
    <Tag className={`${display ? "t-display" : "t-ui-lg"} text-ink${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Words a screen reader hears when something changes out of sight: a
 *  build ending, an update wanting attention. Always mounted and empty
 *  until there is news, since a region that appears with its content is
 *  not announced by every reader; polite, since none of it interrupts.
 *  Nothing is drawn (Q-052). */
export function Announce({ text, testid }: { text: string; testid?: string }) {
  return (
    <span className="sr-only" role="status" aria-live="polite" data-testid={testid}>
      {text}
    </span>
  );
}

/** What a drawer or a list says when there is nothing in it: one
 *  sentence saying what to do next, and, where there is one, one action.
 *  Never an illustration, never a heading of its own. */
export function Empty({ children, action, className, ...rest }: HTMLAttributes<HTMLDivElement> & { action?: ReactNode }) {
  return (
    <div className={`nx-empty${className ? ` ${className}` : ""}`} {...rest}>
      <p>{children}</p>
      {action ? <div className="nx-empty-action">{action}</div> : null}
    </div>
  );
}

/** A key, as a glyph in a frame.  Several keys are several `Kbd`s with
 *  nothing between them, so a text assertion on their parent reads the
 *  chord as one string. */
export function Kbd({ children, className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd className={`nx-kbd${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </kbd>
  );
}

/** A row of a list: a drawer's file, a version, a search hit, a project.
 *
 *  30 px in a drawer, 32 in a list, on the row height token; a leading
 *  icon slot, the label, and a trailing slot whose contents appear on
 *  hover and focus-within and always under a coarse pointer, so a finger
 *  is never denied what a mouse is shown.  `selected` draws the wash.  The
 *  element is whatever the caller needs it to be, because a tree row is
 *  `role="treeitem"` and a version row is a div with a click, and neither
 *  may become a button with a button inside it. */
export type RowProps = HTMLAttributes<HTMLDivElement> & {
  selected?: boolean;
  size?: "sm" | "md";
  leading?: ReactNode;
  trailing?: ReactNode;
  trailingAlways?: boolean;
  indent?: number;
  /** A second line under the label, in the meta role and the third ink,
   *  for the one fact a row needs that its label cannot carry: the
   *  Deleted drawer's "A collaborator deleted it". The row grows to hold
   *  it; a row without one keeps its height. */
  note?: ReactNode;
};

export const Row = forwardRef<HTMLDivElement, RowProps>(function Row(
  { selected = false, size = "sm", leading, trailing, trailingAlways = false, indent = 0, note, className, children, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-selected={selected || undefined}
      data-size={size}
      data-note={note ? true : undefined}
      className={`nx-row${className ? ` ${className}` : ""}`}
      style={indent ? { paddingLeft: 8 + indent, ...style } : style}
      {...rest}
    >
      {leading}
      <span className="nx-row-label">{children}</span>
      {trailing !== undefined && trailing !== null ? (
        <span className={`nx-row-trailing${trailingAlways ? " nx-row-trailing-always" : ""}`}>{trailing}</span>
      ) : null}
      {note ? <span className="nx-row-note t-meta">{note}</span> : null}
    </div>
  );
});

/** A label and a control that belong together, for a settings row. */
export function useLabelId(): string {
  return useId();
}
