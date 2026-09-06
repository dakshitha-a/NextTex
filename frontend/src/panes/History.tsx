import { useEffect, useState } from "react";
import api, { type Version } from "../api";
import { get, refreshHistory, set, useStore } from "../store";
import { Chevron } from "../App";

/** What this file used to say.
 *
 *  Versions are listed newest first and grouped by day, because "some time
 *  on Tuesday" is how people remember losing a paragraph. */
export default function History({
  onView,
  onClose,
}: {
  onView: (sha: string | null) => void;
  onClose: () => void;
}) {
  const versions = useStore((s) => s.history);
  const viewing = useStore((s) => s.viewing);
  const activePath = useStore((s) => s.activePath);
  const projectId = useStore((s) => s.projectId);
  const compile = useStore((s) => s.compile);
  const [labelling, setLabelling] = useState<string | null>(null);

  useEffect(() => {
    if (projectId && activePath) refreshHistory(projectId, activePath);
  }, [projectId, activePath, compile]);

  const name = activePath?.split("/").pop() ?? "";

  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-[264px] flex-col border-l border-line bg-surface shadow-[0_0_8px_rgba(0,0,0,0.25)]">
      <div
        className="flex h-[32px] shrink-0 cursor-pointer items-center justify-between border-b border-line bg-surface-2 px-[10px] transition-colors duration-[90ms] hover:bg-surface-3"
        title="Close the history"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          onClose();
        }}
      >
        <span className="t-ui-lg truncate font-serif">History</span>
        <button className="quiet flex h-[26px] w-[22px] items-center justify-center rounded-[3px]" aria-label="Close the history" onClick={onClose}>
          <Chevron direction="right" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {versions.length === 0 ? (
          <p className="t-meta p-3 text-ink-3">
            Nothing yet for {name || "this file"}. Versions are kept from the
            moment you first change it.
          </p>
        ) : null}
        {versions.map((version, index) => {
          const day = dayOf(version.at);
          const first = index === 0 || dayOf(versions[index - 1].at) !== day;
          const selected = viewing?.sha === version.sha;
          return (
            <div key={`${version.sha}-${version.at}`}>
              {first ? (
                <div className="t-micro sticky top-0 bg-surface px-[10px] py-1 text-ink-3">
                  {day}
                </div>
              ) : null}
              <div
                role="button"
                tabIndex={0}
                className={`group relative flex cursor-pointer flex-col gap-[2px] px-[10px] py-[6px] ${
                  selected ? "bg-surface-2" : "hover:bg-surface-2"
                }`}
                onClick={() => onView(selected ? null : version.sha)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onView(selected ? null : version.sha);
                  }
                }}
              >
                {selected ? (
                  <span className="absolute left-0 top-0 h-full w-[2px] bg-pen" />
                ) : null}
                <div className="flex items-baseline gap-2">
                  <span className="t-micro tnum text-ink">{timeOf(version.at)}</span>
                  <span
                    className={`t-micro ${
                      version.by === "claude" ? "text-pen" : "text-ink-3"
                    }`}
                  >
                    {version.by === "claude" ? "Claude" : "you"}
                  </span>
                  <span className="flex-1" />
                  {/* The naming control takes the size's place on hover
                      rather than sitting on top of it. */}
                  <span className="t-micro tnum text-ink-3 group-hover:hidden">
                    {size(version.bytes)}
                  </span>
                  <button
                    className="quiet t-micro hidden group-hover:block"
                    title="Name this version so it is never thinned away"
                    onClick={(event) => {
                      event.stopPropagation();
                      setLabelling(version.sha);
                    }}
                  >
                    {version.label ? "Rename" : "Name it"}
                  </button>
                </div>
                {version.label ? (
                  <span className="t-meta text-ink">{version.label}</span>
                ) : version.why ? (
                  <span className="t-micro truncate text-ink-2">{version.why}</span>
                ) : null}
                {labelling === version.sha ? (
                  <input
                    autoFocus
                    defaultValue={version.label ?? ""}
                    placeholder="Name this version"
                    className="t-micro mt-1 w-full border-b border-pen bg-transparent outline-none"
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => setLabelling(null)}
                    onKeyDown={async (event) => {
                      if (event.key === "Escape") setLabelling(null);
                      if (event.key !== "Enter") return;
                      const value = event.currentTarget.value.trim();
                      setLabelling(null);
                      const id = get().projectId;
                      if (!id || !activePath) return;
                      await api.labelVersion(id, activePath, version.sha, value);
                      refreshHistory(id, activePath);
                    }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The strip that says you are not looking at now. */
export function ViewingBanner({
  version,
  onRestore,
  onBack,
  onToggleChanges,
  showingChanges,
}: {
  version: Version;
  onRestore: () => void;
  onBack: () => void;
  onToggleChanges: () => void;
  showingChanges: boolean;
}) {
  return (
    <div
      className={`nx-arrive flex h-[26px] shrink-0 items-center gap-3 border-b border-line px-[10px] ${
        version.by === "claude" ? "bg-pen-wash" : "bg-surface-2"
      }`}
    >
      <span className="t-micro text-ink">
        Viewing {timeOf(version.at)} · {version.by === "claude" ? "Claude" : "you"}
      </span>
      {version.label || version.why ? (
        <span className="t-micro min-w-0 flex-1 truncate text-ink-2">
          {version.label || version.why}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      <button className="quiet t-micro" onClick={onToggleChanges}>
        {showingChanges ? "Hide changes" : "Show changes"}
      </button>
      <button className="quiet t-micro" onClick={onRestore}>
        Restore this
      </button>
      <button className="quiet t-micro" onClick={onBack}>
        Back to now
      </button>
    </div>
  );
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayOf(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
