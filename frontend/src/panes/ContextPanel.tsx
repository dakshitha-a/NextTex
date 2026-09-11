import { useEffect, useRef, useState } from "react";
import api from "../api";
import { get, refreshContext, set, useStore } from "../store";
import { Chevron } from "../chrome";
import { agentName } from "../agent-name";

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
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"style" | "voice" | "source">("style");
  const input = useRef<HTMLInputElement | null>(null);

  // The welcome message's buttons land here: open the panel, aim the file
  // picker at the right kind, and let the writer pick a file.
  useEffect(() => {
    if (!openFor) return;
    setOpen(true);
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
  useEffect(() => {
    const projectId = get().projectId;
    if (!open || !projectId) return;
    api.memory(projectId).then(setMemory).catch(() => undefined);
  }, [open, documents]);

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
    <div className="shrink-0 border-t border-line">
      <button
        className="flex h-[26px] w-full items-center justify-between px-[10px] transition-colors duration-[90ms] hover:bg-surface-2"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="t-micro text-ink-2">
          What {name} reads {documents.length ? `(${documents.length})` : ""}
        </span>
        <span className={`text-ink-3 ${open ? "rotate-180" : ""}`}>
          <Chevron direction="down" />
        </span>
      </button>
      {open ? (
        <div className="px-[10px] pb-[8px]">
          {/* First, because it is the one thing here the writer dictated
              rather than uploaded -- and the only way to reach it: the
              folder it lives in is hidden from the file list. */}
          <div className="mt-2">
            <div className="flex items-center justify-between">
              <span className="t-micro text-ink-2">What {name} remembers</span>
              {editing === null ? (
                <button
                  className="quiet t-micro"
                  data-testid="memory-edit"
                  onClick={() => setEditing(memory?.text ?? "")}
                >
                  Edit
                </button>
              ) : (
                <span className="t-micro text-ink-3">Editing</span>
              )}
            </div>
            {editing === null ? (
              memory?.notes.length ? (
                // The notes, not the file: its heading is scaffolding, and
                // showing it made the panel read as a document rather than
                // as a list of things that were said.
                <ul className="t-meta text-ink-2" data-testid="memory-text">
                  {memory.notes.map((note, index) => (
                    <li key={index} className="mt-[2px] flex gap-[6px]">
                      <span className="text-ink-3">·</span>
                      <span className="min-w-0">{note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="t-meta text-ink-3">
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
                  <button
                    className="ghost-button h-[26px] px-3 t-ui"
                    data-testid="memory-save"
                    onClick={saveMemory}
                  >
                    Save
                  </button>
                  <button
                    className="quiet t-micro"
                    onClick={() => setEditing(null)}
                  >
                    Discard
                  </button>
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
              <div key={entry.key} className="mt-2">
                <div className="flex items-center justify-between">
                  <span className="t-micro text-ink-2">{entry.label}</span>
                  <button
                    className="quiet t-micro"
                    onClick={() => {
                      setKind(entry.key);
                      input.current?.click();
                    }}
                  >
                    Add
                  </button>
                </div>
                {mine.length === 0 ? (
                  <p className="t-meta text-ink-3">{entry.hint(name)}</p>
                ) : (
                  mine.map((document) => (
                    <div
                      key={document.id}
                      className="group flex items-center gap-2 rounded-[3px] px-1 hover:bg-surface-2"
                    >
                      <span className="t-code-sm min-w-0 flex-1 truncate text-ink">
                        {document.filename}
                      </span>
                      <button
                        className="t-micro text-ink-3 opacity-0 hover:text-error focus:opacity-100 group-hover:opacity-100"
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
                  ))
                )}
                {stale.includes(entry.key) ? (
                  <button
                    className="quiet t-micro mt-1 text-pen"
                    onClick={() => {
                      const projectId = get().projectId;
                      if (projectId) api.distill(projectId, entry.key);
                    }}
                  >
                    Read these now
                  </button>
                ) : null}
              </div>
            );
          })}
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
