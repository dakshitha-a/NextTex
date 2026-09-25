import { spawn, type ChildProcess } from "node:child_process";
import { connect, createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A port nothing is listening on, taken the way the app itself takes one. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Whether anything is listening on the port yet.
 *
 *  This is the stage a slow start actually spends its time in: the venv's
 *  python starting, the app importing, the port binding.  Told apart from
 *  the route answering because more time helps one of them and not the
 *  other. */
function connected(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const done = (answer: boolean) => {
      socket.destroy();
      resolve(answer);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

export type Instance = {
  base: string;
  token: string;
  projects: string;
  /** The temporary directory holding this instance's state, for a test
   *  that needs to put a file where the server can see it. */
  sandbox: string;
  /** Everything the server has printed so far. */
  output(): string;
  stop(): Promise<void>;
};

/** A NextTex of its own: its own port, its own state, its own projects.
 *
 *  Nothing here touches the instance the writer has open -- XDG_DATA_HOME
 *  and XDG_CONFIG_HOME are redirected, and the config file is written
 *  before the server starts so the token is known rather than scraped out
 *  of a log line. */
export async function startServer(
  /** Overrides for the server's environment.  An empty value unsets the
   *  variable, which is how the sign-in spec gets a server that has *not*
   *  been told to pretend somebody is already signed in. */
  overrides: Record<string, string> = {},
): Promise<Instance> {
  const sandbox = mkdtempSync(join(tmpdir(), "nexttex-e2e-"));
  const data = join(sandbox, "data");
  const config = join(sandbox, "config");
  const projects = join(sandbox, "projects");
  for (const dir of [data, config, projects]) mkdirSync(dir, { recursive: true });

  const port = await freePort();
  const token = "e2e-token";
  // A named instance keeps its state in a directory of its own, so the
  // config has to be written where that instance will look for it -- or the
  // server generates a fresh one and listens somewhere nobody is watching.
  const stateDir = join(
    data,
    overrides.NEXTTEX_INSTANCE ? `nexttex-${overrides.NEXTTEX_INSTANCE}` : "nexttex",
  );
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "config.json"),
    JSON.stringify({
      port, localhost: true, tailscale: false, token, model: "",
      provider: "claude", openai_key: "",
    }),
  );

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_DATA_HOME: data,
    XDG_CONFIG_HOME: config,
    // Deterministic, offline, instant.  The real agent needs an account
    // and answers differently every time.
    NEXTTEX_SCRIPTED_AGENT: "reply",
    // A word list is never fetched from the network here: a spec plants
    // the files where the server keeps its copy, and anything else finds
    // nothing listening.
    NEXTTEX_DICTIONARY_BASE: "http://127.0.0.1:9/npm",
    NEXTTEX_GITHUB_API: "http://127.0.0.1:9",
    NEXTTEX_FAKE_CLAUDE_AUTH: "1",
    // In-process peers rather than real ones. A browser test that shared a
    // project would otherwise open an iroh endpoint and talk to n0's
    // discovery and relay hosts, which is a network dependency this suite
    // does not otherwise have. Override it to exercise the real transport.
    NEXTTEX_COLLAB_TRANSPORT: "loopback",
    ...overrides,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === "") delete env[key];
  }

  // `detached` makes the server its own process group leader, so stopping it
  // can take its children with it. It spawns real builds, and `latexmk` and
  // `pdflatex` are grandchildren of this runner: killing only the server left
  // them writing into the sandbox while `stop()` was deleting it, which
  // surfaced as an intermittent ENOTEMPTY from a directory that had been
  // emptied a moment earlier.
  const child: ChildProcess = spawn(
    join(ROOT, ".venv", "bin", "python"),
    ["-m", "server.run"],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  child.stdout?.on("data", (chunk) => (log += chunk));
  child.stderr?.on("data", (chunk) => (log += chunk));
  // `exit` rather than `close`: close waits on the stdio streams, and what
  // is wanted here is the moment the process is gone.
  let died = "";
  child.on("exit", (code, signal) => {
    died = signal ? `killed by ${signal}` : `exited with ${code}`;
  });

  const base = `http://127.0.0.1:${port}`;
  // Three stages against one budget, so a failure says which one ran out.
  // This was a single wait on the route, and its whole vocabulary was "the
  // server never answered": a server that died at import, a port already
  // taken and a token the server refused all spent the full thirty seconds
  // and then reported the same sentence, which is why one sighting of a
  // slow start in `tab-strips.spec.ts` could not be acted on. Two workers
  // each boot a real server beside a real LaTeX build, so the slow case is
  // real; it is now told apart from the three that are not slow at all.
  const started = Date.now();
  const deadline = started + 30_000;
  const took: string[] = [];
  let stage = "the process to stay up";
  let refusal = "";
  const mark = (next: string) => {
    took.push(`${stage}: ${Date.now() - started}ms`);
    stage = next;
  };
  const giveUp = (): never => {
    child.kill("SIGKILL");
    const where = died ? `the server ${died}` : `waiting for ${stage}`;
    const passed = took.length ? `\npast: ${took.join(", ")}` : "";
    const said = refusal ? `\nlast answer: ${refusal}` : "";
    throw new Error(
      `the server did not start on ${base}: ${where}${passed}${said}\n${log}`,
    );
  };

  // 1. Alive. A child that is already gone will never bind anything, and
  //    waiting thirty seconds to say so hides the reason, which is in the
  //    log this throws with.
  stage = "the port to be bound";
  for (;;) {
    if (died || Date.now() > deadline) giveUp();
    const bound = await connected(port);
    if (bound) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  mark("the route to answer");

  // 2. Answering. A refusal is an answer: a wrong token used to look
  //    exactly like a server that was not there.
  for (;;) {
    if (died || Date.now() > deadline) giveUp();
    try {
      const response = await fetch(`${base}/api/projects`, {
        headers: { "x-nexttex-token": token },
      });
      if (response.ok) break;
      refusal = `${response.status} ${response.statusText}`;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  mark("");

  // A run that ends without reaching `stop()` -- an interrupt, a crash in a
  // fixture, a killed terminal -- used to leave the server behind, still
  // listening, for as long as the machine stayed up. Four of them were once
  // found six hours later. `exit` fires for all of those, and may only do
  // synchronous work, which `kill` is.
  /** Signal the whole group, and do not care if it has already gone. */
  const endGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* already reaped, or never started */
    }
  };

  const orphanGuard = () => endGroup("SIGKILL");
  process.on("exit", orphanGuard);

  return {
    base,
    token,
    projects,
    sandbox,
    /** Everything the server has printed so far, for a spec that needs to
     *  see a traceback the page never shows. */
    output: () => log,
    async stop() {
      process.off("exit", orphanGuard);
      endGroup("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (child.exitCode === null) endGroup("SIGKILL");

      // Even with the group gone, a build's last write can still be settling,
      // and a recursive delete that races one raises ENOTEMPTY from a
      // directory it has just emptied. Retried rather than trusted once: this
      // is teardown, and failing here fails a test that has already passed.
      for (let attempt = 0; ; attempt += 1) {
        try {
          rmSync(sandbox, { recursive: true, force: true });
          return;
        } catch (problem) {
          if (attempt >= 5) throw problem;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    },
  };
}

/** A project on disk, registered and ready to open. */
export async function seedProject(
  instance: Instance,
  name: string,
): Promise<{ id: string; root: string }> {
  const root = join(instance.projects, name);
  cpSync(join(ROOT, "nexttex", "templates", "basic"), root, { recursive: true });
  mkdirSync(join(root, "figures"), { recursive: true });
  const response = await fetch(`${instance.base}/api/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nexttex-token": instance.token,
    },
    body: JSON.stringify({ path: root }),
  });
  const body = await response.json();
  return { id: body.id, root };
}
