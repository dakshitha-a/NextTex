import { useEffect, useState } from "react";
import api, { startDownload, type ProjectSummary } from "../api";

/** The project list.  Downloads live here as well as inside an open project:
 *  the moment a copy is most wanted is often before opening anything. */
export default function Projects({
  onOpen,
  onClose,
  canClose,
}: {
  onOpen: (id: string) => void;
  onClose?: () => void;
  canClose: boolean;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"add" | "create">("create");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const result = await api.projects();
      setProjects(result.projects);
    } catch (problem: any) {
      setError(problem.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    if (!path.trim()) return;
    setError(null);
    try {
      const project =
        mode === "create"
          ? await api.createProject(path.trim(), newName.trim())
          : await api.addProject(path.trim());
      setPath("");
      setNewName("");
      await refresh();
      if (project.id) onOpen(project.id);
    } catch (problem: any) {
      setError(problem.message);
    }
  };

  const takePdf = async (project: ProjectSummary) => {
    if (!project.id) return;
    setBusy(project.id);
    setError(null);
    try {
      // The PDF may need building first, so this is a fetch rather than a
      // plain link: a failed build should say why, not download an error.
      const response = await fetch(
        api.downloadUrl(project.id, { format: "pdf" }),
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "the project did not typeset");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.name}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (problem: any) {
      setError(`${project.name}: ${problem.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col items-center overflow-auto bg-surround px-6 py-10">
      <div className="w-full max-w-[680px]">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="t-display">NextTex</h1>
            <p className="t-meta mt-1 text-ink-2">
              Write LaTeX with Claude beside the typeset page.
            </p>
          </div>
          {canClose ? (
            <button className="t-ui text-ink-2 hover:text-ink" onClick={onClose}>
              Back
            </button>
          ) : null}
        </div>

        <div
          className={
            projects.length
              ? "mt-6 rounded-[5px] border border-line bg-surface"
              : "hidden"
          }
        >
          {projects.map((project) => (
            <div
              key={project.path}
              className="group flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <button
                  className="t-ui-lg block max-w-full truncate font-serif text-ink disabled:text-ink-3"
                  disabled={project.missing || !project.id}
                  onClick={() => project.id && onOpen(project.id)}
                >
                  {project.name}
                </button>
                <div className="t-code-sm truncate text-ink-3">{project.path}</div>
                {project.missing ? (
                  <div className="t-micro mt-1 text-warn">
                    This folder is no longer there.
                  </div>
                ) : null}
              </div>
              {forgetting === project.path ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="t-meta text-ink-2">
                    Remove from NextTex? The files stay where they are.
                  </span>
                  <button
                    className="h-[28px] rounded-[3px] px-2 t-micro text-error"
                    onClick={async () => {
                      setForgetting(null);
                      if (!project.id) return;
                      await api.forgetProject(project.id);
                      refresh();
                    }}
                  >
                    Remove
                  </button>
                  <button
                    className="h-[28px] px-2 t-micro text-ink-3 hover:text-ink"
                    onClick={() => setForgetting(null)}
                  >
                    Keep
                  </button>
                </div>
              ) : (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="h-[28px] rounded-[3px] border border-line px-2 t-micro text-ink-2 hover:text-ink disabled:opacity-40"
                  disabled={!project.id || project.missing}
                  onClick={() =>
                    project.id &&
                    startDownload(api.downloadUrl(project.id, { format: "zip" }))
                  }
                >
                  Zip
                </button>
                <button
                  className="h-[28px] rounded-[3px] border border-line px-2 t-micro text-ink-2 hover:text-ink disabled:opacity-40"
                  disabled={!project.id || project.missing || busy === project.id}
                  onClick={() => takePdf(project)}
                >
                  {busy === project.id ? "Typesetting" : "PDF"}
                </button>
                <button
                  className="h-[28px] rounded-[3px] px-2 t-micro text-ink-3 hover:text-error"
                  onClick={() => setForgetting(project.path)}
                >
                  Remove
                </button>
              </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          {(["create", "add"] as const).map((option) => (
            <button
              key={option}
              className={`nx-hover t-ui border-b-2 pb-1 ${
                mode === option
                  ? "border-hint text-ink"
                  : "border-transparent text-ink-3 hover:text-ink"
              }`}
              onClick={() => setMode(option)}
            >
              {option === "create" ? "Start something new" : "Open what you have"}
            </button>
          ))}
        </div>
        <p className="t-meta mt-2 text-ink-2">
          {mode === "create"
            ? "A new project starts blank — one empty document. Give Claude your template or handbook afterwards and it will shape the project around it."
            : "Point NextTex at a folder that already contains a LaTeX document. Nothing is copied or moved."}
        </p>
        {mode === "create" ? (
          <input
            value={newName}
            placeholder="What is it called?"
            className="t-ui mt-3 h-[28px] w-full rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
            onChange={(event) => setNewName(event.target.value)}
          />
        ) : null}
        <div className="mt-2 flex gap-2">
          <input
            value={path}
            placeholder={
              mode === "create"
                ? "Where to put it, e.g. ~/writing/my-thesis"
                : "/path/to/your/writing/project"
            }
            className="t-code-sm h-[28px] flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          <button
            className="h-[28px] pen-button px-3 t-ui"
            onClick={add}
          >
            Add project
          </button>
        </div>
        {error ? <p className="t-meta mt-3 text-error">{error}</p> : null}
      </div>
    </div>
  );
}
