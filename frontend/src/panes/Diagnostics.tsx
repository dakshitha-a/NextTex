import { useMemo, useState } from "react";
import { uiScale } from "../viewport";
import { useStore } from "../store";

function summarise(rows: { severity: string }[]): string {
  const errors = rows.filter((row) => row.severity === "error").length;
  const warnings = rows.length - errors;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(", ") || "Nothing to fix";
}

export default function Diagnostics({
  height,
  onJump,
  onFix,
  onClose,
  onResize,
}: {
  height: number;
  onJump: (file: string, line: number) => void;
  onFix: (text: string) => void;
  onClose: () => void;
  onResize: (height: number) => void;
}) {
  const compile = useStore((s) => s.diagnostics);
  // Written by the server with no model involved: which error is the cause
  // and which are its consequences.  A writer running NextTex without an
  // agent still gets told where to start.
  const summary = useStore((s) => s.compile?.summary);
  const lint = useStore((s) => s.lint);
  const activePath = useStore((s) => s.activePath);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const rows = useMemo(() => {
    const all = [...compile, ...lint];
    // Errors first, then by file and line: the first row is always the one
    // most worth reading.
    return all.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      return (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0);
    });
  }, [compile, lint]);

  if (height === 0) return null;

  return (
    <div
      className="flex shrink-0 flex-col border-t border-line bg-surface"
      style={{ height }}
    >
      <div
        className="h-[3px] shrink-0 cursor-row-resize"
        onPointerDown={(event) => {
          event.preventDefault();
          const startY = event.clientY;
          const startHeight = height;
          const move = (moveEvent: PointerEvent) => {
            // Pointer travel is in viewport pixels; the height is not.
            const next =
              startHeight + (startY - moveEvent.clientY) / uiScale();
            onResize(Math.min(Math.max(next, 84), 320));
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      {/* The whole bar closes the drawer, the way the preview's and the
          agent's headers fold their panes. The button stays: it is what
          says the bar is a control, and it is what a keyboard reaches. */}
      <div
        className="flex h-[26px] shrink-0 cursor-pointer items-center justify-between border-b border-line px-[10px] transition-colors duration-[90ms] hover:bg-surface-2"
        data-testid="diagnostics-header"
        title="Close the list"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          onClose();
        }}
      >
        {/* Named, not counted: "3 findings" tells a writer nothing, and
            severity carried only by a coloured bar is severity carried by
            colour alone. */}
        <span className="t-micro text-ink-2">
          {summarise(rows)}
        </span>
        <button className="t-micro text-ink-3 hover:text-ink" onClick={onClose}>
          Close
        </button>
      </div>
      {summary ? (
        <div
          className="shrink-0 border-b border-line bg-surface-2 px-3 py-2"
          data-testid="build-summary"
        >
          <p className="t-ui text-ink">
            <span className="text-error">Start here — </span>
            {summary.headline}
            {summary.file ? (
              <button
                className="quiet t-micro ml-2"
                onClick={() =>
                  summary.file && onJump(summary.file, summary.line ?? 1)
                }
              >
                {summary.file.split("/").pop()}
                {summary.line ? `:${summary.line}` : ""}
              </button>
            ) : null}
          </p>
          {/* Deliberately not `summary.detail`: it is the same sentence the
              row's own expansion shows, and repeating it here cost the
              list the room it needed to show the row. */}
          {summary.fix ? (
            <p className="t-meta mt-1 text-ink-2">
              <span className="text-ink-3">What to do — </span>
              {summary.fix}
            </p>
          ) : null}
          {summary.note ? (
            <p className="t-micro mt-1 text-ink-3">{summary.note}</p>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((item, index) => {
          const bar = item.severity === "error" ? "bg-error" : "bg-warn";
          const open = expanded === index;
          return (
            <div key={index} className="group">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                className={`relative flex h-[28px] cursor-pointer items-center hover:bg-surface-2 ${
                  selected === index ? "bg-surface-2" : ""
                }`}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelected(index);
                  setExpanded(open ? null : index);
                  if (item.file && item.line) onJump(item.file, item.line);
                }}
                onClick={() => {
                  setSelected(index);
                  setExpanded(open ? null : index);
                  if (item.file && item.line) onJump(item.file, item.line);
                }}
              >
                <span className={`absolute left-0 h-full w-[3px] ${bar}`} />
                {selected === index ? (
                  <span className="absolute left-[3px] h-full w-[2px] bg-pen" />
                ) : null}
                <span className="ml-[6px] w-2 shrink-0 text-ink-3 opacity-0 group-hover:opacity-100">
                  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
                    <path
                      d={open ? "M0 2 L4 6 L8 2" : "M2 0 L6 4 L2 8"}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                  </svg>
                </span>
                <span className="t-code-sm w-[40px] shrink-0 pr-1 text-right text-ink-3 tnum">
                  {item.line ?? ""}
                </span>
                <span className="t-meta ml-2 min-w-0 flex-1 truncate text-ink">
                  {item.message}
                </span>
                {item.file && item.file !== activePath ? (
                  <span className="t-micro shrink-0 px-2 text-ink-3">
                    {item.file.split("/").pop()}
                  </span>
                ) : null}
                <button
                  className="ghost-button mr-2 h-[22px] shrink-0 px-2 t-micro opacity-0 focus:opacity-100 group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFix(
                      `Fix: ${item.message}` +
                        (item.file ? ` (${item.file}:${item.line ?? 0})` : ""),
                    );
                  }}
                >
                  Fix
                </button>
              </div>
              {open && item.explain ? (
                <div className="ml-[40px] border-l border-line bg-surface-2 px-3 py-2">
                  <p className="t-ui text-ink">{item.explain.title}</p>
                  <p className="t-meta mt-1 text-ink-2">{item.explain.detail}</p>
                  <p className="t-meta mt-2 text-ink-2">
                    <span className="text-ink-3">What to do — </span>
                    {item.explain.fix}
                  </p>
                </div>
              ) : null}
              {open && item.context ? (
                <pre className="t-code-sm ml-[40px] max-h-[54px] overflow-auto border-l border-line bg-surface-2 px-2 py-1 text-ink-2">
                  {item.context}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
