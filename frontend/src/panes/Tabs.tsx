import { useMemo } from "react";
import { useStore } from "../store";

function middleTruncate(stem: string, limit: number): string {
  if (stem.length <= limit) return stem;
  const head = Math.ceil((limit - 1) / 2);
  const tail = Math.floor((limit - 1) / 2);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}`;
}

export default function Tabs({
  onSelect,
  onClose,
}: {
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const diagnostics = useStore((s) => s.diagnostics);

  const withErrors = useMemo(
    () =>
      new Set(
        diagnostics
          .filter((item) => item.severity === "error" && item.file)
          .map((item) => item.file as string),
      ),
    [diagnostics],
  );

  return (
    <div className="no-scrollbar flex h-[32px] shrink-0 overflow-x-auto bg-surface-2">
      {tabs.map((tab) => {
        const name = tab.path.split("/").pop() ?? tab.path;
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : "";
        const active = tab.path === activePath;
        const bad = withErrors.has(tab.path);
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            title={tab.path}
            className={[
              "relative flex min-w-[96px] max-w-[200px] shrink-0 cursor-default items-center gap-2 border-r border-line px-[10px]",
              active ? "bg-surface" : "border-b border-line",
            ].join(" ")}
            onClick={() => onSelect(tab.path)}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(tab.path);
              }
            }}
          >
            {active ? (
              <span className="absolute left-0 top-0 h-[2px] w-full bg-pen" />
            ) : null}
            <span className="t-meta min-w-0 flex-1 truncate">
              <span className="text-ink">{middleTruncate(stem, 18)}</span>
              <span className={bad ? "text-error" : "text-ink-3"}>{extension}</span>
              {bad ? (
                <span className="ml-1 inline-block h-[3px] w-[3px] translate-y-[-2px] rounded-full bg-error" />
              ) : null}
            </span>
            <button
              className="group flex h-4 w-4 shrink-0 items-center justify-center text-ink-3 hover:text-ink"
              aria-label={`Close ${name}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.path);
              }}
            >
              {tab.dirty ? (
                <>
                  <span className="block h-[5px] w-[5px] rounded-full border border-ink-2 group-hover:hidden" />
                  <span className="hidden group-hover:block">×</span>
                </>
              ) : (
                "×"
              )}
            </button>
          </div>
        );
      })}
      <div className="flex-1 border-b border-line" />
    </div>
  );
}
