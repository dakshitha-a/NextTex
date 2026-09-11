import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

/** The end-to-end look.
 *
 *  Not a check: this renders every surface at every breakpoint in both
 *  themes and writes the images somewhere a person -- or a reviewer with
 *  the design document open -- can go through them. It asserts almost
 *  nothing, because what it is looking for is the thing nobody thought to
 *  assert.
 */

const OUT =
  process.env.NEXTTEX_SWEEP_DIR ??
  path.join(process.cwd(), "shots", "sweep");

// Straddling the app's own breakpoints: the chat column becomes an overlay
// below 1400, the file rail hides below 1100, and the source and the page
// share one view below 900.
const WIDTHS = [1600, 1300, 1000, 800];
const THEMES = ["light", "dark"] as const;

function shot(page: Page, name: string, theme: string, width: number) {
  fs.mkdirSync(OUT, { recursive: true });
  return page.screenshot({
    path: path.join(OUT, `${name}--${theme}--${width}.png`),
  });
}

async function dress(page: Page, theme: string, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.evaluate((t) => {
    window.localStorage.setItem("nexttex.theme", t);
    // Widths are remembered per project, and a run at 1600 would otherwise
    // hand its choices to the run at 800.
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("nexttex.widths.") || key.startsWith("nexttex.folded.")) {
        window.localStorage.removeItem(key);
      }
    }
  }, theme);
  await page.reload();
  await page.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
}

async function seed(page: Page, base: string, token: string, id: string) {
  const files = [
    "chapters/01_introduction.tex",
    "chapters/02_theory.tex",
    "chapters/03_results.tex",
    "chapters/figures/spectrum.tex",
    "appendices/permissions.tex",
  ];
  for (const file of files) {
    await page.evaluate(
      async ({ base, token, id, file }) => {
        await fetch(`${base}/api/projects/${id}/file`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-nexttex-token": token,
          },
          body: JSON.stringify({
            path: file,
            text: `% ${file}\n\\section{A section}\nSome prose.\n`,
            compile: false,
            create: true,
          }),
        });
      },
      { base, token, id, file },
    );
  }
}

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

test("every pane at every width, in both themes", async ({
  app, project, tab,
}) => {
  await seed(tab, app.base, app.token, project.id);

  // A second document, so the preview strip renders as a strip rather than
  // as the solo "Preview" label.  Without one the sweep photographed the
  // tabbed pane 72 times and never once showed a tab -- which is how the
  // whole feature went unreviewed.
  fs.writeFileSync(
    path.join(project.root, "esi.tex"),
    "\\documentclass{article}\n\\begin{document}\n"
      + "Supplementary information.\n\\end{document}\n",
  );
  const registered = await fetch(`${app.base}/api/projects/${project.id}/previews`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: "esi.tex" }),
  });
  if (!registered.ok) throw new Error(`preview not registered: ${await registered.text()}`);
  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      await dress(tab, theme, width);
      await shot(tab, "01-rest", theme, width);

      // The file list, searching, and a row menu.
      if (width >= 1100) {
        await tab.getByTestId("file-search-open").click();
        await tab.getByTestId("file-search").fill("the");
        await tab.waitForTimeout(300);
        await shot(tab, "02-search", theme, width);
        await tab.getByTestId("file-search").fill("zzzz");
        await tab.waitForTimeout(300);
        await shot(tab, "03-search-empty", theme, width);
        await tab.getByTestId("file-search").press("Escape");
        await tab.getByTestId("file-search").press("Escape");

        await tab.getByLabel("Actions for main.tex").click({ force: true });
        await tab.waitForTimeout(200);
        await shot(tab, "04-row-menu", theme, width);
        await tab.keyboard.press("Escape");

        // The rail as navigation: sections beside the files, and sections
        // with the whole rail once the files are folded away.
        await tab.getByTestId("files-toggle").click();
        await tab.waitForTimeout(200);
        await shot(tab, "07-sections-alone", theme, width);
        await tab.getByTestId("files-toggle").click();
        await tab.getByTestId("sections-toggle").click();
        await tab.waitForTimeout(200);
        await shot(tab, "08-sections-folded", theme, width);
        await tab.getByTestId("sections-toggle").click();
      }

      // The agent column: the controls under the composer.
      const model = tab.getByTestId("model-open");
      if (await model.count()) {
        if (!(await model.isVisible())) {
          // By testid.  This used to match a button whose text was
          // "Claude"; the control is a pill with an aria-label now, so the
          // old locator quietly matched nothing and every narrow shot was
          // of a panel that had never opened.
          await tab.getByTestId("agent-button-claude").click().catch(() => undefined);
          await tab.waitForTimeout(250);
        }
        if (await model.isVisible()) {
          await model.click();
          await tab.waitForTimeout(200);
          await shot(tab, "05-model-menu", theme, width);
          await tab.keyboard.press("Escape");
          await tab.getByTestId("clear-chat").click();
          await tab.waitForTimeout(200);
          await shot(tab, "06-clear-confirm", theme, width);
          await tab.getByTestId("clear-chat").click();
        }
      }
    }
  }
});

test("the agent column, mid-turn and at rest", async ({ tab }) => {
  for (const theme of THEMES) {
    await dress(tab, theme, 1600);
    await shot(tab, "10-chat-welcome", theme, 1600);

    // Working, with a tool in flight rather than prose.
    await ask(tab, "working", "Read the theory chapter.");
    await expect(tab.getByTestId("working")).toBeVisible({ timeout: 20_000 });
    await tab.waitForTimeout(400);
    await shot(tab, "11-working-tool", theme, 1600);
    await expect(tab.getByTestId("working")).toBeHidden({ timeout: 40_000 });
    await shot(tab, "12-after-turn", theme, 1600);

    // A permission card: the surface the writer says renders jankily.
    await ask(tab, "permission", "Run something.");
    await expect(tab.getByTestId("allow")).toBeVisible({ timeout: 20_000 });
    await shot(tab, "13-card", theme, 1600);
    // Shielded: within 350 ms of arriving the buttons ignore clicks.
    await tab.getByTestId("allow").hover();
    await shot(tab, "14-card-hover-allow", theme, 1600);
    await tab.getByTestId("always").hover();
    await tab.waitForTimeout(150);
    await shot(tab, "15-card-hover-always", theme, 1600);
    await tab.getByTestId("allow").click();
    await tab.waitForTimeout(600);
    await shot(tab, "16-card-answered", theme, 1600);

    // Auto mode: the chip, and a card that arrives already answered.
    await tab.getByTestId("auto-toggle").click();
    await tab.getByTestId("mode-project").click();
    await tab.waitForTimeout(200);
    await shot(tab, "17-auto-on", theme, 1600);
    await ask(tab, "permission", "Run it again.");
    await expect(tab.getByTestId("decided-auto")).toBeVisible({ timeout: 20_000 });
    await tab.waitForTimeout(400);
    await shot(tab, "18-auto-decided", theme, 1600);
    await tab.getByTestId("auto-chip").click();

    // What it reads, with a memory in it.
    await ask(tab, "remember", "Remember where the data came from.");
    await tab.waitForTimeout(1500);
    await tab.getByRole("button", { name: /What .* reads/ }).click();
    await tab.waitForTimeout(300);
    await shot(tab, "19-context-memory", theme, 1600);
    await tab.getByTestId("memory-edit").click();
    await tab.waitForTimeout(200);
    await shot(tab, "20-memory-editing", theme, 1600);
  }
});

/** The surfaces the agent rework added, which is what section 28 has to be
 *  read against: a permission control with three positions and the sentence
 *  in front of the quietest one, the turn's own plan, the four-button card,
 *  the verbs over a selection, and an image attached to a question. */
test("the agent panel's new surfaces", async ({ app, project, tab }) => {
  await seed(tab, app.base, app.token, project.id);
  for (const theme of THEMES) {
    await dress(tab, theme, 1600);
    // No click on the floating pill: at 1600 the panel is already docked,
    // and that control toggles it, so pressing it here shut the thing being
    // photographed.
    // The control, open, with all three positions and what each one says.
    // It is drawn only once the panel has heard back that this agent is the
    // kind that ever asks, which is one round trip after the first paint.
    await tab.getByTestId("auto-toggle").waitFor({ timeout: 20_000 });
    await tab.getByTestId("auto-toggle").click();
    await tab.waitForTimeout(250);
    await shot(tab, "21-mode-menu", theme, 1600);

    // The sentence in front of the position that asks about nothing.
    await tab.getByTestId("mode-all").click();
    await tab.waitForTimeout(300);
    await shot(tab, "22-all-confirm", theme, 1600);
    await tab.getByTestId("all-keep").click();
    await tab.waitForTimeout(200);

    // The turn's own plan, ticking itself off, and the activity line with
    // its two counters.
    await ask(tab, "plan", "Rewrite the theory chapter.");
    await tab.waitForTimeout(1200);
    await shot(tab, "23-turn-plan", theme, 1600);
    await tab.waitForTimeout(4000);
    await shot(tab, "24-plan-done", theme, 1600);

    // Four buttons now, at the panel's minimum width as well as at 1600,
    // because that row is the one section 5's wrapping note is about.
    await ask(tab, "network", "Fetch that page.");
    await expect(tab.getByTestId("allow")).toBeVisible({ timeout: 20_000 });
    await tab.waitForTimeout(600);
    await shot(tab, "25-card-four-answers", theme, 1600);
    await tab.getByTestId("conversation").hover();
    await tab.waitForTimeout(250);
    await shot(tab, "26-card-conversation-scope", theme, 1600);
    await tab.getByTestId("deny").click();
    await tab.waitForTimeout(400);

    // An image on a question.
    await tab.setInputFiles("#nx-attach", {
      name: "referee.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAKUlEQVR42u3NMQ0AMAwDsO7/o8skLyBBQ0c7tmwZAAAAAAAAAAAAAADgDwGBAAFRtYFuAAAAAElFTkSuQmCC",
        "base64",
      ),
    });
    await tab.waitForTimeout(700);
    await shot(tab, "27-attached", theme, 1600);

    // The verbs over a selection, in the editor rather than the panel.
    const content = tab.locator(".cm-editor .cm-content");
    await content.click();
    await tab.keyboard.press("Control+Home");
    for (let i = 0; i < 6; i += 1) await tab.keyboard.press("ArrowDown");
    await tab.keyboard.press("Home");
    await tab.keyboard.press("Shift+End");
    await tab.waitForTimeout(400);
    await shot(tab, "28-selection-verbs", theme, 1600);
  }
});

test("panes folded, and dragged to their limits", async ({ tab }) => {
  for (const theme of THEMES) {
    await dress(tab, theme, 1600);

    // The reported bug: the agent panel expanding behind the preview.
    const handles = tab.locator(".nx-handle");
    const count = await handles.count();
    if (count >= 2) {
      const box = (await handles.nth(count - 1).boundingBox())!;
      await tab.mouse.move(box.x + 1, box.y + 300);
      await tab.mouse.down();
      await tab.mouse.move(box.x - 600, box.y + 300, { steps: 20 });
      await tab.mouse.up();
      await tab.waitForTimeout(400);
      await shot(tab, "30-chat-dragged-wide", theme, 1600);

      const railBox = (await handles.nth(0).boundingBox())!;
      await tab.mouse.move(railBox.x + 1, railBox.y + 300);
      await tab.mouse.down();
      await tab.mouse.move(railBox.x + 600, railBox.y + 300, { steps: 20 });
      await tab.mouse.up();
      await tab.waitForTimeout(400);
      await shot(tab, "31-rail-dragged-wide", theme, 1600);
    }

    // And with the window then made too narrow to honour those widths.
    await tab.setViewportSize({ width: 1000, height: 1000 });
    await tab.waitForTimeout(600);
    await shot(tab, "32-then-narrowed", theme, 1000);
  }
});
