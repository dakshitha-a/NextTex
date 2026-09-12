import { useEffect, useMemo, useRef, useState } from "react";
import api, { type SearchHit } from "../api";
import { set, useStore } from "../store";

/** Find, and replace, across the whole project.
 *
 *  The editor has always had CodeMirror's find and replace inside one
 *  file, and nothing at all across the project: renaming a label or a
 *  command meant opening every chapter and pressing Ctrl-F in each.
 *
 *  The results are grouped by file rather than listed flat, because the
 *  question a writer asks of a project search is "which files" at least as
 *  often as "which lines", and a flat list of forty hits in one file
 *  answers neither.
 */

/** Long enough to finish a word. The search walks every text file in the
 *  project and runs a regular expression over each, so a request per
 *  keystroke is the one thing this panel must not do. */
const SETTLE = 300;

function group(hits: SearchHit[]): [string, SearchHit[]][] {
  const byPath = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const rows = byPath.get(hit.path);
    if (rows) rows.push(hit);
    else byPath.set(hit.path, [hit]);
  }
  return [...byPath.entries()];
}

export default function SearchPanel({
  onOpen,
  focusNonce,
}: {
  onOpen: (path: string, line?: number) => void;
  /** Bumped when the shortcut asks for the caret. A number rather than a
   *  boolean nobody clears, the way the tree's filter row is asked for. */
  focusNonce: number;
}) {
  const projectId = useStore((s) => s.projectId);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusNonce) box.current?.select();
  }, [focusNonce]);

  useEffect(() => {
    if (!projectId || !query) {
      setHits(null);
      setProblem("");
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      api
        .search(projectId, query, { regex, case: matchCase })
        .then((answer) => {
          if (cancelled) return;
          setHits(answer.hits);
          setCapped(answer.capped);
          setProblem("");
        })
        .catch((error: any) => {
          if (cancelled) return;
          setHits(null);
          setProblem(error.message);
        })
        .finally(() => !cancelled && setBusy(false));
    }, SETTLE);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setBusy(false);
    };
  }, [projectId, query, regex, matchCase]);

  const grouped = useMemo(() => group(hits ?? []), [hits]);
  const files = grouped.length;

  const replaceAll = async () => {
    if (!projectId) return;
    setConfirming(false);
    setBusy(true);
    try {
      const answer = await api.replaceInProject(projectId, query, replacement, {
        regex,
        case: matchCase,
      });
      set({
        error:
          `Replaced ${answer.replaced} ` +
          `${answer.replaced === 1 ? "match" : "matches"} in ${answer.files} ` +
          `${answer.files === 1 ? "file" : "files"}.`,
      });
      setHits([]);
    } catch (error: any) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-line pb-1">
      <div className="flex items-center gap-1 px-[10px] py-[5px]">
        <input
          ref={box}
          className="t-ui min-w-0 flex-1 rounded-[3px] border border-line bg-surface-2 px-[6px] py-[2px] text-ink"
          placeholder="Find in project"
          data-testid="project-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {/* The two switches CodeMirror's own panel offers, in its own
            shorthand, so the two find rows in this app do not disagree
            about what a query means. */}
        <button
          className="quiet t-micro shrink-0"
          data-testid="search-case"
          aria-pressed={matchCase}
          title="Match case"
          style={{ opacity: matchCase ? 1 : 0.5 }}
          onClick={() => setMatchCase(!matchCase)}
        >
          Aa
        </button>
        <button
          className="quiet t-micro shrink-0"
          data-testid="search-regex"
          aria-pressed={regex}
          title="Use a regular expression"
          style={{ opacity: regex ? 1 : 0.5 }}
          onClick={() => setRegex(!regex)}
        >
          .*
        </button>
      </div>

      {replacing ? (
        <div className="flex items-center gap-1 px-[10px] pb-[5px]">
          <input
            className="t-ui min-w-0 flex-1 rounded-[3px] border border-line bg-surface-2 px-[6px] py-[2px] text-ink"
            placeholder="Replace with"
            data-testid="project-replace"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
        </div>
      ) : null}

      {problem ? (
        <p className="t-micro px-[10px] pb-[5px] text-error" data-testid="search-problem">
          {problem}
        </p>
      ) : null}

      {hits !== null && !problem ? (
        <div className="flex items-center gap-2 px-[10px] pb-[5px]">
          <span className="t-micro flex-1 text-ink-3" data-testid="search-summary">
            {hits.length === 0
              ? busy
                ? "Searching"
                : "Nothing found"
              : `${hits.length} in ${files} ${files === 1 ? "file" : "files"}` +
                (capped ? ", showing the first 500" : "")}
          </span>
          {hits.length ? (
            <button
              className="quiet t-micro shrink-0"
              data-testid="search-replace-toggle"
              onClick={() => setReplacing(!replacing)}
            >
              {replacing ? "Hide replace" : "Replace"}
            </button>
          ) : null}
        </div>
      ) : null}

      {replacing && hits && hits.length ? (
        confirming ? (
          <div className="px-[10px] pb-[6px]">
            {/* Where the writer decides is where the undo has to be
                written down: a replace across a project is the one edit
                Mod-Z cannot take back. */}
            <p className="t-micro pb-[4px] text-ink-2">
              Replace {hits.length} in {files} {files === 1 ? "file" : "files"}?
              Each file keeps a version in its history.
            </p>
            <div className="flex gap-2">
              <button
                className="quiet t-micro"
                data-tone="danger"
                data-testid="search-replace-confirm"
                disabled={busy}
                onClick={replaceAll}
              >
                Replace all
              </button>
              <button className="quiet t-micro" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="px-[10px] pb-[6px]">
            <button
              className="quiet t-micro"
              data-testid="search-replace-all"
              onClick={() => setConfirming(true)}
            >
              Replace all
            </button>
          </div>
        )
      ) : null}

      <div className="max-h-[300px] overflow-auto">
        {grouped.map(([path, rows]) => (
          <div key={path}>
            <div
              className="t-micro flex items-center gap-2 px-[10px] py-[2px] text-ink-2"
              data-testid="search-file"
              data-path={path}
            >
              <span className="min-w-0 flex-1 truncate" title={path}>
                {path}
              </span>
              <span className="shrink-0 text-ink-3">{rows.length}</span>
            </div>
            {rows.map((hit) => (
              <button
                key={`${hit.line}:${hit.column}`}
                className="flex w-full items-baseline gap-2 rounded-[3px] px-[10px] py-[1px] text-left hover:bg-surface-2"
                data-testid="search-hit"
                data-path={hit.path}
                data-line={hit.line}
                onClick={() => onOpen(hit.path, hit.line)}
              >
                <span className="t-micro tnum w-[28px] shrink-0 text-right text-ink-3">
                  {hit.line}
                </span>
                <span className="t-micro min-w-0 flex-1 truncate text-ink-2">
                  {hit.text.slice(0, hit.column - 1)}
                  <span className="text-ink nx-found">
                    {hit.text.slice(hit.column - 1, hit.column - 1 + hit.length)}
                  </span>
                  {hit.text.slice(hit.column - 1 + hit.length)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
