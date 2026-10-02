import { describe, expect, it } from "vitest";
import { createLabel, groupTemplates, matchesTemplate, type GuideInfo, type TemplateInfo } from "./templates";

const t = (name: string, kind: TemplateInfo["kind"], extra: Partial<TemplateInfo> = {}): TemplateInfo => ({
  name, kind, title: name, venue: "", summary: "", class: "", source: "", missing: [], ...extra,
});
const TEMPLATES = [
  t("basic", "general", { title: "An article" }),
  t("beamer", "talk", { title: "A talk" }),
  t("acm", "conference", { title: "ACM paper", venue: "ACM conferences and journals", class: "acmart" }),
  t("ieee-conference", "conference", { title: "IEEE conference paper", venue: "IEEE conferences", class: "IEEEtran" }),
  t("ieee-journal", "journal", { title: "IEEE journal article", venue: "IEEE journals", class: "IEEEtran" }),
];
const GUIDES: GuideInfo[] = [
  { name: "neurips", title: "NeurIPS", kind: "conference", venue: "Neural Information Processing Systems", official: "https://neurips.cc", steps: ["Get it."] },
];

describe("the template browser's list", () => {
  it("groups by kind, the everyday kinds first, guides after their kind's templates", () => {
    const groups = groupTemplates(TEMPLATES, GUIDES, "", new Set());
    expect(groups.map((g) => g.label)).toEqual(["Articles and reports", "Talks", "Conferences", "Journals"]);
    const conferences = groups[2];
    expect(conferences.templates.map((x) => x.name)).toEqual(["acm", "ieee-conference"]);
    expect(conferences.guides.map((x) => x.name)).toEqual(["neurips"]);
  });

  it("needs every word typed, in the title, the venue or the class", () => {
    expect(groupTemplates(TEMPLATES, GUIDES, "ieee journal", new Set()).flatMap((g) => g.templates.map((x) => x.name)))
      .toEqual(["ieee-journal"]);
    expect(matchesTemplate(TEMPLATES[2], "acmart")).toBe(true);
    expect(matchesTemplate(GUIDES[0], "neural")).toBe(true);
    expect(groupTemplates(TEMPLATES, GUIDES, "nothing like it", new Set())).toEqual([]);
  });

  it("narrows to the chosen kinds, and to every kind when none is chosen", () => {
    const groups = groupTemplates(TEMPLATES, GUIDES, "", new Set(["journal", "talk"]));
    expect(groups.map((g) => g.kind)).toEqual(["talk", "journal"]);
  });
});

describe("the create button", () => {
  it("names the one verb when nothing is missing, or when nobody can tell", () => {
    expect(createLabel(TEMPLATES[0])).toBe("Create project");
    expect(createLabel({ ...TEMPLATES[2], missing: null })).toBe("Create project");
    expect(createLabel(undefined)).toBe("Create project");
  });

  it("names the install too when the TeX lacks the class", () => {
    expect(createLabel({ ...TEMPLATES[2], missing: ["acmart"] })).toBe("Install acmart and create");
    expect(createLabel({ ...TEMPLATES[2], missing: ["acmart", "totpages"] })).toBe("Install 2 packages and create");
  });
});
