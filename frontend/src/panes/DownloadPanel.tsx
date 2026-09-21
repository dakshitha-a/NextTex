import { useMemo } from "react";
import { useStore, type DocBuild } from "../store";
import { ChipButton } from "../ui/controls";
import { EXPORTS, downloadExport, downloadPdf, downloadZip, stemOf } from "../chrome";

/** The Download drawer: every copy the project can give, in one place.
 *
 *  It was a menu under a button in the title bar, and the writer asked
 *  for it on the bar: "make the download button ... a part of the side
 *  launcher", and "have the download drawer auto populate with the docs
 *  as they are created".  As the direction page draws it: the whole
 *  project with its file count and size and a .zip chip; then Documents,
 *  one block per document with its name, a line saying how many pages it
 *  has and how long it took, or that it is not built yet, and a chip per
 *  format.  A document is every .tex with a \\documentclass of its own,
 *  from the store's `previews` and `candidates`, which the tree's scan
 *  keeps current, so a new one appears as soon as it is saved.  Word,
 *  HTML and Markdown come through pandoc and are offered only where the
 *  machine has it.  A document that has not been built yet has its chips
 *  waiting, outlined, since the PDF does not exist and the exports read
 *  the same source a build would; previewing it builds it.
 */
export default function DownloadPanel() {
  const projectId = useStore((s) => s.projectId) ?? "";
  const previews = useStore((s) => s.previews);
  const candidates = useStore((s) => s.candidates);
  const builds = useStore((s) => s.builds);
  const tree = useStore((s) => s.tree);
  const pandoc = useStore((s) => s.tools?.pandoc === true);
  const documents = useMemo(
    () => [...previews, ...candidates.filter((path) => !previews.includes(path))],
    [previews, candidates],
  );
  const whole = useMemo(() => countFiles(tree), [tree]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="download-panel">
      <div className="nx-doc" data-testid="download-row">
        <div className="nx-doc-name">
          Whole project
          {whole.files ? (
            <span className="nx-doc-meta">
              {whole.files} {whole.files === 1 ? "file" : "files"}{whole.bytes ? `, ${sizeOf(whole.bytes)}` : ""}
            </span>
          ) : null}
        </div>
        <div className="nx-doc-chips">
          <ChipButton
            title="The whole project as a zip"
            data-testid="download-zip"
            tone="surface"
            onClick={() => projectId && void downloadZip(projectId)}
          >
            .zip
          </ChipButton>
        </div>
      </div>
      {documents.length ? <div className="nx-drawer-label">Documents</div> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {documents.map((path) => {
          const build: DocBuild | undefined = builds[path];
          const built = Boolean(build?.result?.pdf || build?.pdfStamp);
          return (
            <div key={path} className="nx-doc" data-testid="download-row" data-document={path} data-built={built ? "true" : undefined}>
              <div className="nx-doc-name" title={path}>
                {stemOf(path)}
                <span className="nx-doc-meta">{buildWords(build)}</span>
              </div>
              <div className="nx-doc-chips">
                <ChipButton
                  title={built ? `${path} typeset` : "Preview this document to build it first"}
                  data-testid="download-pdf"
                  data-document={path}
                  tone="surface"
                  disabled={!built}
                  onClick={() => projectId && void downloadPdf(projectId, path)}
                >
                  .pdf
                </ChipButton>
                {pandoc
                  ? EXPORTS.map((entry) => (
                      <ChipButton
                        key={entry.format}
                        title={built ? `${path} as ${entry.says}` : "Preview this document to build it first"}
                        data-testid="download-export"
                        data-document={path}
                        data-format={entry.format}
                        tone="surface"
                        disabled={!built}
                        onClick={() => projectId && void downloadExport(projectId, path, entry.format)}
                      >
                        {entry.suffix}
                      </ChipButton>
                    ))
                  : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="nx-note">
        Every .tex with a \documentclass of its own is a document; a new one
        appears here as soon as it is saved.{pandoc ? " Word, HTML and Markdown come through pandoc." : ""}
      </p>
    </div>
  );
}

/** "12 pages, built 0.7 s", or what is true instead. */
function buildWords(build: DocBuild | undefined): string {
  if (!build) return "not built yet";
  if (build.compiling && !build.result) return "building";
  const result = build.result;
  if (!result) return "not built yet";
  const pages = result.pages ? `${result.pages} ${result.pages === 1 ? "page" : "pages"}, ` : "";
  if (result.outcome !== "ok" && !result.pdf) return `${pages}build failed`;
  return `${pages}built ${(result.durationMs / 1000).toFixed(1)} s`;
}

function countFiles(tree: { type: string; size?: number; children?: any[] } | null): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (node: { type: string; size?: number; children?: any[] }) => {
    if (node.type === "file") {
      files += 1;
      bytes += node.size ?? 0;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (tree) walk(tree);
  return { files, bytes };
}

/** "18 MB", "412 kB": one figure, since the line is a glance. */
function sizeOf(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} kB`;
  return `${bytes} B`;
}
