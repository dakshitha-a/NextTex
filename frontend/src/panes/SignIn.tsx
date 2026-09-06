import { useEffect, useRef, useState } from "react";
import api from "../api";

/** The server drives `claude auth login` under a PTY and streams what it
 *  prints.  That is the only way a headless install reached over Tailscale
 *  can be signed in without touching a terminal. */
export default function SignIn({ onDone }: { onDone: () => void }) {
  const [output, setOutput] = useState("");
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);
  const log = useRef<HTMLPreElement | null>(null);

  useEffect(() => () => source.current?.close(), []);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [output]);

  const start = async (mode: string) => {
    setError(null);
    setOutput("");
    setRunning(true);
    try {
      await api.startLogin(mode === "console");
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
        const status = await api.claudeStatus().catch(() => null);
        if (status?.loggedIn) onDone();
        else setError("Sign-in did not complete. Try again.");
      }
    };
  };

  const links = Array.from(
    new Set(output.match(/https?:\/\/[^\s"'<>]+/g) ?? []),
  );

  return (
    <div className="flex h-full items-center justify-center bg-surround px-6">
      <div className="w-full max-w-[560px] rounded-[5px] border border-line bg-surface p-6">
        <h1 className="t-display">NextTex</h1>
        <p className="t-meta mt-1 text-ink-2">
          Write LaTeX with Claude beside the typeset page.
        </p>
        <p className="t-ui mt-5 text-ink">Connect your Claude account</p>
        <p className="t-meta mt-1 text-ink-2">
          The writing agent runs as a Claude session scoped to your project.
          Sign in once; the credentials stay on this machine, in the Claude
          CLI's own store — NextTex never sees them.
        </p>

        {!running ? (
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
          </div>
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

        <button className="t-micro mt-6 text-ink-3 hover:text-ink" onClick={onDone}>
          Continue without the agent
        </button>
      </div>
    </div>
  );
}
