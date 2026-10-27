/** What a citation opens, from its hover card or its entry on the page.
 *
 *  The paper itself when it is a PDF on disk: one in the project opens in a
 *  tab, where every PDF in the project already opens, and one outside it,
 *  in Zotero's storage say, opens in a browser tab of its own, served by its
 *  key. Without a PDF, the paper's page on the web: its DOI, else its arXiv
 *  abstract, else the entry's own address. Without any of those, nothing,
 *  and the card shows no button for it.
 *
 *  Which PDF is which key's paper is the server's answer, kept in the store
 *  as `paperPdfs`; see `nexttex/paperpdfs.py` for how it is found. */

import { paperPdfUrl, type PaperLink, type Symbols } from "./api";
import { get, handlers } from "./store";

type Citation = Pick<Symbols["citations"][number], "doi" | "arxiv" | "url">;

export type PaperAction =
  | { kind: "tab"; path: string; label: string; shown: string }
  | { kind: "web"; url: string; label: string; shown?: string };

/** The action for a key, or null when there is nothing to open. Pure, so
 *  the card's and the page's choice can be tested without either. */
export function paperAction(
  key: string,
  citation: Citation | undefined,
  link: PaperLink | undefined,
  projectId: string | null,
): PaperAction | null {
  if (link && link.where === "project") {
    return { kind: "tab", path: link.path, label: "Open PDF", shown: link.path };
  }
  if (link && projectId) {
    return { kind: "web", url: paperPdfUrl(projectId, key), label: "Open PDF", shown: link.path };
  }
  const doi = citation?.doi?.trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "");
  if (doi) return { kind: "web", url: `https://doi.org/${doi}`, label: "Open DOI page" };
  if (citation?.arxiv) return { kind: "web", url: `https://arxiv.org/abs/${citation.arxiv}`, label: "Open arXiv page" };
  if (citation?.url && /^https?:\/\//i.test(citation.url)) return { kind: "web", url: citation.url, label: "Open web page" };
  return null;
}

/** The project's citations by key, as the editor last read them, for the
 *  preview, which holds no symbol table of its own. */
let known = new Map<string, Citation>();

export function rememberCitations(list: readonly Symbols["citations"][number][]): void {
  known = new Map(list.map((citation) => [citation.key, citation]));
}

/** The action for a key, from what the store holds now. */
export function paperActionFor(key: string, citation: Citation | undefined = known.get(key)): PaperAction | null {
  const state = get();
  return paperAction(key, citation, state.paperPdfs[key], state.projectId);
}

export function openPaper(action: PaperAction): void {
  if (action.kind === "tab") {
    handlers.onOpenFile?.(action.path);
    return;
  }
  window.open(action.url, "_blank", "noopener,noreferrer");
}
