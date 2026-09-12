import { useEffect, useMemo, useState } from "react";
import { Chevron } from "../chrome";
import api, { type LibraryProgress, type TreeNode } from "../api";
import { set, useStore } from "../store";
import { isBib } from "./file-kinds";

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
  /** A DOI the writer has in front of them, with no paper behind it. The
   *  only route that added an entry needed an unidentified PDF from a
   *  folder scan to hang the DOI on, so somebody who simply had a DOI had
   *  to acquire a paper first. */
  const [doi, setDoi] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState("");
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<
    { checked: number; problems: { key: string; issues: string[] }[] } | null
  >(null);
  const tree = useStore((s) => s.tree);
  /** Whether this project has a bibliography at all. Both controls below
   *  write to one or read one, and offering either where there is none is
   *  offering a button that can only fail. */
  const hasBib = useMemo(() => {
    const walk = (node: TreeNode): boolean =>
      (node.children ?? []).some(
        (child) => (child.type === "dir" ? walk(child) : isBib(child.name)),
      );
    return tree ? walk(tree) : false;
  }, [tree]);

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

  const addByDoi = async () => {
    if (!projectId || !doi.trim()) return;
    setAdding(true);
    setAdded("");
    try {
      const answer = await api.addByDoi(projectId, doi.trim());
      if (!answer.added) {
        setAdded(answer.reason ?? "That did not work.");
        return;
      }
      // What was added, so it can be checked against the page the writer
      // is looking at rather than taken on trust.
      const said = [answer.author, answer.year].filter(Boolean).join(", ");
      setAdded(`Added ${answer.key}: ${answer.title}${said ? ` (${said})` : ""}`);
      setDoi("");
      onRefresh();
    } catch (error: any) {
      setAdded(error.message);
    } finally {
      setAdding(false);
    }
  };

  const check = async () => {
    if (!projectId) return;
    setChecking(true);
    try {
      setReport(await api.verifyLibrary(projectId));
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const running = progress && !["done", "stopped", "failed"].includes(progress.phase);
  // A project with a bibliography has something to do here even if no
  // folder has ever been read: a DOI can be added and the entries can be
  // checked, and both of those were reachable only from the agent.
  if (!count && !failures.length && !progress && !hasBib) return null;

  return (
    <div className="shrink-0 border-t border-line" data-testid="papers-panel">
      {/* Stop is a sibling of the header button, not a child of it. It was
          a `role="button"` span inside a real `<button>`, which is the axe
          rule `nested-interactive`, impact serious: the outer control is
          announced as one button and the inner one is either unreachable
          or folded into its name. Two buttons in a row is what this always
          was, so it is two buttons in a row now. */}
      <div className="flex h-[26px] w-full items-center gap-2 px-[10px] hover:bg-surface-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="t-meta min-w-0 flex-1 truncate text-left text-ink-2">
            {label(progress, count)}
          </span>
          <span className={`shrink-0 text-ink-3 ${open ? "rotate-90" : ""}`}>
            <Chevron direction="right" />
          </span>
        </button>
        {running ? (
          <button
            className="quiet t-micro shrink-0 text-hint"
            onClick={() => {
              if (projectId) void api.stopPapers(projectId);
            }}
          >
            Stop
          </button>
        ) : null}
      </div>

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

          {hasBib ? (
            <div className="mt-3 border-t border-line pt-2">
              {/* Two things the README promises to somebody working
                  without an agent, both of which were agent tools and
                  nothing else. The entry always comes from the
                  publisher's own record; nothing here invents one. */}
              <label className="t-micro block text-ink-2" htmlFor="papers-doi">
                Add a paper by DOI
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="papers-doi"
                  value={doi}
                  placeholder="10.1103/PhysRev.28.1049"
                  data-testid="papers-doi"
                  className="t-code-sm min-w-0 flex-1 border-b border-line bg-transparent outline-none placeholder:text-ink-3 focus:border-pen"
                  onChange={(event) => setDoi(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addByDoi();
                  }}
                />
                <button
                  className="quiet t-micro shrink-0"
                  disabled={adding || !doi.trim()}
                  onClick={() => void addByDoi()}
                >
                  {adding ? "Looking…" : "Add"}
                </button>
              </div>
              {added ? (
                <p className="t-micro mt-1 text-ink-2" data-testid="papers-added">
                  {added}
                </p>
              ) : null}

              <button
                className="quiet t-micro mt-3"
                data-testid="papers-verify"
                disabled={checking}
                onClick={() => void check()}
              >
                {checking ? "Checking…" : "Check these against their records"}
              </button>
              {report ? (
                <div className="mt-1" data-testid="papers-report">
                  {report.problems.length === 0 ? (
                    <p className="t-micro text-ink-2">
                      {report.checked} entries, all matching their records.
                    </p>
                  ) : (
                    <>
                      <p className="t-micro text-warn">
                        {report.problems.length} of {report.checked} disagree
                        with the record they came from.
                      </p>
                      {report.problems.map((trouble) => (
                        <p key={trouble.key} className="t-micro mt-1 text-ink-2">
                          <span className="t-code-sm text-ink">{trouble.key}</span>{" "}
                          {trouble.issues.join("; ")}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
            </div>
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
                        title={`${failure.path}: ${failure.reason}`}
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
                        placeholder="10.1103/PhysRev.28.1049"
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
  if (progress.phase === "walking") return "Reading papers: finding PDFs";
  if (progress.phase === "reading") {
    return `Reading papers: ${progress.done} of ${progress.total}`;
  }
  if (progress.phase === "stopped" || progress.phase === "failed") {
    return "Reading papers: stopped";
  }
  return `Papers (${count})`;
}
