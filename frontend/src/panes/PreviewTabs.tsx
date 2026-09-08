import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useDismiss } from "../useDismiss";

/** The documents being previewed, as tabs.
 *
 *  Deliberately the same object as the editor's tab strip: same height, same
 *  2px accent on the one in front, same middle-click to close. They sit one
 *  above the other on a wide screen and reading them as two different kinds
 *  of thing would be work the writer should not have to do.
 *
 *  What is different is that one tab cannot be closed. The main document is
 *  what the project is, and a preview strip with nothing in it would be a
 *  pane with no way to get anything back into it.
 */

const stem = (path: string) => path.split("/").pop() ?? path;

function middleTruncate(name: string, limit: number): string {
  if (name.length <= limit) return name;
  const head = Math.ceil((limit - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (limit - 1 - head))}`;
}

export default function PreviewTabs({
  onSelect,
  onClose,
  onAdd,
}: {
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: (path: string) => void;
}) {
  const previews = useStore((s) => s.previews);
  const active = useStore((s) => s.activePreview);
  const candidates = useStore((s) => s.candidates);
  const builds = useStore((s) => s.builds);
  const activePath = useStore((s) => s.activePath);

  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  const plus = useRef<HTMLButtonElement | null>(null);
  useDismiss(menu, open, () => setOpen(false), plus);

  // Nothing to draw for a project with one document: a strip of one tab is
  // a label pretending to be a control.
  const solo = previews.length < 2;

  useEffect(() => {
    if (!candidates.length) setOpen(false);
  }, [candidates.length]);

  return (
    <div className="flex min-w-0 flex-1 items-center">
      {solo ? (
        <span className="t-ui-lg shrink-0 select-none pl-1 font-serif text-ink">Preview</span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          {previews.map((path) => {
            const showing = path === active;
            const build = builds[path];
            return (
              <div
                key={path}
                data-preview-tab="1"
                data-path={path}
                className={[
                  "relative flex h-[32px] min-w-[96px] max-w-[200px] shrink-0 items-center",
                  "gap-2 border-r border-line pr-[10px]",
                  showing
                    ? "bg-surface"
                    : "border-b border-line hover:bg-surface-3",
                ].join(" ")}
                onMouseDown={(event) => {
                  if (event.button === 1 && previews[0] !== path) {
                    event.preventDefault();
                    onClose(path);
                  }
                }}
              >
                {showing ? (
                  <span className="absolute left-0 top-0 h-[2px] w-full bg-pen" />
                ) : null}
                <button
                  aria-current={showing ? "true" : undefined}
                  title={path}
                  data-testid={`preview-tab-${path}`}
                  className="t-meta flex min-w-0 flex-1 items-center truncate pl-[10px] text-left"
                  onClick={() => onSelect(path)}
                >
                  <span className={showing ? "text-ink" : "text-ink-2"}>
                    {middleTruncate(stem(path).replace(/\.(tex|ltx)$/i, ""), 18)}
                  </span>
                  {/* Building, or behind the source.  Without this a
                      background document gives no sign it is out of date
                      until you switch to it and find an old page. */}
                  {build?.compiling ? (
                    <span className="ml-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-hint" />
                  ) : build?.stale ? (
                    <span className="ml-[5px] h-[5px] w-[5px] shrink-0 rounded-full border border-ink-3" />
                  ) : null}
                </button>
                {/* The main document has no close button rather than a
                    disabled one: a control that is always refused is worse
                    than no control. */}
                {previews[0] === path ? null : (
                  <button
                    className="quiet flex h-4 w-4 shrink-0 items-center justify-center"
                    aria-label={`Stop previewing ${stem(path)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(path);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {candidates.length ? (
        <div className="relative shrink-0">
          <button
            ref={plus}
            className="quiet t-meta flex h-[24px] w-[24px] items-center justify-center"
            aria-label="Preview another document"
            aria-expanded={open}
            data-testid="add-preview"
            onClick={() => setOpen((value) => !value)}
          >
            +
            {/* The nudge.  A quiet mark when the file being edited is one of
                the documents that could be previewed and is not -- which is
                exactly the moment somebody wants this button and has no
                reason to know it is here. */}
            {activePath && candidates.includes(activePath) ? (
              <span className="absolute right-[3px] top-[3px] h-[4px] w-[4px] rounded-full bg-hint" />
            ) : null}
          </button>
          {open ? (
            <div
              ref={menu}
              role="menu"
              data-testid="preview-menu"
              className="absolute right-0 top-[24px] z-40 w-[200px] rounded-[3px] border border-line bg-surface-2 py-1 shadow-[var(--float)]"
            >
              {candidates.map((path) => (
                <button
                  key={path}
                  role="menuitem"
                  title={path}
                  className="t-ui block w-full truncate px-3 py-[3px] text-left text-ink-2 hover:bg-surface-3 hover:text-ink"
                  onClick={() => {
                    setOpen(false);
                    onAdd(path);
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
