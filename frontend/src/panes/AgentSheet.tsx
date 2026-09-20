import { useEffect, useRef, useState } from "react";
import api from "../api";
import { loginRefusal } from "../signin";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Field, Heading } from "../ui/controls";

/** What writes with you: one choice for this install, made or changed in
 *  one sheet.
 *
 *  Reached from the app bar's agent control on the projects screen, from
 *  the settings sheet's "Writing agent" row and from the Claude column's
 *  header inside a project, and opened over the empty list at first boot,
 *  where it used to be a screen of its own with no way off it.  NextTex is
 *  a LaTeX editor before it is an AI tool: the editor, the preview, the
 *  version history, the trash, the reference tools and the git panel all
 *  work with no model behind them, so the third choice is as plain as the
 *  other two.
 *
 *  The three choices are rows; the chosen one opens to hold its own setup.
 *  The Claude flow drives `claude auth login` under a pseudo-terminal on
 *  the server and streams what it prints, which is the only way a headless
 *  install reached over Tailscale can be signed in without a terminal.
 *  OpenAI has no such flow: the API is a key, so it asks for one, and a
 *  local server such as Ollama is the same choice with an address and a
 *  model instead.
 */

type Choice = "claude" | "openai" | "none";

const TITLES: Record<Choice, string> = {
  claude: "Claude",
  openai: "ChatGPT, or a model on this machine",
  none: "No agent",
};

const EXPLAINED: Record<Choice, string> = {
  claude: "Sign in to a Claude account. Runs through the Claude CLI on this machine; NextTex never sees your credentials.",
  openai: "Paste an OpenAI API key, kept in this machine's config file and readable only by you. A local server such as Ollama needs its address and the model's name instead.",
  none: "The editor, the live preview, version history, the trash, citations by DOI and the git panel all work exactly the same.",
};

const VERBS: Record<Choice, string> = {
  claude: "Claude",
  openai: "ChatGPT",
  none: "no agent",
};

export type AgentStanding = {
  provider: Choice;
  ready: boolean;
  model?: string;
  keyTail?: string;
  baseUrl?: string;
  email?: string;
};

export default function AgentSheet({
  standing,
  onDone,
  onClose,
}: {
  /** What the install writes with now, from the store's `agent`. */
  standing: AgentStanding | null;
  /** The choice was made or changed; the caller reads the status again. */
  onDone: () => void;
  onClose: () => void;
}) {
  const current: Choice = standing?.provider ?? "claude";
  const [choice, setChoiceOnly] = useState<Choice>(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A move between rows takes the row's error with it: it belonged to
  // the attempt just left.
  const setChoice = (next: Choice) => {
    setError(null);
    setChoiceOnly(next);
  };

  // What the filled button does depends on the row.  Claude is chosen by
  // signing in, inside its row, so the foot only keeps it; the other two
  // are chosen here.
  const keeping = choice === current && (choice !== "claude" || standing?.ready);
  // At first boot nothing writes with you yet and there is nothing to go
  // back to, so the sheet stays until a choice is made; "No agent" is one
  // press.  Opened later, over an agent that works, it can be left alone.
  const dismissable = Boolean(standing?.ready);
  const openai = useRef<{ save: () => Promise<boolean> } | null>(null);

  const confirm = async () => {
    setError(null);
    if (keeping) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (choice === "none") {
        await api.chooseProvider("none");
      } else if (choice === "openai") {
        if (!(await openai.current?.save())) {
          setBusy(false);
          return;
        }
      } else {
        await api.chooseProvider("claude");
      }
      onDone();
    } catch (problem: any) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  const rows = useRef<HTMLDivElement | null>(null);
  const move = (event: React.KeyboardEvent, from: Choice) => {
    const order: Choice[] = ["claude", "openai", "none"];
    const at = order.indexOf(from);
    let next: Choice | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = order[(at + 1) % order.length];
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = order[(at + order.length - 1) % order.length];
    if (!next) return;
    event.preventDefault();
    setChoice(next);
    rows.current?.querySelector<HTMLElement>(`[data-choice="${next}"]`)?.focus();
  };

  return (
    <Sheet
      open
      onClose={dismissable ? onClose : () => undefined}
      labelledBy="agent-heading"
      testid="agent-sheet"
      width={560}
      data-first={dismissable ? undefined : ""}
    >
      <Heading level={2} display id="agent-heading">What writes with you</Heading>
      <p className="t-meta mt-1 text-ink-2">
        One choice for this install, changed here or from inside any project.
        NextTex is a LaTeX editor first: everything but the Claude column
        works the same whichever you pick.
      </p>

      <div ref={rows} role="radiogroup" aria-label="What writes with you" className="mt-2">
        {(["claude", "openai", "none"] as Choice[]).map((option) => {
          const on = choice === option;
          return (
            /* The radio is the row's head alone, so the setup's own
               controls are not nested inside it. */
            <div key={option} className="nx-agent-option" data-on={on || undefined}>
              <button
                type="button"
                className="nx-agent-choice"
                data-choice={option}
                data-testid={`agent-${option}`}
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => setChoice(option)}
                onKeyDown={(event) => move(event, option)}
              >
                <span className="nx-agent-radio" aria-hidden="true" />
                <span className="nx-agent-title">{TITLES[option]}</span>
                <span className="nx-agent-explained">{EXPLAINED[option]}</span>
              </button>
              {on && option === "claude" ? (
                <ClaudeSetup standing={standing} onDone={onDone} onError={setError} />
              ) : null}
              {on && option === "openai" ? (
                <OpenAISetup standing={standing} handle={openai} onError={setError} />
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="t-meta mt-3 text-error" data-testid="agent-error">{error}</p> : null}

      <div className="nx-sheet-foot">
        {dismissable ? (
          <Button variant="quiet" data-testid="agent-cancel" onClick={onClose}>Cancel</Button>
        ) : null}
        <Button
          variant="pen"
          data-testid="agent-confirm"
          disabled={busy || (choice === "claude" && !(current === "claude" && standing?.ready))}
          onClick={confirm}
        >
          {busy ? "Saving…" : `${keeping ? "Keep" : "Use"} ${VERBS[choice]}`}
        </Button>
      </div>
    </Sheet>
  );
}

/** An API key, and nothing pretending to be a sign-in: there is no OAuth
 *  flow for the OpenAI API, which is a key rather than an account.  The
 *  fields live in the row; the foot's button saves them through `handle`. */
function OpenAISetup({
  standing,
  handle,
  onError,
}: {
  standing: AgentStanding | null;
  handle: React.MutableRefObject<{ save: () => Promise<boolean> } | null>;
  onError: (message: string | null) => void;
}) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(standing?.provider === "openai" ? standing.model ?? "" : "");
  const [baseUrl, setBaseUrl] = useState(standing?.provider === "openai" ? standing.baseUrl ?? "" : "");

  handle.current = {
    save: async () => {
      // A local server wants no key and has no default model; OpenAI
      // wants a key and has one.  A key already kept is kept when the
      // field is left blank.
      const local = baseUrl.trim() !== "";
      const kept = standing?.provider === "openai" && Boolean(standing.keyTail);
      if (!local && !key.trim() && !kept) {
        onError("A key is needed.");
        return false;
      }
      if (local && !model.trim()) {
        onError("A local server needs the model named, for example llama3.1.");
        return false;
      }
      await api.chooseProvider("openai", key.trim(), model.trim(), baseUrl.trim());
      return true;
    },
  };

  return (
    <div className="nx-agent-setup">
      <p className="t-micro text-ink-3">
        A key from{" "}
        <a className="text-pen underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
          platform.openai.com/api-keys
        </a>
        , sent to nobody but OpenAI. This is an API key rather than a ChatGPT
        subscription: usage is billed to your OpenAI account.
        {standing?.provider === "openai" && standing.keyTail
          ? ` A key ending ${standing.keyTail} is kept; leave the field blank to keep it.`
          : ""}
      </p>
      {/* No autofocus: the arrow keys walk the rows, and a field that
          took the focus as its row opened would end the walk there. */}
      <Field
        type="password"
        value={key}
        placeholder="sk-…"
        aria-label="OpenAI API key"
        data-testid="openai-key"
        frameClassName="w-full"
        className="font-mono text-[12.5px]"
        onChange={(event) => setKey(event.target.value)}
      />
      <Field
        value={model}
        placeholder={baseUrl.trim() ? "Model, which a local server needs named" : "Model, or leave blank for the default"}
        aria-label="Model"
        data-testid="openai-model"
        frameClassName="w-full"
        className="font-mono text-[12.5px]"
        onChange={(event) => setModel(event.target.value)}
      />
      {/* Ollama, LM Studio, vLLM and most local servers speak this same
          protocol, so a base URL is nearly the whole of running a model
          on this machine, and with one the key above is optional. */}
      <p className="t-micro text-ink-3">
        Or a local server that speaks the same protocol: Ollama is{" "}
        <span className="font-mono">http://localhost:11434/v1</span>, LM Studio{" "}
        <span className="font-mono">http://localhost:1234/v1</span>. With one, no key
        is needed and nothing leaves this machine.
      </p>
      <Field
        value={baseUrl}
        placeholder="Base URL, or leave blank for OpenAI"
        aria-label="Base URL"
        data-testid="openai-base-url"
        frameClassName="w-full"
        className="font-mono text-[12.5px]"
        onChange={(event) => setBaseUrl(event.target.value)}
      />
    </div>
  );
}

function ClaudeSetup({
  standing,
  onDone,
  onError,
}: {
  standing: AgentStanding | null;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [output, setOutput] = useState("");
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  /** null while the answer is unknown, so the row does not flash the
   *  wrong half of itself before the status arrives. */
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const source = useRef<EventSource | null>(null);
  const log = useRef<HTMLPreElement | null>(null);
  const signedIn = standing?.provider === "claude" && standing.ready;

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

  /** Fetch and run the Claude CLI installer, following what it says.
   *
   *  Every way of failing to reach the end lands somewhere: the server
   *  answering that the CLI is already there and therefore starting no
   *  install at all, the stream dropping, and the stream ending without
   *  the frame this was waiting for. */
  const install = async () => {
    onError(null);
    setOutput("");
    setInstalling(true);
    let answer: any;
    try {
      answer = await api.installClaude();
    } catch (problem: any) {
      onError(problem.message);
      setInstalling(false);
      return;
    }
    // The reply is not always "I have started".  If the CLI turned up in
    // the meantime, nothing is started, and the stream then answers `idle`
    // for ever while EventSource politely reconnects to be told the same
    // thing again.
    if (answer?.installed) {
      setInstalling(false);
      setInstalled(true);
      setOutput("");
      return;
    }
    source.current?.close();
    const stream = new EventSource("/api/claude/install/stream");
    source.current = stream;
    const stop = () => {
      stream.close();
      if (source.current === stream) source.current = null;
      setInstalling(false);
    };
    stream.onmessage = (event) => {
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === "output") setOutput((current) => current + payload.text);
      if (payload.type === "idle") {
        stop();
        setInstalled(true);
        setOutput("");
      }
      if (payload.type === "done") {
        stop();
        if (payload.ok) {
          setInstalled(true);
          setOutput("");
        } else {
          onError(payload.error ?? "The Claude CLI did not install.");
        }
      }
    };
    // Only when the stream is actually shut: EventSource reports an error
    // and then reconnects on its own, and an install that takes a minute
    // over a flaky link must not be abandoned for a blip it was going to
    // recover from by itself.
    stream.onerror = () => {
      if (stream.readyState !== EventSource.CLOSED) return;
      stop();
      onError(
        "Lost touch with the installer. It may have finished; try again, or "
        + "install the Claude CLI yourself from https://claude.ai/download.",
      );
    };
  };

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [output]);

  const start = async (console: boolean) => {
    onError(null);
    setOutput("");
    setRunning(true);
    try {
      await api.chooseProvider("claude");
      const refused = loginRefusal(await api.startLogin(console));
      if (refused) {
        onError(refused);
        setRunning(false);
        return;
      }
    } catch (problem: any) {
      onError(problem.message);
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
        else onError("Sign-in did not complete. Try again.");
      }
    };
  };

  const links = Array.from(new Set(output.match(/https?:\/\/[^\s"'<>]+/g) ?? []));

  return (
    <div className="nx-agent-setup" data-testid="claude-setup">
      {installed === false && !installing ? (
        <div className="nx-agent-row">
          <Button variant="ghost" data-testid="install-claude" onClick={install}>
            Install the Claude CLI
          </Button>
          <span className="t-micro text-ink-3">
            The Claude CLI is not on this machine yet, because you chose no
            agent when NextTex was installed. This is the same thing the
            installer would have done.
          </span>
        </div>
      ) : null}

      {installed !== false && !running && !installing ? (
        <div className="nx-agent-row">
          <Button variant="ghost" data-testid="claude-sign-in" onClick={() => start(false)}>
            {signedIn ? "Sign in again" : "Sign in"}
          </Button>
          <span className="t-micro text-ink-3">
            {signedIn
              ? `Signed in${standing?.email ? ` as ${standing.email}` : ""}. The credentials stay in the Claude CLI's own store on this machine.`
              : "Opens a page to authorise, then comes back here. The credentials stay in the Claude CLI's own store on this machine."}
            {" "}
            <Button size="inline" data-testid="claude-console" onClick={() => start(true)}>
              Console or SSO instead
            </Button>
          </span>
        </div>
      ) : null}

      {installing ? (
        <>
          <pre className="nx-agent-log">{output || "Installing…"}</pre>
          <div className="nx-agent-row">
            <Button
              size="inline"
              data-testid="cancel-install"
              onClick={() => {
                source.current?.close();
                source.current = null;
                setInstalling(false);
                setOutput("");
              }}
            >
              Stop watching
            </Button>
          </div>
        </>
      ) : null}

      {links.length ? (
        <div className="nx-agent-links">
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
          <pre ref={log} className="nx-agent-log">{output || "Starting…"}</pre>
          <div className="nx-agent-row">
            <Field
              value={code}
              placeholder="Paste the code here"
              aria-label="The code from the browser"
              frameClassName="min-w-0 flex-1"
              className="font-mono text-[12.5px]"
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                api.loginInput(code).catch(() => undefined);
                setCode("");
              }}
            />
            <Button
              variant="ghost"
              onClick={() => {
                api.loginInput(code).catch(() => undefined);
                setCode("");
              }}
            >
              Send
            </Button>
            <Button
              variant="quiet"
              onClick={async () => {
                await api.cancelLogin().catch(() => undefined);
                source.current?.close();
                setRunning(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
