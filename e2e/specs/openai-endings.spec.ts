import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { openProject } from "../fixtures";
import { seedProject, startServer, ROOT, type Instance } from "../server";

/** How a turn with ChatGPT or a local model ends when it does not finish.
 *
 *  Q-002: a turn that used every round of tools ended as though it had
 *  finished. Q-003: a connection that dropped mid-answer showed Python's
 *  own exception text. A fake upstream speaks the chat-completions stream:
 *  "loop" is answered with a tool call every time, "drop" with the start of
 *  an answer and then a closed socket.
 */

let app: Instance;
let upstream: Server;
let upstreamUrl: string;

function sse(lines: object[]): string {
  return lines.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
}

test.beforeAll(async () => {
  let calls = 0;
  upstream = createServer((request, response) => {
    let body = "";
    request.on("data", (piece) => { body += piece; });
    request.on("end", () => {
      const sent = JSON.parse(body);
      const asked = sent.messages.filter((m: any) => m.role === "user").pop()?.content ?? "";
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (String(asked).includes("drop")) {
        response.write(sse([{ choices: [{ index: 0, delta: { content: "Continuing with chapter 7, where" } }] }]));
        // The connection goes before the answer ends.
        setTimeout(() => response.socket?.destroy(), 200);
        return;
      }
      calls += 1;
      response.end(sse([{
        choices: [{ index: 0, delta: { tool_calls: [{
          index: 0, id: `call-${calls}`,
          function: { name: "read_file", arguments: JSON.stringify({ path: "main.tex" }) },
        }] } }],
      }]) + "data: [DONE]\n\n");
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

async function ask(page: Page, said: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(said);
  await page.getByRole("button", { name: "Send" }).click();
}

test("a turn that uses every round says it stopped, and a dropped answer is a sentence", async ({ page }) => {
  const project = await seedProject(app, `openai-end-${Date.now()}`);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

  await ask(page, "loop over every label");
  await expect(page.getByText(
    'Stopped after 12 rounds of tools without finishing. Say "carry on" to continue, or ask for less at once.',
  )).toBeVisible({ timeout: 45_000 });

  await ask(page, "drop");
  await expect(page.getByText(
    "The connection to OpenAI dropped partway through the answer. Try again in a moment.",
  )).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/ChunkedEncodingError|IncompleteRead|Connection broken/)).toHaveCount(0);
});
