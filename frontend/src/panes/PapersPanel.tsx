import { useEffect, useState } from "react";
import { Chevron } from "../App";
import api, { type LibraryProgress } from "../api";
import { get, set, useStore } from "../store";

/** The papers this project has collected, and what could not be read.
 *
 *  A rail footer section like the trash, and like the trash it is not there
 *  at all until it holds something. It does not list the papers: two
 *  hundred rows in a rail 240px wide is not a browsable object, and the
 *  writer already has a folder that browses them properly. What it lists is
 *  the failures, because those are the only rows with something to do.
 */

type Failure = { sha: string; name: string; reason: string; path: string };

export default function PapersPanel({ onRefresh }: { onRefresh: () => void }) {
  const projectId = useStore((s) => s.projectId);
  const progress = useStore((s) => s.library);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [sources, setSources] = useState<string[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [lastRun, setLastRun] = useState<any>({});
  const [naming, setNaming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  const load = async () => {
    if (!projectId) return;
    try {
      const state = await api.library(projectId);
      setCount(state.count);
      setSources(state.sources);
      setFailures(state.unidentified);
      setLastRun(state.lastRun ?? {});
    } catch {
      /* a project that has never had a library is not an error */
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // A run that has just ended has changed all of the above.
  useEffect(() => {
    if (progress && ["done", "stopped", "failed"].includes(progress.phase)) {
      void load();
      onRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.phase]);

  const running = progress && !["done", "stopped", "failed"].includes(progress.phase);
  if (!count && !failures.length && !progress) return null;

  return (
    <div className="shrink-0 border-t border-line" data-testid="papers-panel">
      <button
        className="flex h-[26px] w-full items-center gap-2 px-[10px] hover:bg-surface-2"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="t-meta min-w-0 flex-1 truncate text-left text-ink-2">
          {label(progress, count)}
        </span>
        {running ? (
          <span
            className="quiet t-micro shrink-0 text-hint"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              if (projectId) void api.stopPapers(projectId);
            }}
          >
            Stop
          </span>
        ) : null}
        <span className={`shrink-0 text-ink-3 ${open ? "rotate-90" : ""}`}>
          <Chevron direction="right" />
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-[10px] py-2">
          {running ? (
            <>
              <p className="t-code-sm truncate text-ink-3">{progress?.name}</p>
              <p className="t-meta mt-1 text-ink-2">
                {progress?.added} added · {progress?.duplicate} already there ·{" "}
                {progress?.unidentified} not identified
              </p>
              <p className="t-micro mt-1 text-ink-3">
                Keep writing. The bibliography fills in as they arrive.
              </p>
            </>
          ) : (
            <>
              {lastRun?.at ? (
                <p className="t-meta text-ink-2">
                  {lastRun.added ?? 0} added, {lastRun.duplicate ?? 0} already
                  there, {lastRun.unidentified ?? 0} not identified.
                </p>
              ) : null}
              {sources.length ? (
                <p className="t-code-sm mt-1 truncate text-ink-3" title={sources[0]}>
                  From {sources[0]}
                </p>
              ) : null}
            </>
          )}

          {progress?.message ? (
            <p className="t-meta mt-2 text-warn">{progress.message}</p>
          ) : null}

          {failures.length ? (
            <>
              <p className="t-micro mt-3 text-ink-2">
                {failures.length} not identified
              </p>
              <div className="mt-1 max-h-[220px] overflow-auto">
                {failures.map((failure) => (
                  <div key={failure.sha} className="group py-[2px]">
                    <div className="flex h-[22px] items-center gap-2">
                      <span
                        className="t-code-sm min-w-0 flex-1 truncate text-ink-2"
                        title={`${failure.path} — ${failure.reason}`}
                      >
                        {failure.name}
                      </span>
                      <button
                        className="quiet t-micro shrink-0 opacity-0 focus:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          setNaming(failure.sha);
                          setProblem("");
                        }}
                      >
                        DOI
                      </button>
                    </div>
                    {naming === failure.sha ? (
                      <input
                        autoFocus
                        placeholder="10.1063/5.0274633"
                        className={`t-code-sm mt-1 w-full border-b bg-transparent outline-none placeholder:text-ink-3 ${
                          problem ? "border-error" : "border-pen"
                        }`}
                        onKeyDown={async (event) => {
                          if (event.key === "Escape") {
                            setNaming(null);
                            return;
                          }
                          if (event.key !== "Enter" || !projectId) return;
                          const doi = event.currentTarget.value.trim();
                          if (!doi) return;
                          try {
                            const answer = await api.resolvePaper(
                              projectId, failure.sha, doi,
                            );
                            if (!answer.added) {
                              setProblem(answer.reason ?? "That did not work.");
                              return;
                            }
                            if (answer.warning) set({ error: answer.warning });
                            setNaming(null);
                            void load();
                            onRefresh();
                          } catch (error: any) {
                            setProblem(error.message);
                          }
                        }}
                      />
                    ) : null}
                    {naming === failure.sha && problem ? (
                      <p className="t-micro text-error">{problem}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                className="quiet t-micro mt-2"
                onClick={async () => {
                  if (!projectId) return;
                  await api.forgetUnidentified(projectId).catch(() => undefined);
                  void load();
                }}
              >
                Forget these
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function label(progress: LibraryProgress | null, count: number): string {
  if (!progress) return `Papers (${count})`;
  if (progress.phase === "walking") return "Reading papers — finding PDFs";
  if (progress.phase === "reading") {
    return `Reading papers — ${progress.done} of ${progress.total}`;
  }
  if (progress.phase === "stopped" || progress.phase === "failed") {
    return "Reading papers — stopped";
  }
  return `Papers (${count})`;
}
