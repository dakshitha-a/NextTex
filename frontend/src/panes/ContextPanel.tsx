import { useEffect, useRef, useState } from "react";
import api from "../api";
import { get, refreshContext, set, useStore } from "../store";
import { Button } from "../ui/Button";
import { DocIcon } from "../ui/icons";
import { agentName } from "../agent-name";
import type { PromptEntry } from "./slash-prompts";

const KINDS: {
  key: "style" | "voice" | "source";
  label: string;
  hint: (name: string) => string;
}[] = [
  {
    key: "style",
    label: "Template and formatting",
    hint: (name) => `A handbook, a style guide, a template ${name} must follow.`,
  },
  {
    key: "voice",
    label: "Writing voice",
    hint: () => "Papers or chapters you wrote, so new prose sounds like yours.",
  },
  {
    key: "source",
    label: "Background reading",
    hint: () => "Sources to draw on. Never copied: read and cited.",
  },
];

export default function ContextPanel({
  openFor,
  onHandled,
}: {
  openFor?: "style" | "voice" | null;
  onHandled?: () => void;
} = {}) {
  const documents = useStore((s) => s.contextDocs);
  const name = agentName(useStore((s) => s.agent?.provider));
  const stale = useStore((s) => s.contextStale);
  // A view of the Claude column now, always open while it is up: the
  // column's header carries its title and the way back.
  const shown = true;
  const [kind, setKind] = useState<"style" | "voice" | "source">("style");
  const input = useRef<HTMLInputElement | null>(null);

  // The welcome message's buttons land here: open the panel, aim the file
  // picker at the right kind, and let the writer pick a file.
  useEffect(() => {
    if (!openFor) return;
    setKind(openFor);
    const timer = window.setTimeout(() => {
      input.current?.click();
      onHandled?.();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [openFor, onHandled]);

  // What the agent has been told to remember.  Fetched when the panel is
  // opened rather than on mount: most sessions never look at it.
  const [memory, setMemory] = useState<{
    text: string;
    notes: string[];
    limit: number;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const projectId = useStore((s) => s.projectId);
  useEffect(() => {
    if (!shown || !projectId) return;
    api.memory(projectId).then(setMemory).catch(() => undefined);
    // Keyed on the project as well. Without it, opening another project
    // with this panel already open showed the previous project's memory,
    // because neither `open` nor `documents` had changed.
  }, [shown, documents, projectId]);

  // The reusable prompts a `/` in the composer names: the two that ship
  // and the project's own under `prompts/`. Fetched with the memory, and
  // again when the tree changes, since a copy or an edit to a prompt file
  // is what changes the list.
  const tree = useStore((s) => s.tree);
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  useEffect(() => {
    if (!shown || !projectId) return;
    let live = true;
    api
      .prompts(projectId)
      .then((answer) => {
        if (live) setPrompts(answer.prompts);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [shown, projectId, tree]);

  const copyPrompt = async (name: string) => {
    const projectId = get().projectId;
    if (!projectId) return;
    try {
      await api.copyPrompt(projectId, name);
      setPrompts((await api.prompts(projectId)).prompts);
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  const saveMemory = async () => {
    const projectId = get().projectId;
    if (!projectId || editing === null) return;
    try {
      setMemory(await api.setMemory(projectId, editing));
      setEditing(null);
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  const upload = async (files: File[]) => {
    const projectId = get().projectId;
    if (!projectId || !files.length) return;
    try {
      await api.uploadContext(projectId, kind, "", files);
      await refreshContext(projectId);
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="context-panel">
      {shown ? (
        <div className="min-h-0 flex-1 overflow-auto pb-[10px]">
          {/* First, because it is the one thing here the writer dictated
              rather than uploaded, and the only way to reach it: the
              folder it lives in is hidden from the file list. */}
          <div className="nx-reads-sec">
            <div className="nx-reads-title">
              <span>What {name} remembers</span>
              {editing === null ? (
                <Button
                  variant="quiet"
                  size="inline"
                  className="ml-auto"
                  data-testid="memory-edit"
                  onClick={() => setEditing(memory?.text ?? "")}
                >
                  Edit
                </Button>
              ) : (
                <span className="nx-reads-hint ml-auto">Editing</span>
              )}
            </div>
            {editing === null ? (
              memory?.notes.length ? (
                // The notes, not the file: its heading is scaffolding, and
                // showing it made the panel read as a document rather than
                // as a list of things that were said.
                <ul className="nx-reads-memory" data-testid="memory-text">
                  {memory.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="nx-reads-hint">
                  Nothing yet. Ask {name} to remember something, or write it
                  here yourself.
                </p>
              )
            ) : (
              <>
                <textarea
                  // No resize grip: Chrome draws its own diagonal handle,
                  // which is the one piece of unthemed browser chrome in
                  // the rail.
                  className="t-ui mt-1 w-full resize-none rounded-[3px] border border-line bg-surface-2 p-2 text-ink outline-none focus:border-pen"
                  rows={6}
                  autoFocus
                  data-testid="memory-editor"
                  value={editing}
                  onChange={(event) => setEditing(event.target.value)}
                />
                <div className="mt-1 flex items-center gap-2">
                  <Button variant="ghost" data-testid="memory-save" onClick={saveMemory}>
                    Save
                  </Button>
                  <Button variant="quiet" onClick={() => setEditing(null)}>
                    Discard
                  </Button>
                  <span className="flex-1" />
                  <span
                    className={`t-micro tabular-nums ${
                      memory && editing.length > memory.limit * 0.9
                        ? "text-warn"
                        : "text-ink-3"
                    }`}
                  >
                    {editing.length} / {memory?.limit ?? 4000}
                  </span>
                </div>
              </>
            )}
          </div>
          {KINDS.map((entry) => {
            const mine = documents.filter((item) => item.kind === entry.key);
            return (
              <div key={entry.key} className="nx-reads-sec">
                <div className="nx-reads-title">
                  <span>{entry.label}</span>
                  <Button
                    variant="quiet"
                    size="inline"
                    className="ml-auto"
                    onClick={() => {
                      setKind(entry.key);
                      input.current?.click();
                    }}
                  >
                    Add
                  </Button>
                </div>
                <p className="nx-reads-hint">{entry.hint(name)}</p>
                {mine.map((document) => (
                  <div key={document.id} className="nx-reads-file">
                    <DocIcon />
                    <span className="min-w-0 flex-1 truncate">{document.filename}</span>
                    <button
                      className="nx-reads-x"
                      onClick={async () => {
                        const projectId = get().projectId;
                        if (!projectId) return;
                        await api.removeContext(projectId, document.id);
                        refreshContext(projectId);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {stale.includes(entry.key) ? (
                  <Button
                    variant="quiet"
                    size="inline"
                    className="mt-1 !text-pen"
                    onClick={() => {
                      const projectId = get().projectId;
                      if (projectId) api.distill(projectId, entry.key);
                    }}
                  >
                    Read these now
                  </Button>
                ) : null}
              </div>
            );
          })}
          {/* Last, because a prompt is the one thing here the writer
              types rather than uploads: `/review friendly` in the composer
              is this list. A built-in lives inside NextTex; copying it
              puts `prompts/<name>.md` in the project, where the group can
              edit it and version control can carry it, and the copy is
              the one used. */}
          <div className="nx-reads-sec" data-testid="prompts-list">
            <div className="nx-reads-title">
              <span>Reusable prompts</span>
              <span className="nx-reads-hint ml-auto">prompts/</span>
            </div>
            {prompts.length === 0 ? (
              <p className="nx-reads-hint">
                Type / in the box to use one. A Markdown file in prompts/ is
                one more.
              </p>
            ) : (
              prompts.map((prompt) => (
                <div
                  key={prompt.name}
                  className="nx-reads-file"
                  data-testid="prompt-entry"
                  data-source={prompt.source}
                  title={prompt.hint}
                >
                  <DocIcon />
                  <span className="t-code-sm min-w-0 flex-1 truncate text-ink">
                    /{prompt.said}
                  </span>
                  {prompt.source === "project" ? (
                    <span className="nx-reads-x" data-always>this project&rsquo;s</span>
                  ) : (
                    <button
                      className="nx-reads-x"
                      data-always
                      data-testid="prompt-copy"
                      onClick={() => copyPrompt(prompt.name)}
                    >
                      Copy to project
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              upload(files);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
