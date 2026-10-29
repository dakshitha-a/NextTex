import api from "./api";

/** The templates a new project can start from, and the guides to the
 *  venues NextTex cannot ship, as `GET /api/templates` answers them.
 *
 *  The server sends them in the chooser's order, each template's
 *  `template.toml` saying where it falls: the article, the report, the
 *  talk, the letter, the job application and the reply first, then the
 *  venues.  `missing` is the TeX Live packages this TeX lacks, `null` when
 *  there is no way to tell, which a row treats as nothing missing. */
export type Kind = "general" | "journal" | "conference" | "thesis" | "talk" | "letter";

export type TemplateInfo = {
  name: string;
  title: string;
  kind: Kind;
  venue: string;
  summary: string;
  class: string;
  source: string;
  missing: string[] | null;
};

export type GuideInfo = {
  name: string;
  title: string;
  kind: Kind;
  venue: string;
  official: string;
  steps: string[];
};

/** Each kind's name on screen, as the list's group headings and the
 *  browser's filter chips, in the order the groups come: the everyday
 *  kinds first, since the six templates most projects start from are in
 *  them, then the venues. */
export const KINDS: { kind: Kind; label: string }[] = [
  { kind: "general", label: "Articles and reports" },
  { kind: "talk", label: "Talks" },
  { kind: "letter", label: "Letters and CVs" },
  { kind: "conference", label: "Conferences" },
  { kind: "journal", label: "Journals" },
  { kind: "thesis", label: "Theses" },
];

/** Whether a template or a guide matches what was typed: every word has
 *  to appear in its title, venue, class or summary, case regardless, the
 *  projects filter's rule, so `ieee journal` finds the one and not the
 *  conference paper. */
export function matchesTemplate(
  item: { title: string; venue: string; class?: string; summary?: string; name: string },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [item.title, item.venue, item.class ?? "", item.summary ?? "", item.name]
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export type Group = { kind: Kind; label: string; templates: TemplateInfo[]; guides: GuideInfo[] };

/** The list the browser draws: one group per kind that has anything
 *  left after the query and the chosen kinds, in `KINDS` order, each
 *  template in the server's order and each kind's guides after its
 *  templates.  No chosen kind means every kind. */
export function groupTemplates(
  templates: TemplateInfo[],
  guides: GuideInfo[],
  query: string,
  kinds: ReadonlySet<Kind>,
): Group[] {
  const shown = (kind: Kind) => kinds.size === 0 || kinds.has(kind);
  return KINDS.filter(({ kind }) => shown(kind))
    .map(({ kind, label }) => ({
      kind,
      label,
      templates: templates.filter((t) => t.kind === kind && matchesTemplate(t, query)),
      guides: guides.filter((g) => g.kind === kind && matchesTemplate(g, query)),
    }))
    .filter((group) => group.templates.length + group.guides.length > 0);
}

/** What the create button says: the one verb when the TeX has what the
 *  template needs, both when NextTex has to install something first. */
export function createLabel(template: TemplateInfo | undefined): string {
  const missing = template?.missing ?? [];
  if (!missing.length) return "Create project";
  if (missing.length === 1) return `Install ${missing[0]} and create`;
  return `Install ${missing.length} packages and create`;
}


/** Load a template into a project and install what this TeX lacks for it,
 *  in one manager run.  Every way in goes through here: the New project
 *  sheet, the empty page's button and the agent column's action, which
 *  until 29 October 2026 loaded the template alone, so on a fresh TinyTeX
 *  the article's first build stopped on parskip and the Build drawer
 *  offered the packages one at a time.  Answers the sentence to show when
 *  something did not happen, or null; the template is kept either way. */
export async function loadTemplateWithNeeds(
  id: string,
  name = "basic",
  onInstalling: (packages: string[] | null) => void = () => undefined,
): Promise<string | null> {
  let missing: string[];
  try {
    missing = (await api.loadTemplate(id, name)).missing ?? [];
  } catch (problem: any) {
    return `The template did not load: ${problem.message}`;
  }
  return installNeeds(id, missing, onInstalling);
}

/** Install a template's missing packages in one run; the sentence to show
 *  when they did not install, or null. */
export async function installNeeds(
  id: string,
  missing: string[],
  onInstalling: (packages: string[] | null) => void = () => undefined,
): Promise<string | null> {
  if (!missing.length) return null;
  const named = missing.join(", ");
  onInstalling(missing);
  try {
    const result = await api.texInstallAll(id, missing);
    return result.ok ? null : `${named} did not install: ${result.err}`;
  } catch (problem: any) {
    return `${named} did not install: ${problem.message}`;
  } finally {
    onInstalling(null);
  }
}
