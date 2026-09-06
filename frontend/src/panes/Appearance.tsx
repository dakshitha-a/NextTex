import { useRef, useState } from "react";
import { useDismiss } from "../useDismiss";
import {
  DEFAULTS,
  EDITOR_SIZES,
  SCALES,
  applyAppearance,
  isDefault,
  step,
  storedAppearance,
  type Appearance as Settings,
} from "../appearance";

/** Theme, interface size and editor text size, in one card.
 *
 *  The theme used to be a one-click toggle in the rail header.  Three
 *  related controls will not fit in a 32px row at the narrowest rail width,
 *  so they collapse into a popover and the theme costs a second click.  The
 *  trigger reads `Aa` rather than the old sun and moon, because that glyph
 *  already means "switch the theme" and making it open a menu instead would
 *  break a meaning the app has taught.
 *
 *  The component owns the setting rather than taking it as a prop: there is
 *  exactly one appearance, it is stamped on the document, and threading it
 *  through four mount points would be four chances to disagree.
 */
export default function Appearance({ align = "right" }: { align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => storedAppearance());
  const card = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useDismiss(card, open, close);

  const change = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    applyAppearance(next);
  };

  // Which way the card opens is the mount point's business: in the rail it
  // sits near the left edge of a pane narrower than the card, so anchoring
  // it to the trigger's right edge would hang it off the window.
  return (
    <div className="relative flex items-center">
      <button
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="appearance"
        title="Appearance"
        aria-label="Appearance"
        className="quiet flex h-[26px] w-[26px] items-center justify-center rounded-[3px] hover:bg-surface-3"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="t-micro">Aa</span>
      </button>

      {open ? (
        <div
          ref={card}
          role="dialog"
          aria-labelledby="appearance-heading"
          className={`nx-arrive absolute top-[30px] z-40 w-[248px] rounded-[5px] border border-line bg-surface shadow-float ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div id="appearance-heading" className="t-ui px-[10px] pt-2 pb-1 text-ink">
            Appearance
          </div>

          <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
            <span className="t-meta text-ink-2">Theme</span>
            <div
              role="group"
              aria-label="Theme"
              className="flex shrink-0 overflow-hidden rounded-[3px] border border-line"
            >
              {(["light", "dark"] as const).map((option) => (
                <button
                  key={option}
                  aria-pressed={settings.theme === option}
                  className={`t-micro px-2 py-[3px] transition-colors duration-[90ms] ${
                    settings.theme === option
                      ? "bg-surface-3 text-ink"
                      : "text-ink-3 hover:text-ink"
                  }`}
                  onClick={() => change({ theme: option })}
                >
                  {option === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>

          <SizeRow
            label="Interface"
            what="interface"
            value={settings.scale}
            steps={SCALES}
            display={`${settings.scale}%`}
            onChange={(scale) => change({ scale })}
          />
          <SizeRow
            label="Editor text"
            what="editor text"
            value={settings.editor}
            steps={EDITOR_SIZES}
            display={`${settings.editor}px`}
            onChange={(editor) => change({ editor })}
          />

          <div className="flex h-[32px] items-center justify-end border-t border-line px-[10px]">
            <button
              className="quiet t-micro"
              disabled={isDefault(settings)}
              onClick={() => {
                setSettings(DEFAULTS);
                applyAppearance(DEFAULTS);
              }}
            >
              Reset to defaults
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The stepper, twice.  Deliberately the same shape as the PDF pane's zoom
 *  control, which is the answer this app already gives to "make this
 *  bigger". */
function SizeRow({
  label,
  what,
  value,
  steps,
  display,
  onChange,
}: {
  label: string;
  what: string;
  value: number;
  steps: number[];
  display: string;
  onChange: (value: number) => void;
}) {
  const first = value <= steps[0];
  const last = value >= steps[steps.length - 1];
  return (
    <div className="flex h-[30px] items-center justify-between border-t border-line px-[10px]">
      <span className="t-meta text-ink-2">{label}</span>
      <div className="flex shrink-0 items-center">
        <button
          className="nx-hover t-ui px-[6px] text-ink-2 hover:text-ink disabled:text-ink-3 disabled:opacity-40"
          disabled={first}
          aria-label={`Smaller ${what}`}
          onClick={() => onChange(step(value, steps, -1))}
        >
          −
        </button>
        <span className="t-micro tnum w-[46px] text-center text-ink-3">{display}</span>
        <button
          className="nx-hover t-ui px-[6px] text-ink-2 hover:text-ink disabled:text-ink-3 disabled:opacity-40"
          disabled={last}
          aria-label={`Larger ${what}`}
          onClick={() => onChange(step(value, steps, 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}
