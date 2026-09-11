import { useEffect, useRef, useState } from "react";
import Settings from "./Settings";
import api from "../api";
import { loginRefusal } from "../signin";

/** Choosing what, if anything, writes alongside you.
 *
 *  This is the first screen a new install shows, and it has one job: get
 *  the writer to their document. So the third option is as prominent as
 *  the other two. NextTex is a LaTeX editor before it is an AI tool:
 *  the editor, the preview, the version history, the trash, the reference
 *  tools and the git panel all work with no model behind them, and
 *  somebody who does not want an AI in their thesis should get a complete
 *  application rather than a nag screen.
 *
 *  The Claude flow drives `claude auth login` under a pseudo-terminal on
 *  the server and streams what it prints, which is the only way a headless
 *  install reached over Tailscale can be signed in without a terminal.
 *  OpenAI has no such flow: the API is a key, so it asks for one.
 */

type Choice = "claude" | "openai" | "none" | null;

export default function SignIn({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  /** Present when this was reached from Settings rather than at boot.
   *  Without it there is no way out of a screen somebody opened to look,
   *  and the only escape is to choose something. */
  onCancel?: () => void;
}) {
  const [choice, setChoice] = useState<Choice>(null);
  const [error, setError] = useState<string | null>(null);

  // Escape, because somebody who opened this screen to look at the options
  // and decided to keep what they had should not have to choose something
  // to get out. One level at a time, which is what Escape means everywhere
  // else in this app: out of the provider you were setting up first, then
  // off the screen.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (choice !== null) {
        setChoice(null);
        return;
      }
      onCancel?.();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [choice, onCancel]);

  return (
    <div className="nx-furniture flex h-full items-center justify-center bg-surround px-6">
      <div className="w-full max-w-[560px] rounded-[5px] border border-line bg-surface p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="t-display">NextTex</h1>
            <p className="t-meta mt-1 text-ink-2">
              Write LaTeX with the typeset page beside you.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* "Close" rather than "Back", because the buttons inside each
                provider's panel say Back and mean something else: they go
                up one level, this leaves the screen. Two controls with the
                same word meaning two different things is its own bug. */}
            {onCancel ? (
              <button
                className="t-ui text-ink-2 hover:text-ink"
                data-testid="signin-back"
                title="Keep the agent you have (Escape)"
                onClick={onCancel}
              >
                Close
              </button>
            ) : null}
            {/* One 26px control on a first-run screen is the right price for
                a first-run reader who cannot comfortably read 13px. */}
            <Settings />
          </div>
        </div>

        {choice === null ? (
          <>
            <p className="t-ui mt-5 text-ink">How would you like to work?</p>
            <p className="t-meta mt-1 text-ink-2">
              You can change this later, and everything except the chat panel
              works the same either way.
              {onCancel ? " Close leaves this as it is." : ""}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Option
                title="With Claude"
                detail="Sign in to a Claude account. Runs through the Claude CLI on this machine; NextTex never sees your credentials."
                onClick={() => setChoice("claude")}
              />
              <Option
                title="With ChatGPT"
                detail="Paste an OpenAI API key. Kept in this machine's config file, readable only by you."
                onClick={() => setChoice("openai")}
              />
              <Option
                title="On my own"
                detail="No agent at all. The editor, the live preview, version history, the trash, citations by DOI and the git panel all work exactly the same."
                onClick={async () => {
                  try {
                    await api.chooseProvider("none");
                    onDone();
                  } catch (problem: any) {
                    setError(problem.message);
                  }
                }}
              />
            </div>
          </>
        ) : choice === "openai" ? (
          <OpenAIKey onDone={onDone} onBack={() => setChoice(null)} />
        ) : (
          <ClaudeLogin onDone={onDone} onBack={() => setChoice(null)} />
        )}

        {error ? <p className="t-meta mt-4 text-error">{error}</p> : null}
      </div>
    </div>
  );
}

function Option({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-[3px] border border-line px-3 py-2 text-left transition-colors duration-[90ms] hover:border-hint hover:bg-surface-2"
      onClick={onClick}
    >
      <span className="t-ui block text-ink">{title}</span>
      <span className="t-meta mt-1 block text-ink-2">{detail}</span>
    </button>
  );
}

/** An API key, and nothing pretending to be a sign-in.
 *
 *  There is no OAuth flow for the OpenAI API, which is a key rather than
 *  an account, so this says
 *  so rather than dressing it up as a login. */
function OpenAIKey({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!key.trim()) {
      setError("A key is needed.");
      return;
    }
    setBusy(true);
    try {
      await api.chooseProvider("openai", key.trim(), model.trim());
      onDone();
    } catch (problem: any) {
      setError(problem.message);
      setBusy(false);
    }
  };

  return (
    <>
      <p className="t-ui mt-5 text-ink">Your OpenAI API key</p>
      <p className="t-meta mt-1 text-ink-2">
        From{" "}
        <a
          className="text-pen underline"
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          platform.openai.com/api-keys
        </a>
        . It is stored in this machine's own config file, readable only by
        you, and sent to nobody but OpenAI. This is an API key rather than a
        ChatGPT subscription: usage is billed to your OpenAI account.
      </p>
      <input
        autoFocus
        type="password"
        value={key}
        placeholder="sk-…"
        data-testid="openai-key"
        className="t-code-sm mt-4 h-[28px] w-full rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
        onChange={(event) => setKey(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && void save()}
      />
      <input
        value={model}
        placeholder="Model, or leave blank for the default"
        className="t-code-sm mt-2 h-[28px] w-full rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
        onChange={(event) => setModel(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && void save()}
      />
      <div className="mt-3 flex gap-2">
        <button
          className="h-[28px] ghost-button px-3 t-ui"
          disabled={busy}
          onClick={save}
        >
          Save and start writing
        </button>
        <button className="quiet h-[28px] px-2 t-ui" onClick={onBack}>
          Back
        </button>
      </div>
      {error ? <p className="t-meta mt-3 text-error">{error}</p> : null}
    </>
  );
}

function ClaudeLogin({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  const [output, setOutput] = useState("");
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** null while the answer is unknown, so the screen does not flash the
   *  wrong half of itself before the status arrives. */
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const source = useRef<EventSource | null>(null);
  const log = useRef<HTMLPreElement | null>(null);

  useEffect(() => () => source.current?.close(), []);

  // Somebody who chose "no agent" during the install has no `claude` on this
  // machine, and the screen used to tell them to go and download one. It can
  // fetch it instead: the same act the installer performs, and the same code.
  useEffect(() => {
    let live = true;
    api
      .claudeStatus()
      .then((status) => live && setInstalled(status.installed !== false))
      .catch(() => live && setInstalled(true));
    return () => {
      live = false;
    };
  }, []);

  const install = async () => {
    setError(null);
    setOutput("");
    setInstalling(true);
    try {
      await api.installClaude();
    } catch (problem: any) {
      setError(problem.message);
      setInstalling(false);
      return;
    }
    source.current?.close();
    const stream = new EventSource("/api/claude/install/stream");
    source.current = stream;
    stream.onmessage = (event) => {
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === "output")
        setOutput((current) => current + payload.text);
      if (payload.type === "done") {
        stream.close();
        setInstalling(false);
        if (payload.ok) {
          setInstalled(true);
          setOutput("");
        } else {
          setError(payload.error ?? "The Claude CLI did not install.");
        }
      }
    };
  };

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [output]);

  const start = async (mode: string) => {
    setError(null);
    setOutput("");
    setRunning(true);
    try {
      await api.chooseProvider("claude");
      const refused = loginRefusal(await api.startLogin(mode === "console"));
      if (refused) {
        setError(refused);
        setRunning(false);
        return;
      }
    } catch (problem: any) {
      setError(problem.message);
      setRunning(false);
      return;
    }
    source.current?.close();
    const stream = new EventSource("/api/claude/login/stream");
    source.current = stream;
    stream.onmessage = async (event) => {
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === "output") setOutput((current) => current + payload.text);
      if (payload.type === "done") {
        stream.close();
        setRunning(false);
        const status = await api.agentStatus().catch(() => null);
        if (status?.ready) onDone();
        else setError("Sign-in did not complete. Try again.");
      }
    };
  };

  const links = Array.from(
    new Set(output.match(/https?:\/\/[^\s"'<>]+/g) ?? []),
  );

  return (
    <>
      <p className="t-ui mt-5 text-ink">Connect your Claude account</p>
      <p className="t-meta mt-1 text-ink-2">
        The agent runs as a Claude session scoped to your project. Sign in
        once; the credentials stay on this machine, in the Claude CLI's own
        store, and NextTex never sees them.
      </p>

      {installed === false && !installing ? (
        <>
          <p className="t-meta mt-4 text-ink-2">
            The Claude CLI is not on this machine yet, because you chose no agent
            when NextTex was installed. It can be installed now, which is the
            same thing the installer would have done.
          </p>
          <div className="mt-5 flex gap-2">
            <button
              className="h-[28px] ghost-button px-3 t-ui"
              data-testid="install-claude"
              onClick={install}
            >
              Install the Claude CLI
            </button>
            <button className="quiet h-[28px] px-2 t-ui" onClick={onBack}>
              Back
            </button>
          </div>
        </>
      ) : null}

      {installed !== false && !running ? (
        <div className="mt-5 flex gap-2">
          <button
            className="h-[28px] ghost-button px-3 t-ui"
            onClick={() => start("subscription")}
          >
            Sign in with a Claude account
          </button>
          <button
            className="h-[28px] rounded-[3px] border border-line px-3 t-ui"
            onClick={() => start("console")}
          >
            Use Console or SSO
          </button>
          <button className="quiet h-[28px] px-2 t-ui" onClick={onBack}>
            Back
          </button>
        </div>
      ) : null}

      {installing ? (
        <pre className="t-code-sm mt-4 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[3px] bg-surface-2 p-3 text-ink-2">
          {output || "Installing…"}
        </pre>
      ) : null}

      {links.length ? (
        <div className="mt-5 rounded-[3px] bg-surface-2 p-3">
          <div className="t-micro text-ink-2">Open this to authorise:</div>
          {links.map((link) => (
            <a
              key={link}
              href={link}
              target="_blank"
              rel="noreferrer"
              className="t-code-sm mt-1 block break-all text-pen underline"
            >
              {link}
            </a>
          ))}
        </div>
      ) : null}

      {running ? (
        <>
          <pre
            ref={log}
            className="t-code-sm mt-4 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[3px] bg-surface-2 p-3 text-ink-2"
          >
            {output || "Starting…"}
          </pre>
          <div className="mt-3 flex gap-2">
            <input
              value={code}
              placeholder="Paste the code here"
              className="t-code-sm h-[28px] flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                api.loginInput(code).catch(() => undefined);
                setCode("");
              }}
            />
            <button
              className="h-[28px] ghost-button px-3 t-ui"
              onClick={() => {
                api.loginInput(code).catch(() => undefined);
                setCode("");
              }}
            >
              Send
            </button>
            <button
              className="h-[28px] rounded-[3px] border border-line px-3 t-ui text-ink-2"
              onClick={async () => {
                await api.cancelLogin().catch(() => undefined);
                source.current?.close();
                setRunning(false);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="t-meta mt-4 text-error">{error}</p> : null}
    </>
  );
}
