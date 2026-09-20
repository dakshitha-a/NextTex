import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { openProject } from "../fixtures";
import { seedProject, startServer, ROOT, type Instance } from "../server";

/** The OpenAI provider asks before it runs a script, in the real interface.
 *
 *  A server of its own with the scripted stand-in switched off, so the
 *  session builds the real OpenAI provider, pointed at a fake upstream
 *  here that speaks the chat-completions stream: the first request is
 *  answered with one `run_plot_script` call, the second with "Done." and a
 *  usage chunk.  What is asserted is the interface: the card, with the
 *  script as its detail; Allow letting the run happen; the three-position
 *  control drawn for this provider; and "Allow always" surviving a reload
 *  as a settled card rather than an open one.
 */

const SCRIPT = "print('drawn')\n";
let app: Instance;
let upstream: Server;
let upstreamUrl: string;
let requests = 0;

function sse(lines: object[]): string {
  return lines.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

function toolCall(): object[] {
  return [{
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0, id: "call-1",
          function: { name: "run_plot_script", arguments: JSON.stringify({ name: "fig", script: SCRIPT }) },
        }],
      },
    }],
  }];
}

function text(said: string): object[] {
  return [
    { choices: [{ index: 0, delta: { content: said } }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
  ];
}

test.beforeAll(async () => {
  upstream = createServer((request, response) => {
    let body = "";
    request.on("data", (piece) => { body += piece; });
    request.on("end", () => {
      requests += 1;
      // The reply the model would give: a tool call the first time in a
      // turn, prose once the tool has answered.
      const sent = JSON.parse(body);
      const last = sent.messages[sent.messages.length - 1];
      const reply = last.role === "tool" ? text("Done.") : toolCall();
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(sse(reply));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  upstreamUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
  app = await startServer({
    NEXTTEX_SCRIPTED_AGENT: "",
    NEXTTEX_CLAUDE_BINARY: join(ROOT, "tests", "fake_claude.py"),
  });
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "openai", key: "", model: "fake-model", baseUrl: upstreamUrl }),
  });
});

test.afterAll(async () => {
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "none" }),
  }).catch(() => {});
  await app.stop();
  upstream.close();
});

async function inProject(page: Page) {
  const project = await seedProject(app, `openai-${Date.now()}`);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  return project;
}

async function askForAFigure(page: Page) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill("Draw a figure of x squared.");
  await page.getByRole("button", { name: "Send" }).click();
}

test("the card shows the script, Allow runs it, and the control is there", async ({ page }) => {
  await inProject(page);
  // The chip says what the provider asks about: it asks, so it says so.
  await expect(page.getByTestId("model-open")).toContainText("asks first", { timeout: 20_000 });

  await askForAFigure(page);
  const card = page.locator(".permission-card");
  await card.waitFor({ timeout: 20_000 });
  await expect(card).toContainText("Run a script to draw a figure");
  await expect(card).toContainText("print('drawn')");

  await card.getByTestId("allow").click();
  await expect(card).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText("Done.", { exact: true })).toBeVisible({ timeout: 20_000 });
  // The tool row ended, and the script is in the project.
  const tree = page.locator('[role="tree"]');
  await tree.locator('[data-path="scripts"]').click();
  await expect(tree.locator('[data-path="scripts/fig.py"]')).toBeVisible({ timeout: 10_000 });
});

test("Allow always survives a reload as a settled card", async ({ page }) => {
  await inProject(page);
  await askForAFigure(page);
  const card = page.locator(".permission-card");
  await card.waitFor({ timeout: 20_000 });
  // The buttons arm after a short shield against a click meant for the
  // editor; the click goes through once they have.
  await page.waitForTimeout(500);
  await card.getByTestId("always").click();
  await expect(page.getByText("Done.", { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const before = requests;
  await askForAFigure(page);
  await expect(page.getByText("Done.", { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  expect(requests).toBeGreaterThan(before);
  // Nothing was left open to answer: the second run was recorded as
  // settled by the remembered rule, not asked about.
  await expect(page.locator(".permission-card")).toHaveCount(0);
  const status = await fetch(`${app.base}/api/agent/status`, {
    headers: { "x-nexttex-token": app.token },
  }).then((r) => r.json());
  expect(status.provider).toBe("openai");
});
