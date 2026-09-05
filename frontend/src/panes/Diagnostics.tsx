import { useMemo, useState } from "react";
import { useStore } from "../store";

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
            const next = startHeight + (startY - moveEvent.clientY);
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
      <div className="flex h-[26px] shrink-0 items-center justify-between border-b border-line px-[10px]">
        <span className="t-micro text-ink-2">
          {rows.length} {rows.length === 1 ? "finding" : "findings"}
        </span>
        <button className="t-micro text-ink-3 hover:text-ink" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((item, index) => {
          const bar = item.severity === "error" ? "bg-error" : "bg-warn";
          const open = expanded === index;
          return (
            <div key={index} className="group">
              <div
                className={`relative flex h-[28px] cursor-default items-center hover:bg-surface-2 ${
                  selected === index ? "bg-surface-2" : ""
                }`}
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
                  className="mr-2 hidden h-[22px] shrink-0 rounded-[3px] border border-line px-2 t-micro group-hover:block"
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
