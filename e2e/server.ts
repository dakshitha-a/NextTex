import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
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

export type Instance = {
  base: string;
  token: string;
  projects: string;
  /** The temporary directory holding this instance's state, for a test
   *  that needs to put a file where the server can see it. */
  sandbox: string;
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
  mkdirSync(join(data, "nexttex"), { recursive: true });
  writeFileSync(
    join(data, "nexttex", "config.json"),
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
    NEXTTEX_FAKE_CLAUDE_AUTH: "1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === "") delete env[key];
  }

  const child: ChildProcess = spawn(
    join(ROOT, ".venv", "bin", "python"),
    ["-m", "server.run"],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout?.on("data", (chunk) => (log += chunk));
  child.stderr?.on("data", (chunk) => (log += chunk));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`the server never answered on ${base}\n${log}`);
    }
    try {
      const response = await fetch(`${base}/api/projects`, {
        headers: { "x-nexttex-token": token },
      });
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    base,
    token,
    projects,
    sandbox,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (child.exitCode === null) child.kill("SIGKILL");
      rmSync(sandbox, { recursive: true, force: true });
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
