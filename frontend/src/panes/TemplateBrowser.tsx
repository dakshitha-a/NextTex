import { useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { ChipToggle, Empty, ExternalLink, Field, Pressable } from "../ui/controls";
import { CheckIcon, SearchIcon } from "../ui/icons";
import {
  KINDS,
  groupTemplates,
  type GuideInfo,
  type Kind,
  type TemplateInfo,
} from "../templates";

/** The New project sheet's body while the writer is choosing what to
 *  start from: a field over a list grouped by kind, with chips to narrow
 *  it to some kinds.  A template is chosen in one press and the sheet
 *  goes back to its form; a guide is a venue NextTex cannot ship, and
 *  opens in place to say how to get it, with the publisher's page.
 *
 *  Escape is the field's first, clearing what was typed, and the
 *  browser's next, going back to the form; it never reaches the sheet,
 *  which would close and lose the name and folder already typed. */
export function TemplateBrowser({
  templates,
  guides,
  chosen,
  onChoose,
  onBack,
}: {
  templates: TemplateInfo[];
  guides: GuideInfo[];
  chosen: string;
  onChoose: (name: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(new Set());
  const [opened, setOpened] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const groups = useMemo(
    () => groupTemplates(templates, guides, query, kinds),
    [templates, guides, query, kinds],
  );
  // Only the kinds something is filed under, so a chip never empties
  // the list on an install whose templates were trimmed.
  const present = KINDS.filter(({ kind }) =>
    templates.some((t) => t.kind === kind) || guides.some((g) => g.kind === kind),
  );
  const toggle = (kind: Kind, on: boolean) => {
    const next = new Set(kinds);
    if (on) next.add(kind);
    else next.delete(kind);
    setKinds(next);
  };

  return (
    <div
      className="nx-template-browser"
      data-testid="template-browser"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (query && document.activeElement === field.current) setQuery("");
        else onBack();
      }}
    >
      <Field
        ref={field}
        autoFocus
        frameClassName="w-full"
        leading={<SearchIcon />}
        value={query}
        placeholder="Find a template, a journal or a conference"
        aria-label="Find a template"
        data-testid="template-find"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = groups.find((group) => group.templates.length)?.templates[0];
          if (first) onChoose(first.name);
        }}
      />
      <div className="nx-template-kinds" role="group" aria-label="Kinds of template">
        {present.map(({ kind, label }) => (
          <ChipToggle
            key={kind}
            pressed={kinds.has(kind)}
            data-testid={`template-kind-${kind}`}
            onChange={(on) => toggle(kind, on)}
          >
            {label}
          </ChipToggle>
        ))}
      </div>
      <div className="nx-template-list" data-testid="template-list">
        {groups.length === 0 ? <Empty>Nothing matches.</Empty> : null}
        {groups.map((group) => (
          <section key={group.kind} aria-label={group.label}>
            <div className="nx-template-group t-meta">{group.label}</div>
            {group.templates.map((template) => {
              const on = template.name === chosen;
              const missing = template.missing ?? [];
              return (
                <Pressable
                  key={template.name}
                  className="nx-template-row"
                  aria-pressed={on}
                  data-testid={`template-${template.name}`}
                  onClick={() => onChoose(template.name)}
                >
                  <span className="nx-template-mark">{on ? <CheckIcon /> : null}</span>
                  <span className="nx-template-text">
                    <span className="nx-template-title">{template.title}</span>
                    <span className="nx-template-line text-small">
                      {template.venue ? `${template.venue} · ${template.class}` : template.summary}
                    </span>
                  </span>
                  {missing.length ? (
                    <span className="nx-template-needs t-meta">Installs {missing[0]}</span>
                  ) : null}
                </Pressable>
              );
            })}
            {group.guides.length ? (
              <div className="nx-template-group nx-template-subgroup t-meta">
                Get these from their publishers
              </div>
            ) : null}
            {group.guides.map((guide) => {
              const open = opened === guide.name;
              return (
                <div key={guide.name} className="nx-template-guide" data-testid={`guide-${guide.name}`}>
                  <div className="nx-template-guide-head">
                    <span className="nx-template-mark" />
                    <span className="nx-template-text">
                      <span className="nx-template-title">{guide.title}</span>
                      <span className="nx-template-line text-small">{guide.venue}</span>
                    </span>
                    <Button
                      variant="quiet"
                      size="sm"
                      aria-expanded={open}
                      data-testid={`guide-${guide.name}-how`}
                      onClick={() => setOpened(open ? null : guide.name)}
                    >
                      {open ? "Hide the steps" : "How to get it"}
                    </Button>
                  </div>
                  {open ? (
                    <div className="nx-template-steps">
                      <ol className="text-small">
                        {guide.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <ExternalLink href={guide.official} className="text-small">
                        Open the official page
                      </ExternalLink>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
