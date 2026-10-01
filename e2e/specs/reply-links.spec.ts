import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { test, expect, openProject } from "../fixtures";

/** A link in a reply, and in the Markdown preview, is a link.
 *
 *  The column's Markdown knew code, bold and italic inside a sentence, so
 *  a reply that pointed somewhere showed its brackets and its address, and
 *  a README's links did the same in the preview, which reads Markdown with
 *  the same code.  Now a `[words](address)` and a bare address are links
 *  in the hint's ink that open in a new tab with no opener, and anything
 *  that is not http, https or mailto stays the text it was: what the agent
 *  writes comes partly from files other people wrote, and a link in it
 *  must never run anything.  The new tab's address is answered by a route
 *  in the browser context, so nothing here reaches the network.
 */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

/** Answer any page the link opens, offline. */
async function answerDoi(context: BrowserContext) {
  await context.route("https://doi.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>A record</title><p>A record.</p>" }),
  );
}

/** Click the link and return the page it opened. */
async function follow(context: BrowserContext, link: Locator): Promise<Page> {
  const [opened] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await opened.waitForLoadState("domcontentloaded");
  return opened;
}

/** The hint's ink, which is what a link is drawn in. */
async function hintOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--hint)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
}

test("a link in a reply is a link that opens in a new tab, and a javascript: link is text", async ({ tab }) => {
  const context = tab.context();
  await answerDoi(context);
  await ask(tab, "links", "Which paper describes fewest-switches surface hopping?");
  const chat = tab.getByTestId("chat");
  await expect(chat.getByText(/which I left as text/)).toBeVisible({ timeout: 20_000 });

  // The Markdown link: its words, its address, a new tab with no opener.
  const paper = chat.getByRole("link", { name: "the Tully paper" });
  await expect(paper).toHaveAttribute("href", "https://doi.org/10.1063/1.459170");
  await expect(paper).toHaveAttribute("target", "_blank");
  await expect(paper).toHaveAttribute("rel", "noopener noreferrer");
  expect(await paper.evaluate((el) => getComputedStyle(el).color)).toBe(await hintOf(tab));
  await expect(chat.getByText("[the Tully paper]")).toHaveCount(0);

  // The bare address is a link to itself, and the full stop after it is
  // the sentence's.
  const bare = chat.getByRole("link", { name: "https://doi.org/10.1063/1.1376633" });
  await expect(bare).toHaveAttribute("href", "https://doi.org/10.1063/1.1376633");

  // The javascript: link is the literal text, and nothing in the reply
  // links to it; the address in the code span stays code.
  await expect(chat.getByText("[click to fix the build](javascript:document.title='ran')")).toBeVisible();
  await expect(chat.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(chat.locator("code", { hasText: "curl https://doi.org/10.1063/1.459170" })).toBeVisible();
  await expect(chat.getByRole("link")).toHaveCount(2);

  // Following it opens a new tab on that address, with no way back to
  // this one, and leaves the app where it was.
  const opened = await follow(context, paper);
  expect(opened.url()).toBe("https://doi.org/10.1063/1.459170");
  expect(await opened.evaluate(() => window.opener)).toBeNull();
  await opened.close();
  await expect(tab.locator(".cm-editor")).toBeVisible();
  expect(await tab.title()).not.toBe("ran");

  // The keyboard reaches it, with the hint's ring.  A key first, since
  // the browser shows the ring for focus that came from the keyboard, and
  // the last thing to happen here was a click.
  await tab.keyboard.press("Shift");
  await paper.focus();
  const ring = await paper.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), colour: style.outlineColor };
  });
  // Two pixels before the interface size scales the shell, so at least two.
  expect(ring.style).toBe("solid");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(ring.colour).toBe(await hintOf(tab));
});

test("a link in the Markdown preview is a link too, on its paper", async ({ app, project, page }) => {
  writeFileSync(
    join(project.root, "reading.md"),
    "# Reading list\n\nStart from [Tully, 1990](https://doi.org/10.1063/1.459170), then the review at https://doi.org/10.1146/annurev-physchem-052516-050721.\n\nNot [this one](data:text/html;base64,PHNjcmlwdD4=).\n",
  );
  await answerDoi(page.context());
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await page.locator('[role="tree"] [data-path="reading.md"]').click();
  const view = page.getByTestId("markdown-view");
  await expect(view).toBeVisible({ timeout: 15_000 });

  const tully = view.getByRole("link", { name: "Tully, 1990" });
  await expect(tully).toHaveAttribute("href", "https://doi.org/10.1063/1.459170");
  await expect(view.getByRole("link", { name: "https://doi.org/10.1146/annurev-physchem-052516-050721" })).toBeVisible();
  await expect(view.getByText("[this one](data:text/html;base64,PHNjcmlwdD4=)")).toBeVisible();
  await expect(view.getByRole("link")).toHaveCount(2);

  // On the paper the hint is the light theme's, whatever the shell's.
  const ink = await tully.evaluate((el) => getComputedStyle(el).color);
  expect(ink).toBe("rgb(0, 98, 109)");

  const opened = await follow(page.context(), tully);
  expect(opened.url()).toBe("https://doi.org/10.1063/1.459170");
  await opened.close();
});
