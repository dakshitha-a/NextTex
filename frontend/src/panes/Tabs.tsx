import { useEffect, useMemo, useRef, useState } from "react";
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

  const errorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of diagnostics) {
      if (item.severity !== "error" || !item.file) continue;
      counts.set(item.file, (counts.get(item.file) ?? 0) + 1);
    }
    return counts;
  }, [diagnostics]);

  const strip = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState(0);

  // How many tabs are scrolled out of sight, so the overflow says so
  // instead of swallowing them silently.
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => {
      const children = Array.from(element.children) as HTMLElement[];
      const right = element.scrollLeft + element.clientWidth;
      setHidden(
        children.filter(
          (child) =>
            child.dataset.tab &&
            (child.offsetLeft + child.offsetWidth > right + 1 ||
              child.offsetLeft < element.scrollLeft - 1),
        ).length,
      );
    };
    measure();
    element.addEventListener("scroll", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [tabs.length]);

  return (
    <div className="relative flex h-[32px] shrink-0">
      {/* A labelled group of buttons rather than an ARIA tablist.  The tab
          pattern promises arrow-key navigation between tabs and a panel
          associated with each one, and this strip has neither -- claiming
          the role would tell a screen reader something untrue. */}
      <div
        ref={strip}
        role="group"
        aria-label="Open files"
        className="no-scrollbar flex h-[32px] min-w-0 flex-1 overflow-x-auto bg-surface-2"
      >
      {tabs.map((tab) => {
        const name = tab.path.split("/").pop() ?? tab.path;
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : "";
        const active = tab.path === activePath;
        const errors = errorCounts.get(tab.path) ?? 0;
        return (
          // The tab and its close button are siblings rather than nested:
          // a control inside another control is announced as one thing and
          // reached as two, and there is no way to say which is which.
          <div
            key={tab.path}
            data-tab="1"
            data-path={tab.path}
            data-dirty={tab.dirty ? "1" : "0"}
            className={[
              "relative flex min-w-[96px] max-w-[200px] shrink-0 items-center gap-2 border-r border-line pr-[10px]",
              active
                ? "bg-surface"
                : "border-b border-line hover:bg-surface-3",
            ].join(" ")}
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
            <button
              aria-current={active ? "true" : undefined}
              title={
                errors
                  ? `${tab.path} — ${errors} ${errors === 1 ? "error" : "errors"}`
                  : tab.path
              }
              className="t-meta flex min-w-0 flex-1 cursor-pointer items-center truncate pl-[10px] text-left"
              onClick={() => onSelect(tab.path)}
            >
              <span className="text-ink">{middleTruncate(stem, 18)}</span>
              <span className={errors ? "text-error" : "text-ink-3"}>{extension}</span>
              {errors ? (
                // A number, not a coloured dot: the count says the same
                // thing without depending on being able to see the colour.
                <span
                  className="t-micro tnum ml-[6px] text-error"
                  title={`${errors} ${errors === 1 ? "error" : "errors"} in this file`}
                >
                  {errors}
                </span>
              ) : null}
            </button>
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
      {hidden > 0 ? (
        <button
          className="flex w-6 shrink-0 items-center justify-center border-b border-l border-line bg-surface-2 t-micro text-ink-3 hover:text-ink"
          title={`${hidden} more open`}
          onClick={() => {
            const element = strip.current;
            if (element) element.scrollLeft = element.scrollWidth;
          }}
        >
          {hidden}
        </button>
      ) : null}
    </div>
  );
}
