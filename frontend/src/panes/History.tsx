import { useEffect, useState } from "react";
import api, { startDownload, type Version } from "../api";
import { get, refreshHistory, set, useStore } from "../store";
import { Chevron } from "../App";
import { isRenderable } from "./FileView";

/** What this file used to say.
 *
 *  Versions are listed newest first and grouped by day, because "some time
 *  on Tuesday" is how people remember losing a paragraph. */
export default function History({
  onView,
  onClose,
  docked,
}: {
  onView: (sha: string | null) => void;
  onClose: () => void;
  /** Docked beside the editor when there is room; over it when there is not. */
  docked: boolean;
}) {
  const versions = useStore((s) => s.history);
  const viewing = useStore((s) => s.viewing);
  const activePath = useStore((s) => s.activePath);
  const projectId = useStore((s) => s.projectId);
  const compile = useStore((s) => s.compile);
  const [labelling, setLabelling] = useState<string | null>(null);
  // A figure has no text to read, so selecting one of its versions opens
  // it in place here instead of parking the editor in a viewing mode that
  // would have nothing to show and nothing to diff.
  const [opened, setOpened] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const binary = Boolean(activePath) && !isText(activePath!);
  const blobUrl = (sha: string, download = false) =>
    projectId && activePath
      ? `/api/projects/${projectId}/history/blob?path=${encodeURIComponent(
          activePath,
        )}&sha=${sha}&${download ? "download=1" : "raw=1"}`
      : "";

  useEffect(() => {
    if (projectId && activePath) refreshHistory(projectId, activePath);
  }, [projectId, activePath, compile]);

  const name = activePath?.split("/").pop() ?? "";

  const choose = (sha: string, selected: boolean) => {
    if (binary) {
      // No viewing mode: there is no text to lock, nothing to diff, and no
      // banner that could say anything true about a PNG.
      setConfirming(null);
      setOpened((current) => (current === sha ? null : sha));
      return;
    }
    onView(selected ? null : sha);
  };

  const restore = async (sha: string) => {
    const projectId = get().projectId;
    if (!projectId || !activePath) return;
    try {
      await api.restoreVersion(projectId, activePath, sha);
      setConfirming(null);
      setOpened(null);
      refreshHistory(projectId, activePath);
      // The pane showing the file is keyed on this, so the restored figure
      // appears rather than the browser's cached copy of the old one.
      set({ pdfStamp: Date.now() });
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  return (
    <div
      className={
        docked
          ? "nx-arrive flex h-full w-[264px] shrink-0 flex-col border-l border-line bg-surface-2"
          : "nx-arrive absolute right-0 top-0 z-20 flex h-full w-[264px] flex-col border-l border-line bg-surface-2 shadow-float"
      }
    >
      <div
        className="flex h-[32px] shrink-0 cursor-pointer items-center justify-between border-b border-line bg-surface-3 px-[10px] transition-colors duration-[90ms] hover:bg-surface"
        title="Close the history"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          onClose();
        }}
      >
        <span className="min-w-0">
          <span className="t-ui-lg font-serif">History</span>
          {name ? (
            <span className="t-meta ml-2 truncate text-ink-3">{name}</span>
          ) : null}
        </span>
        <button className="quiet flex h-[26px] w-[22px] items-center justify-center rounded-[3px]" aria-label="Close the history" onClick={onClose}>
          <Chevron direction="right" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {versions.length === 0 ? (
          <p className="t-meta p-3 text-ink-3">
            {binary
              ? `Nothing yet for ${name}. Versions are kept from the moment it is first replaced.`
              : `Nothing yet for ${name || "this file"}. Versions are kept from the moment you first change it.`}
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
                data-testid="version"
                data-sha={version.sha}
                data-by={version.by}
                className={`group relative flex cursor-pointer flex-col gap-[2px] px-[10px] py-[6px] ${
                  selected ? "bg-surface-2" : "hover:bg-surface-2"
                }`}
                onClick={() => choose(version.sha, selected)}
                onKeyDown={(event) => {
                  // Only keys aimed at the row itself.  The naming input is
                  // a child of it, so without this every space typed into a
                  // name was swallowed by the row's own Space handler --
                  // and toggled the version being viewed on the way past.
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(version.sha, selected);
                  }
                }}
              >
                {selected ? (
                  <span className="absolute left-0 top-0 h-full w-[2px] bg-pen" />
                ) : null}
                <div className="flex items-baseline gap-2">
                  {binary ? (
                    <span
                      aria-hidden
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center self-center overflow-hidden rounded-[3px] bg-surface-3"
                    >
                      {isRenderable(activePath ?? "") ? (
                        <img
                          src={blobUrl(version.sha)}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="nx-mono-11 text-ink-3">
                          {(activePath ?? "").split(".").pop()?.slice(0, 3)}
                        </span>
                      )}
                    </span>
                  ) : null}
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
                {binary && opened === version.sha ? (
                  <div className="mt-2" data-testid="version-open">
                    {isRenderable(activePath ?? "") ? (
                      <img
                        src={blobUrl(version.sha)}
                        alt={`${name} as it was at ${timeOf(version.at)}`}
                        className="max-h-[180px] max-w-[244px] rounded-[3px] bg-surface-3 object-contain p-2"
                      />
                    ) : null}
                    <div className="mt-2 flex items-center gap-3">
                      {confirming === version.sha ? (
                        <>
                          <span className="t-micro text-ink-2">
                            Replace the file with this?
                          </span>
                          <button
                            className="quiet t-micro"
                            data-tone="danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              void restore(version.sha);
                            }}
                          >
                            Restore
                          </button>
                          <button
                            className="quiet t-micro"
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirming(null);
                            }}
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          className="quiet t-micro"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirming(version.sha);
                          }}
                        >
                          Restore this
                        </button>
                      )}
                      <button
                        className="quiet t-micro"
                        onClick={(event) => {
                          event.stopPropagation();
                          startDownload(blobUrl(version.sha, true));
                        }}
                      >
                        Download
                      </button>
                    </div>
                  </div>
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

/** The strip that says you are not looking at now.
 *
 *  It has to be unmistakably not the tab bar: read-only, historical text
 *  in the editor is the single most consequential state this app has, and
 *  announcing it in the same fill as more toolbar is how somebody types
 *  into last Tuesday and wonders why nothing happens. */
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
  const [confirming, setConfirming] = useState(false);

  // Escape leaves, as it does everywhere else in the app.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === "TEXTAREA" || active?.tagName === "INPUT") return;
      onBack();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onBack]);

  return (
    <div
      className={`nx-arrive flex h-[26px] shrink-0 items-center gap-3 border-b border-line px-[10px] ${
        version.by === "claude" ? "bg-pen-wash" : "bg-hint-wash"
      }`}
      style={{ boxShadow: "inset 0 2px 0 var(--hint)" }}
    >
      <span className="t-micro text-ink">
        Viewing {timeOf(version.at)}
      </span>
      <Rule />
      <span className="t-micro text-ink-2">
        {version.by === "claude" ? "Claude" : "you"}
      </span>
      {version.label || version.why ? (
        <>
          <Rule />
          <span className="t-micro min-w-0 flex-1 truncate text-ink-2">
            {version.label || version.why}
          </span>
        </>
      ) : (
        <span className="flex-1" />
      )}
      <button className="quiet t-micro" onClick={onToggleChanges}>
        {showingChanges ? "Hide what's gone" : "Show what's gone"}
      </button>
      <Rule />
      {confirming ? (
        <>
          <span className="t-micro text-ink-2">Replace the file with this?</span>
          <button
            className="quiet t-micro"
            data-tone="danger"
            onClick={() => {
              setConfirming(false);
              onRestore();
            }}
          >
            Restore
          </button>
          <button className="quiet t-micro" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </>
      ) : (
        <button className="quiet t-micro" onClick={() => setConfirming(true)}>
          Restore this
        </button>
      )}
      <Rule />
      <button className="quiet t-micro" data-tone="on" onClick={onBack}>
        Back to now
      </button>
    </div>
  );
}

function Rule() {
  return <span className="h-[10px] w-px shrink-0 bg-line" />;
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

/** Which files the editor can hold, and therefore which have text history
 *  rather than the byte kind.  Kept beside the panel rather than read from
 *  the tree: the panel is often open on a file whose row is scrolled out
 *  of the tree, and a suffix is the same answer either way. */
const TEXT_SUFFIXES = new Set([
  ".tex", ".ltx", ".sty", ".cls", ".bib", ".bbl", ".txt", ".md", ".json",
  ".yml", ".yaml", ".csv", ".toml", ".cfg", ".ini", ".log", ".py", ".sh",
]);

export function isText(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot <= 0 || TEXT_SUFFIXES.has(path.slice(dot).toLowerCase());
}
