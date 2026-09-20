import { useEffect, useMemo, useRef, useState } from "react";
import api, { type SearchHit, type SymbolKind } from "../api";
import { set, useStore } from "../store";
import { Button } from "../ui/Button";
import { Empty, Field } from "../ui/controls";
import { SearchIcon } from "../ui/icons";

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
  /** The name the editor asked about, when the panel is listing its
   *  references rather than searching.  Escape or typing a query leaves
   *  it. */
  const request = useStore((s) => s.symbolRequest);
  const [refs, setRefs] = useState<{ kind: SymbolKind; name: string; commented: number } | null>(null);
  const [newName, setNewName] = useState("");
  const [inComments, setInComments] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const renameBox = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusNonce) box.current?.select();
  }, [focusNonce]);

  // A request from the editor: list the references and, when asked,
  // open the rename with the name filled in and selected.
  useEffect(() => {
    if (!request || !projectId) return;
    let cancelled = false;
    setQuery("");
    setProblem("");
    setBusy(true);
    setRefs({ kind: request.kind, name: request.name, commented: 0 });
    setNewName(request.name);
    setInComments(false);
    setRenaming(request.rename);
    setConfirming(false);
    api
      .references(projectId, request.kind, request.name)
      .then((answer) => {
        if (cancelled) return;
        setHits(answer.hits);
        setCapped(false);
        setRefs({ kind: answer.kind, name: answer.name, commented: answer.commented });
        if (request.rename) window.setTimeout(() => renameBox.current?.select(), 0);
      })
      .catch((error: any) => !cancelled && setProblem(error.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [request?.nonce, projectId]);

  const leaveReferences = () => {
    setRefs(null);
    setRenaming(false);
    setConfirming(false);
    setHits(null);
  };

  const renameAll = async () => {
    if (!projectId || !refs) return;
    const to = newName.trim();
    if (!to || to === refs.name) return;
    setConfirming(false);
    setBusy(true);
    try {
      const answer = await api.renameSymbol(projectId, refs.kind, refs.name, to, inComments);
      set({
        error:
          `Renamed ${refs.name} to ${to} in ${answer.files} ` +
          `${answer.files === 1 ? "file" : "files"}.`,
      });
      leaveReferences();
    } catch (error: any) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!projectId || !query) {
      // Not while the references are up: an empty query is how the
      // panel looks with a request in it.
      if (!refs) {
        setHits(null);
        setProblem("");
      }
      return;
    }
    setRefs(null);
    setRenaming(false);
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
    // The Search drawer as the page draws it: the kit's field with the
    // two switches inside it, the summary line with Replace beside it,
    // and the hits grouped under file rows with the match on the wash.
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-1" data-testid="search-panel">
      <div className="flex shrink-0 flex-col gap-[6px] pb-[6px]">
        <Field
          ref={box}
          frameClassName="w-full"
          leading={<SearchIcon size={14} />}
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
          trailing={
            // The two switches CodeMirror's own panel offers, in its own
            // shorthand, so the two find rows in this app do not disagree
            // about what a query means.
            <span className="flex shrink-0 gap-[2px]">
              <button
                className="nx-field-toggle"
                data-testid="search-case"
                aria-pressed={matchCase}
                title="Match case"
                onClick={() => setMatchCase(!matchCase)}
              >
                Aa
              </button>
              <button
                className="nx-field-toggle"
                data-testid="search-regex"
                aria-pressed={regex}
                title="Use a regular expression"
                onClick={() => setRegex(!regex)}
              >
                .*
              </button>
            </span>
          }
        />
        {replacing ? (
          <Field
            frameClassName="w-full"
            placeholder="Replace with"
            data-testid="project-replace"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
        ) : null}
      </div>

      {problem ? (
        <p className="nx-note !text-error" data-testid="search-problem">
          {problem}
        </p>
      ) : null}

      {refs && !problem ? (
        <div className="pb-[5px]" data-testid="references">
          <div className="nx-line">
            <span className="flex-1 truncate" data-testid="references-summary">
              {hits === null
                ? `Finding ${refs.name}`
                : `${hits.length} ${hits.length === 1 ? "use" : "uses"} of ${refs.name} in ${files} ` +
                  `${files === 1 ? "file" : "files"}` +
                  (refs.commented ? `, ${refs.commented} in ${refs.commented === 1 ? "a comment" : "comments"}` : "")}
            </span>
            {!renaming ? (
              <Button
                size="inline"
                data-testid="references-rename"
                onClick={() => {
                  setRenaming(true);
                  window.setTimeout(() => renameBox.current?.select(), 0);
                }}
              >
                Rename
              </Button>
            ) : null}
            <Button size="inline" onClick={leaveReferences}>
              Close
            </Button>
          </div>
          {renaming ? (
            <div className="px-2 pt-[5px]">
              <Field
                ref={renameBox}
                frameClassName="w-full"
                data-testid="rename-to"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newName.trim() && newName.trim() !== refs.name) {
                    event.preventDefault();
                    setConfirming(true);
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    leaveReferences();
                  }
                }}
              />
              {refs.commented ? (
                <label className="t-meta mt-[6px] flex items-center gap-[6px] text-ink-2">
                  <input
                    type="checkbox"
                    data-testid="rename-comments"
                    checked={inComments}
                    onChange={(event) => setInComments(event.target.checked)}
                  />
                  Also in the {refs.commented === 1 ? "comment" : "comments"}
                </label>
              ) : null}
              {confirming ? (
                <div className="pt-[4px]">
                  {/* The same sentence the replace shows, because it is
                      the same edit: across the project, and not one
                      Mod-Z can take back. */}
                  <p className="t-meta pb-[4px] text-ink-2">
                    Rename {refs.name} to {newName.trim()} in {files}{" "}
                    {files === 1 ? "file" : "files"}? Each file keeps a version in its history.
                  </p>
                  <div className="flex gap-[2px]">
                    <Button
                      size="inline"
                      variant="danger"
                      data-testid="rename-confirm"
                      disabled={busy}
                      onClick={renameAll}
                    >
                      Rename everywhere
                    </Button>
                    <Button size="inline" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="pt-[4px]">
                  <Button
                    size="inline"
                    data-testid="rename-go"
                    disabled={!newName.trim() || newName.trim() === refs.name || hits === null}
                    onClick={() => setConfirming(true)}
                  >
                    Rename everywhere
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {hits === null && !problem && !refs ? (
        <Empty>Matches are grouped by file. Enter opens one in the editor.</Empty>
      ) : null}
      {hits !== null && !problem && !refs ? (
        <div className="nx-line">
          <span className="flex-1" data-testid="search-summary">
            {hits.length === 0
              ? busy
                ? "Searching"
                : "Nothing found"
              : `${hits.length} in ${files} ${files === 1 ? "file" : "files"}` +
                (capped ? ", showing the first 500" : "")}
          </span>
          {hits.length ? (
            <Button
              size="inline"
              data-testid="search-replace-toggle"
              onClick={() => setReplacing(!replacing)}
            >
              {replacing ? "Hide replace" : "Replace"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {replacing && hits && hits.length ? (
        confirming ? (
          <div className="nx-line flex-wrap">
            {/* Where the writer decides is where the undo has to be
                written down: a replace across a project is the one edit
                Mod-Z cannot take back. */}
            <span className="w-full">
              Replace {hits.length} in {files} {files === 1 ? "file" : "files"}?
              Each file keeps a version in its history.
            </span>
            <Button
              size="inline"
              variant="danger"
              data-testid="search-replace-confirm"
              disabled={busy}
              onClick={replaceAll}
            >
              Replace all
            </Button>
            <Button size="inline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="nx-line">
            <Button
              size="inline"
              data-testid="search-replace-all"
              onClick={() => setConfirming(true)}
            >
              Replace all
            </Button>
          </div>
        )
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {grouped.map(([path, rows]) => {
          const name = path.split("/").pop() ?? path;
          const dot = name.lastIndexOf(".");
          return (
            <div key={path}>
              <div className="nx-group" data-testid="search-file" data-path={path}>
                <span className="min-w-0 truncate" title={path}>
                  {dot > 0 ? name.slice(0, dot) : name}
                  {dot > 0 ? <span className="nx-group-ext">{name.slice(dot)}</span> : null}
                </span>
                <span className="nx-group-count">{rows.length}</span>
              </div>
              {rows.map((hit) => (
                <button
                  key={`${hit.line}:${hit.column}`}
                  className="nx-hit"
                  data-testid="search-hit"
                  data-path={hit.path}
                  data-line={hit.line}
                  onClick={() => onOpen(hit.path, hit.line)}
                >
                  <span className="nx-hit-line">{hit.line}</span>
                  <span className="nx-hit-text">
                    {hit.text.slice(0, hit.column - 1)}
                    <mark className="nx-found">
                      {hit.text.slice(hit.column - 1, hit.column - 1 + hit.length)}
                    </mark>
                    {hit.text.slice(hit.column - 1 + hit.length)}
                  </span>
                  {hit.commented ? (
                    <span className="nx-hit-comment" title="In a comment">%</span>
                  ) : null}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
