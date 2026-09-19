import { useEffect, useMemo, useState } from "react";
import { Chevron } from "../chrome";
import api, { type SubmitFinding, type SubmitReport } from "../api";
import { set, useStore } from "../store";

/** Before you submit: what a venue would send back, off the last build.
 *
 *  A rail footer section beside the papers and the context.  It reads the
 *  last build's log and PDF and the sources as they are now, and lists
 *  what the drawer never says because none of it stops a build: a
 *  `\today`, a note to self, a duplicate label, an entry nobody cites, a
 *  font that is not embedded, a figure at 75 ppi, and, when the review is
 *  blind, the author block.  Every row that has a place goes there: a
 *  file and line through the editor, a page through the PDF pane.  A row
 *  with neither opens to say what to do.
 *
 *  The two venue facts, the page limit and whether the review is blind,
 *  are set here rather than on the settings sheet because they are read
 *  here, and they go into `nexttex.toml` so a co-author's check agrees.
 */

type Group = { kind: string; title: string; rows: SubmitFinding[] };

/** The order the groups are drawn in: what a reviewer notices first. */
const ORDER = [
  "pages", "blind", "undefined", "missing", "font", "image", "today", "todo",
  "duplicate-label", "overfull", "commented", "uncited", "unused-label", "tool",
];

function grouped(findings: SubmitFinding[]): Group[] {
  const byKind = new Map<string, Group>();
  for (const row of findings) {
    const group = byKind.get(row.kind) ?? {
      kind: row.kind,
      title: row.explain?.title ?? row.kind,
      rows: [],
    };
    group.rows.push(row);
    byKind.set(row.kind, group);
  }
  return [...byKind.values()].sort(
    (a, b) => (ORDER.indexOf(a.kind) + 1 || 99) - (ORDER.indexOf(b.kind) + 1 || 99),
  );
}

/** "12 pages, built 3 minutes ago with pdflatex". */
export function headline(report: SubmitReport, now = Date.now()): string {
  const parts: string[] = [];
  if (report.pages != null) parts.push(`${report.pages} page${report.pages === 1 ? "" : "s"}`);
  if (report.built) {
    const seconds = Math.max(0, Math.round(now / 1000 - report.built));
    const ago =
      seconds < 60 ? "just now"
      : seconds < 3600 ? `${Math.round(seconds / 60)} min ago`
      : seconds < 86400 ? `${Math.round(seconds / 3600)} h ago`
      : `${Math.round(seconds / 86400)} d ago`;
    parts.push(`built ${ago}${report.engine ? ` with ${report.engine}` : ""}`);
  }
  return parts.join(", ");
}

/** The lines Copy all puts on the clipboard: what a mail to a co-author
 *  needs and nothing the panel draws for itself. */
export function asText(report: SubmitReport): string {
  return report.findings
    .map((row) => {
      const where = row.file ? `${row.file}:${row.line ?? 0}: ` : row.page ? `page ${row.page}: ` : "";
      return `${where}${row.message}`;
    })
    .join("\n");
}

export default function SubmitPanel({
  onJump,
  onPage,
}: {
  onJump: (file: string, line: number) => void;
  onPage: (page: number) => void;
}) {
  const projectId = useStore((s) => s.projectId);
  const document = useStore((s) => s.activePreview);
  const settings = useStore((s) => s.settings);
  const stamp = useStore((s) => s.pdfStamp);
  const tools = useStore((s) => s.tools);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<SubmitReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [said, setSaid] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState(String(settings.pageLimit || ""));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLimitDraft(String(settings.pageLimit || ""));
  }, [settings.pageLimit]);

  const check = async () => {
    if (!projectId) return;
    setChecking(true);
    setSaid("");
    try {
      setReport(await api.submitCheck(projectId, document));
    } catch (error: any) {
      setReport(null);
      setSaid(error.message);
    } finally {
      setChecking(false);
    }
  };

  // A new build changes the answer, so an open panel that has checked once
  // checks again when the page redraws; a closed one waits to be opened.
  useEffect(() => {
    if (open && report) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  // The two venue facts change the list, and the settings sheet or a
  // co-author may have changed them: re-check when they do.
  useEffect(() => {
    if (open && report) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.blind, settings.pageLimit]);

  const saveLimit = () => {
    if (!projectId) return;
    const value = limitDraft.trim() === "" ? 0 : Number(limitDraft);
    if (!Number.isInteger(value) || value < 0) {
      setLimitDraft(String(settings.pageLimit || ""));
      return;
    }
    if (value === settings.pageLimit) return;
    void api.setProjectSettings(projectId, { pageLimit: value }).catch((error: any) => {
      set({ error: error.message });
    });
  };

  const groups = useMemo(() => (report ? grouped(report.findings) : []), [report]);
  const errors = report ? report.findings.filter((row) => row.severity === "error").length : 0;
  const missingTools = tools && (!tools.pdffonts || !tools.pdfimages);

  const label = !report
    ? "Before you submit"
    : report.findings.length === 0
      ? "Before you submit · nothing found"
      : `Before you submit · ${report.findings.length}${errors ? ` (${errors} to fix)` : ""}`;

  return (
    <div className="shrink-0 border-t border-line" data-testid="submit-panel">
      <button
        className="flex h-[26px] w-full items-center gap-2 px-[10px] text-left hover:bg-surface-2"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="t-meta min-w-0 flex-1 truncate text-ink-2">{label}</span>
        <span className={`shrink-0 text-ink-3 ${open ? "rotate-90" : ""}`}>
          <Chevron direction="right" />
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-[10px] py-2" data-testid="submit-body">
          <div className="flex items-center gap-2">
            <button
              className="ghost-button h-[22px] px-2 t-micro"
              data-testid="submit-check"
              disabled={checking || !projectId}
              onClick={() => void check()}
            >
              {checking ? "Checking…" : report ? "Check again" : "Check"}
            </button>
            {report ? (
              <button
                className="quiet t-micro"
                data-testid="submit-copy-all"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(asText(report))
                    .then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => undefined);
                }}
              >
                {copied ? "Copied" : "Copy all"}
              </button>
            ) : null}
          </div>
          {report ? (
            <p className="t-meta mt-2 text-ink-2" data-testid="submit-headline">
              {headline(report) || "No build to read"}
            </p>
          ) : (
            <p className="t-micro mt-2 text-ink-3">
              Reads the last build and the sources for what a venue would send back:
              undefined references, a <span className="t-code-sm">\today</span>, a note
              to self, a font that is not embedded, a figure at screen resolution.
            </p>
          )}
          {said ? (
            <p className="t-meta mt-2 text-warn" data-testid="submit-said">{said}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
            <label className="t-micro flex items-center gap-2 text-ink-2" htmlFor="submit-page-limit">
              Page limit
              <input
                id="submit-page-limit"
                data-testid="submit-page-limit"
                inputMode="numeric"
                value={limitDraft}
                placeholder="none"
                className="t-code-sm w-[3.5em] border-b border-line bg-transparent text-right outline-none placeholder:text-ink-3 focus:border-pen"
                onChange={(event) => setLimitDraft(event.target.value.replace(/[^0-9]/g, ""))}
                onBlur={saveLimit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <button
              role="switch"
              aria-checked={settings.blind}
              data-testid="submit-blind"
              className="t-micro flex items-center gap-2 text-ink-2"
              onClick={() => {
                if (!projectId) return;
                void api.setProjectSettings(projectId, { blind: !settings.blind }).catch(
                  (error: any) => set({ error: error.message }),
                );
              }}
            >
              <span
                className={`flex h-[12px] w-[22px] shrink-0 items-center rounded-[3px] border p-[1px] ${
                  settings.blind ? "border-hint bg-hint-wash" : "border-line"
                }`}
              >
                <span
                  className={`h-[8px] w-[8px] rounded-[2px] ${
                    settings.blind ? "ml-auto bg-hint" : "bg-ink-3"
                  }`}
                />
              </span>
              Blind review
            </button>
          </div>
          {missingTools ? (
            <p className="t-micro mt-2 text-ink-3">
              Fonts and image resolution need pdffonts and pdfimages, which come with
              poppler-utils; they are not installed here.
            </p>
          ) : null}

          {report && groups.length ? (
            <div className="mt-3" data-testid="submit-groups">
              {groups.map((group) => (
                <div key={group.kind} className="mb-2" data-kind={group.kind}>
                  <p className="t-micro flex items-baseline gap-2 text-ink-2">
                    <span>{group.title}</span>
                    <span className="text-ink-3 tnum">{group.rows.length}</span>
                  </p>
                  <ul className="mt-1">
                    {group.rows.map((row, index) => {
                      const key = `${group.kind}:${row.file ?? ""}:${row.line ?? ""}:${row.page ?? ""}:${index}`;
                      const isOpen = expanded === key;
                      const bar =
                        row.severity === "error" ? "bg-error"
                        : row.severity === "warning" ? "bg-warn"
                        : "bg-ink-3";
                      const where = row.file
                        ? `${row.file.split("/").pop()}:${row.line ?? ""}`
                        : row.page ? `p. ${row.page}` : "";
                      return (
                        <li key={key} className="relative">
                          <span className={`absolute left-0 top-[6px] h-[12px] w-[3px] ${bar}`} />
                          <button
                            className="flex w-full min-w-0 items-start gap-2 py-[3px] pl-[8px] text-left hover:bg-surface-2"
                            data-testid="submit-row"
                            data-kind={row.kind}
                            aria-expanded={isOpen}
                            onClick={() => {
                              setExpanded(isOpen ? null : key);
                              if (row.file && row.line) onJump(row.file, row.line);
                              else if (row.page) onPage(row.page);
                            }}
                          >
                            <span className="t-meta min-w-0 flex-1 text-ink">{row.message}</span>
                            {where ? (
                              <span className="t-micro shrink-0 text-ink-3 tnum">{where}</span>
                            ) : null}
                          </button>
                          {isOpen && row.explain ? (
                            <div className="ml-[8px] border-l border-line bg-surface-2 px-2 py-1">
                              <p className="t-micro text-ink-2">{row.explain.detail}</p>
                              <p className="t-micro mt-1 text-ink-2">
                                <span className="text-ink-3">What to do: </span>
                                {row.explain.fix}
                              </p>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : report ? (
            <p className="t-meta mt-3 text-ink-2" data-testid="submit-clean">
              Nothing a venue would send back.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
