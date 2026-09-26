import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Empty, Field, Pressable, Switch } from "../ui/controls";
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
 *  The three venue facts, the page limit, whether the review is blind and
 *  whether the venue wants PDF/A, are set here rather than on the
 *  settings sheet because they are read here, and they go into
 *  `nexttex.toml` so a co-author's check agrees.
 */

type Group = { kind: string; title: string; rows: SubmitFinding[] };

/** The order the groups are drawn in: what a reviewer notices first. */
const ORDER = [
  "pages", "blind", "pdfa", "undefined", "missing", "font", "image", "metadata", "alt",
  "today", "todo", "duplicate-label", "overfull", "commented", "uncited", "unused-label",
  "tool",
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
  // Always shown: the drawer holds it.
  const shown = true;
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
    if (shown && report) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  // The venue facts change the list, and the settings sheet or a
  // co-author may have changed them: re-check when they do.
  useEffect(() => {
    if (shown && report) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.blind, settings.pageLimit, settings.pdfa]);

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
  const missingTools = tools && (!tools.pdffonts || !tools.pdfimages);

  // The drawer as the page draws it: empty, one sentence and Check;
  // checked, the line with Check again, Copy all and what was read, the
  // two venue facts as lines, then the groups with their counts and the
  // findings on the grid with the severity bar, the message and the
  // place in the mono.
  const facts = (
    <>
      <div className="nx-line">
        <label htmlFor="submit-page-limit">Page limit</label>
        <span className="flex-1" />
        <Field
          id="submit-page-limit"
          data-testid="submit-page-limit"
          inputMode="numeric"
          value={limitDraft}
          placeholder="none"
          frameClassName="w-18 !h-7"
          className="text-right"
          onChange={(event) => setLimitDraft(event.target.value.replace(/[^0-9]/g, ""))}
          onBlur={saveLimit}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="nx-line">
        <span>Blind review</span>
        <span className="flex-1" />
        <Switch
          checked={settings.blind}
          data-testid="submit-blind"
          aria-label="Blind review"
          onChange={(blind) => {
            if (!projectId) return;
            void api.setProjectSettings(projectId, { blind }).catch(
              (error: any) => set({ error: error.message }),
            );
          }}
        />
      </div>
      <div className="nx-line">
        <span>Wants PDF/A</span>
        <span className="flex-1" />
        <Switch
          checked={settings.pdfa}
          data-testid="submit-pdfa"
          aria-label="Wants PDF/A"
          onChange={(pdfa) => {
            if (!projectId) return;
            void api.setProjectSettings(projectId, { pdfa }).catch(
              (error: any) => set({ error: error.message }),
            );
          }}
        />
      </div>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-1" data-testid="submit-panel">
      <div className="min-h-0 flex-1 overflow-auto" data-testid="submit-body">
        {report ? (
          <div className="nx-line">
            <Button
              variant="ghost"
              size="inline"
              data-testid="submit-check"
              disabled={checking || !projectId}
              onClick={() => void check()}
            >
              {checking ? "Checking…" : "Check again"}
            </Button>
            <Button
              size="inline"
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
            </Button>
          </div>
        ) : (
          <Empty
            action={
              <Button
                variant="ghost"
                data-testid="submit-check"
                disabled={checking || !projectId}
                onClick={() => void check()}
              >
                {checking ? "Checking…" : "Check"}
              </Button>
            }
          >
            Reads the last build and the sources for what a venue would send back:
            undefined references, a <span className="t-code-sm">\today</span>, a note
            to self, a font that is not embedded, a figure at screen resolution.
          </Empty>
        )}
        {report ? (
          // On its own line: beside the two buttons it truncated at the
          // drawer's width, and what was read is worth the whole line.
          <p className="nx-note" data-testid="submit-headline">
            {headline(report) || "No build to read"}
          </p>
        ) : null}
        {said ? (
          <p className="nx-note !text-warn" data-testid="submit-said">{said}</p>
        ) : null}
        {facts}
        {missingTools ? (
          <p className="nx-note">
            Fonts and image resolution need pdffonts and pdfimages, which come with
            poppler-utils; they are not installed here.
          </p>
        ) : null}

        {report && groups.length ? (
          <div data-testid="submit-groups">
            {groups.map((group) => (
              <div key={group.kind} data-kind={group.kind}>
                <div className="nx-group">
                  <span>{group.title}</span>
                  <span className="nx-group-count">{group.rows.length}</span>
                </div>
                <ul>
                  {group.rows.map((row, index) => {
                    const key = `${group.kind}:${row.file ?? ""}:${row.line ?? ""}:${row.page ?? ""}:${index}`;
                    const isOpen = expanded === key;
                    const where = row.file
                      ? `${row.file.split("/").pop()}:${row.line ?? ""}`
                      : row.page ? `p. ${row.page}` : "";
                    return (
                      <li key={key}>
                        <Pressable
                          className="nx-find"
                          data-testid="submit-row"
                          data-kind={row.kind}
                          data-severity={row.severity}
                          data-open={isOpen || undefined}
                          aria-expanded={isOpen}
                          onClick={() => {
                            setExpanded(isOpen ? null : key);
                            if (row.file && row.line) onJump(row.file, row.line);
                            else if (row.page) onPage(row.page);
                          }}
                        >
                          <span className="nx-find-bar" />
                          <span className="nx-find-text">{row.message}</span>
                          {where ? <span className="nx-find-loc">{where}</span> : <span />}
                          {isOpen && row.explain ? (
                            <span className="nx-find-why">
                              {row.explain.detail}{" "}
                              <b>What to do:</b> {row.explain.fix}
                            </span>
                          ) : null}
                        </Pressable>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : report ? (
          <p className="nx-note" data-testid="submit-clean">
            Nothing a venue would send back.
          </p>
        ) : null}
      </div>
    </div>
  );
}
