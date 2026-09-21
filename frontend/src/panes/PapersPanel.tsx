import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import { set, useStore } from "../store";
import { Button } from "../ui/Button";
import { Empty, Field, Row } from "../ui/controls";
import { FloatingCard } from "../ui/FloatingCard";
import { ChevronDownIcon, DocIcon, SearchIcon } from "../ui/icons";
import { bibIn } from "../tree";

/** Fetched when a folder is to be read, which most sessions never ask. */
const PapersChooser = lazy(() => import("./PapersChooser"));

/** The Papers drawer: the bibliography's front door for a writer without
 *  an agent, and the account of what a folder of PDFs turned into.
 *
 *  Rebuilt whole in the visual overhaul at the writer's request ("very
 *  unintuitive"): one field takes a search phrase or a pasted DOI, since a
 *  string starting `10.` is a DOI and the server tells the two apart;
 *  each result is a row with the paper's title, first author, year and
 *  venue, Add beside it and "added as key" once done, and a hover card
 *  with the full author list, the venue, the DOI and the abstract where
 *  the record has one.  A folder scan's outcome reads as prose, and the
 *  PDFs no DOI was found for are rows with "Give a DOI"; the words "not
 *  identified" left the interface with it.  The record check is one quiet
 *  action at the foot.  The drawer never hides itself: empty, it is one
 *  sentence and "Read a folder of PDFs".  It does not list the papers: two
 *  hundred rows in a drawer is not a browsable object, and the writer
 *  already has a folder that browses them properly. */

type Failure = { sha: string; name: string; reason: string; path: string };
type Result = {
  doi: string; title: string; first: string; authors: number; year: string; journal: string;
  names: string[]; abstract: string;
};

const SOURCE_NAMES = { crossref: "Crossref", openalex: "OpenAlex", semanticscholar: "Semantic Scholar" };

export default function PapersPanel({
  onRefresh,
  chooseNonce = 0,
}: {
  onRefresh: () => void;
  /** Bumped by the drawer heading's folder button: each change opens
   *  the chooser, the way the search drawer takes its focus. */
  chooseNonce?: number;
}) {
  const projectId = useStore((s) => s.projectId);
  const progress = useStore((s) => s.library);
  const [count, setCount] = useState(0);
  const [entries, setEntries] = useState(0);
  // Whether the server has said what the bibliography holds.  Before it
  // has, the counts above are zero, and zero used to draw "Nothing in the
  // bibliography yet" with its button for the round trip, which the
  // writer saw as a flash; a state is drawn only once it is known.
  const [known, setKnown] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [lastRun, setLastRun] = useState<any>({});
  const [naming, setNaming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [checking, setChecking] = useState(false);
  /** The one box: a query, which publisher, what came back, and the key
   *  an Add produced beside the row it produced it from. */
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<keyof typeof SOURCE_NAMES>("crossref");
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchSaid, setSearchSaid] = useState("");
  const [addedKeys, setAddedKeys] = useState<Record<string, string>>({});
  const [report, setReport] = useState<
    { checked: number; problems: { key: string; issues: string[] }[] } | null
  >(null);
  /** Which result's card is up, and where its row is. */
  const [card, setCard] = useState<{ doi: string; top: number } | null>(null);
  const cardTimer = useRef<number | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const tree = useStore((s) => s.tree);
  const bib = useMemo(() => bibIn(tree), [tree]);
  useEffect(() => {
    if (chooseNonce && bib) setChoosing(bib);
  }, [chooseNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    if (!projectId) return;
    try {
      const state = await api.library(projectId);
      setCount(state.count);
      setEntries(state.entries ?? 0);
      setSources(state.sources);
      setFailures(state.unidentified);
      setLastRun(state.lastRun ?? {});
    } catch {
      /* a project that has never had a library is not an error */
    }
    setKnown(true);
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

  const search = async () => {
    if (!projectId || !query.trim()) return;
    setSearching(true);
    setSearchSaid("");
    try {
      const answer = await api.searchLiterature(projectId, query.trim(), source);
      setResults(answer.results);
      if (!answer.results.length) {
        setSearchSaid(answer.source === "doi" ? "No record for that DOI." : "Nothing found.");
      }
    } catch (error: any) {
      setResults(null);
      setSearchSaid(error.message);
    } finally {
      setSearching(false);
    }
  };

  const addResult = async (doi: string) => {
    if (!projectId || !doi) return;
    setAddedKeys((current) => ({ ...current, [doi]: "…" }));
    try {
      const answer = await api.addByDoi(projectId, doi);
      setAddedKeys((current) => ({
        ...current,
        [doi]: answer.added ? (answer.key ?? "added") : (answer.reason ?? "That did not work."),
      }));
      if (answer.added) onRefresh();
    } catch (error: any) {
      setAddedKeys((current) => ({ ...current, [doi]: error.message }));
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

  // The card arrives after the pointer has rested, the way the editor's
  // hover cards do, and goes the moment it leaves.
  const showCard = (doi: string, element: HTMLElement) => {
    if (cardTimer.current) window.clearTimeout(cardTimer.current);
    const top = element.offsetTop + element.offsetHeight;
    cardTimer.current = window.setTimeout(() => setCard({ doi, top }), 400);
  };
  const hideCard = () => {
    if (cardTimer.current) window.clearTimeout(cardTimer.current);
    cardTimer.current = null;
    setCard(null);
  };

  const running = progress && !["done", "stopped", "failed"].includes(progress.phase);
  const nothing = !count && !failures.length && !progress && !results;
  // The bibliography has entries NextTex did not put there and nothing
  // is being searched or read: say what the file holds rather than
  // "nothing yet", which would be untrue of it.
  const settled = nothing && entries > 0;
  const hovered = card ? results?.find((row) => row.doi === card.doi) : undefined;
  const folder = sources[0] ? sources[0].split("/").filter(Boolean).pop() : "";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col px-2 pb-1" data-testid="papers-panel">
      {bib ? (
        // One box for a query or a DOI, the publisher as a quiet chooser
        // inside it: the server sends a DOI to the resolver and anything
        // else to the chosen source.
        <div className="shrink-0 pb-[6px]">
          <Field
            frameClassName="w-full"
            leading={<SearchIcon size={14} />}
            placeholder="Search the literature, or paste a DOI"
            data-testid="papers-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
            trailing={
              // The publisher, once there is something to ask it; a DOI
              // needs none, and an empty field is the sentence alone.
              query.trim() ? (
                <span className="relative flex shrink-0 items-center text-[12px] text-ink-3 hover:text-ink">
                  <select
                    value={source}
                    aria-label="Which publisher to ask"
                    data-testid="papers-source"
                    className="appearance-none bg-transparent pr-[14px]"
                    onChange={(event) => setSource(event.target.value as keyof typeof SOURCE_NAMES)}
                  >
                    <option value="crossref">Crossref</option>
                    <option value="openalex">OpenAlex</option>
                    <option value="semanticscholar">Semantic Scholar</option>
                  </select>
                  <span className="pointer-events-none absolute right-0"><ChevronDownIcon size={10} /></span>
                </span>
              ) : null
            }
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {searching ? <p className="nx-note">Asking {SOURCE_NAMES[source]}</p> : null}
        {searchSaid ? (
          <p className="nx-note" data-testid="papers-search-said">{searchSaid}</p>
        ) : null}
        {results && results.length ? (
          <ul data-testid="papers-results">
            {results.map((row, index) => {
              const state = row.doi ? addedKeys[row.doi] : undefined;
              // Two authors are both named, as the page draws them; three or
              // more are the first and "et al.", and the card names them all.
              const family = (name: string) => name.trim().split(/\s+/).pop() ?? name;
              const authors = row.names?.length === 2
                ? row.names.map(family).join(", ")
                : row.first + (row.authors > 1 ? " et al." : "");
              const who = [authors, row.year, row.journal].filter(Boolean).join(", ");
              return (
                // A result: the title, then who, when and where in the
                // third ink with Add at the right, or what it was added as.
                <li
                  key={`${row.doi || row.title}:${index}`}
                  className={`rounded-control px-2 py-[6px] ${card?.doi === row.doi && row.doi ? "bg-wash" : ""}`}
                  data-testid="papers-result"
                  onMouseEnter={(event) => row.doi && showCard(row.doi, event.currentTarget)}
                  onMouseLeave={hideCard}
                  onFocus={(event) => row.doi && showCard(row.doi, event.currentTarget)}
                  onBlur={hideCard}
                >
                  <p className="text-[13.5px] leading-[18px] text-ink" title={row.title}>{row.title}</p>
                  <p className="flex items-end gap-2 text-[12.5px] leading-[17px] text-ink-3">
                    <span className="min-w-0 flex-1">{who}</span>
                    {row.doi ? (
                      state && state !== "…" ? (
                        <span className="t-micro shrink-0" data-testid="papers-result-added">
                          {/\s/.test(state) ? state : `added as ${state}`}
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="inline"
                          data-testid="papers-result-add"
                          disabled={state === "…"}
                          onClick={() => void addResult(row.doi)}
                        >
                          {state === "…" ? "Adding…" : "Add"}
                        </Button>
                      )
                    ) : (
                      <span className="t-micro shrink-0" title="No DOI on the record">no DOI</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}
        {/* The hover card: what a row does not have room for. */}
        {hovered && card && (hovered.names?.length || hovered.abstract) ? (
          <FloatingCard
            testid="papers-card"
            // The page's 232 px where the drawer allows it, narrower in a
            // narrow drawer, so the card never leaves the drawer's edge.
            className="absolute left-[28px] z-20 w-[min(232px,calc(100%-36px))] p-[10px_12px] text-[13px] leading-[18px] text-ink-2"
            style={{ top: card.top + 44 }}
          >
            <p className="font-medium text-ink">{hovered.title}</p>
            {hovered.names?.length ? <p className="t-meta text-ink-3">{hovered.names.join(", ")}</p> : null}
            <p className="t-meta text-ink-3">{[hovered.journal, hovered.year].filter(Boolean).join(", ")}</p>
            <p className="t-code-sm text-ink-3">{hovered.doi}</p>
            {hovered.abstract ? (
              <p className="mt-[6px] line-clamp-6 text-[12.5px] leading-[17px]">{hovered.abstract}</p>
            ) : null}
          </FloatingCard>
        ) : null}

        {running ? (
          <>
            <p className="nx-group">
              Reading papers
              <span className="nx-group-count">{progress?.done} of {progress?.total}</span>
            </p>
            <p className="nx-note t-code-sm truncate">{progress?.name}</p>
            <p className="nx-note">
              {progress?.added} added, {progress?.duplicate} already there,{" "}
              {progress?.unidentified} without a DOI. Keep writing: the bibliography fills in
              as they arrive.
            </p>
            <div className="nx-line">
              <Button
                size="inline"
                onClick={() => {
                  if (projectId) void api.stopPapers(projectId);
                }}
              >
                Stop
              </Button>
            </div>
          </>
        ) : lastRun?.at || failures.length ? (
          // The scan's outcome as prose, and then the PDFs it could not
          // place, each a row with the one thing to do about it.
          <>
            <p className="nx-group">
              From {folder ? `the ${folder} folder` : "a folder"}
              <span className="nx-group-count">{lastRun.added ?? 0} added</span>
            </p>
            <p className="nx-note" style={{ paddingTop: 0 }}>
              {lastRun.duplicate
                ? `${lastRun.duplicate} ${lastRun.duplicate === 1 ? "was" : "were"} already in the bibliography. `
                : ""}
              {failures.length
                ? `${failures.length} ${failures.length === 1 ? "PDF carries" : "PDFs carry"} no DOI NextTex could find:`
                : ""}
            </p>
          </>
        ) : null}
        {progress?.message ? <p className="nx-note !text-warn">{progress.message}</p> : null}
        {failures.map((failure) => (
          <div key={failure.sha}>
            <Row
              leading={<DocIcon />}
              title={`${failure.path}: ${failure.reason}`}
              trailing={
                <Button
                  size="inline"
                  onClick={() => {
                    setNaming(failure.sha);
                    setProblem("");
                  }}
                >
                  Give a DOI
                </Button>
              }
            >
              <span className="text-ink">{failure.name.replace(/\.pdf$/i, "")}</span>
              <span className="text-ink-3">{/\.pdf$/i.test(failure.name) ? ".pdf" : ""}</span>
            </Row>
            {naming === failure.sha ? (
              <div className="px-2 pb-1">
                <Field
                  autoFocus
                  frameClassName="w-full"
                  placeholder="10.1103/PhysRev.28.1049"
                  onKeyDown={async (event) => {
                    if (event.key === "Escape") {
                      setNaming(null);
                      return;
                    }
                    if (event.key !== "Enter" || !projectId) return;
                    const doi = event.currentTarget.value.trim();
                    if (!doi) return;
                    try {
                      const answer = await api.resolvePaper(projectId, failure.sha, doi);
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
                {problem ? <p className="nx-note !text-error">{problem}</p> : null}
              </div>
            ) : null}
          </div>
        ))}
        {failures.length ? (
          <div className="nx-line">
            <Button
              size="inline"
              onClick={async () => {
                if (!projectId) return;
                await api.forgetUnidentified(projectId).catch(() => undefined);
                void load();
              }}
            >
              Forget these
            </Button>
          </div>
        ) : null}
        {report ? (
          <div data-testid="papers-report">
            {report.problems.length === 0 ? (
              <p className="nx-note">{report.checked} entries, all matching their records.</p>
            ) : (
              <>
                <p className="nx-note !text-warn">
                  {report.problems.length} of {report.checked} disagree with the record they
                  came from.
                </p>
                {report.problems.map((trouble) => (
                  <p key={trouble.key} className="nx-note">
                    <span className="t-code-sm text-ink">{trouble.key}</span> {trouble.issues.join("; ")}
                  </p>
                ))}
              </>
            )}
          </div>
        ) : null}
        {!known ? null : settled ? (
          <p className="nx-note">
            {bib} holds {entries} {entries === 1 ? "entry" : "entries"}.
          </p>
        ) : nothing && !bib ? (
          <Empty>
            There is no bibliography in this project yet. Add a .bib file and this drawer
            fills it.
          </Empty>
        ) : nothing && !entries ? (
          <Empty
            action={
              <Button variant="ghost" onClick={() => setChoosing(bib)}>
                Read a folder of PDFs
              </Button>
            }
          >
            Nothing in the bibliography yet. Search by title or author, paste a DOI from a
            paper&rsquo;s page, or read a folder of PDFs and let NextTex find their records.
          </Empty>
        ) : null}
      </div>
      {bib && (!nothing || settled) ? (
        // Reading a folder is the heading's button; the foot is the check.
        <div className="nx-panel-foot">
          <Button
            size="inline"
            className="!h-auto min-h-[24px] !whitespace-normal py-[2px] text-left"
            data-testid="papers-verify"
            disabled={checking}
            onClick={() => void check()}
          >
            {checking ? "Checking…" : "Check the bibliography against its records"}
          </Button>
        </div>
      ) : null}
      {choosing ? (
        <Suspense fallback={null}>
          <PapersChooser
            bibName={choosing}
            onClose={() => setChoosing(null)}
            onStarted={() => setChoosing(null)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
