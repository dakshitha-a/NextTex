import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The conversation panel, driven by a scripted stand-in.
 *
 *  The real agent needs an account, costs money and answers differently
 *  every time, so none of this had ever been exercised.  The stand-in
 *  replays a fixed list of steps through the same event queue, and its
 *  `edit` step performs a real write -- so the version, the rebuild, the
 *  chip and its undo all run for real.
 */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

test("an answer streams in and stays in the transcript", async ({ tab }) => {
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({
    timeout: 20_000,
  });
});

test("an edit lands in the file and offers to be undone", async ({
  app, project, tab,
}) => {
  await ask(tab, "edit", "Add a sentence above the equation.");
  await expect(tab.getByText("main.tex").first()).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(
      async () =>
        (
          await fetch(`${app.base}/api/projects/${project.id}/file?path=main.tex`, {
            headers: { "x-nexttex-token": app.token },
          }).then((r) => r.json())
        ).text,
      { timeout: 20_000 },
    )
    .toContain("A sentence the scripted agent inserted.");

  const undo = tab.getByRole("button", { name: /undo/i }).first();
  await expect(undo).toBeVisible({ timeout: 20_000 });
  await undo.click();

  await expect
    .poll(
      async () =>
        (
          await fetch(`${app.base}/api/projects/${project.id}/file?path=main.tex`, {
            headers: { "x-nexttex-token": app.token },
          }).then((r) => r.json())
        ).text,
      { timeout: 20_000 },
    )
    .not.toContain("A sentence the scripted agent inserted.");
});

test("an agent edit is a version of its own, kept apart from yours", async ({
  app, project, tab,
}) => {
  await ask(tab, "edit", "Add a sentence above the equation.");
  await expect
    .poll(
      async () => {
        const body = await fetch(
          `${app.base}/api/projects/${project.id}/history?path=main.tex`,
          { headers: { "x-nexttex-token": app.token } },
        ).then((r) => r.json());
        return body.versions.map((v: any) => v.by);
      },
      { timeout: 20_000 },
    )
    .toContain("claude");
});

test("a shell command asks first, and the buttons are not clickable instantly", async ({
  tab,
}) => {
  await ask(tab, "permission", "Run the command.");
  // By handle, not by name: the card shows its keyboard hint inside the
  // button once it has focus, so the accessible name changes under you.
  const allow = tab.getByTestId("allow");
  await expect(allow).toBeVisible({ timeout: 20_000 });
  // A card that appears under a moving cursor must not be answerable by the
  // click that was already on its way.
  await expect(allow).toBeDisabled();
  await expect(allow).toBeEnabled({ timeout: 5_000 });
  await allow.click();
  await expect(tab.getByText("Done.")).toBeVisible({ timeout: 20_000 });
});

test("a command that runs more than one command is never remembered", async ({
  tab,
}) => {
  await ask(tab, "shellsyntax", "Run the compound command.");
  await expect(
    tab.getByText("This one is asked every time"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(tab.getByTestId("always")).toHaveCount(0);
});

test("a second question while Claude is writing goes next, not nowhere", async ({
  tab,
}) => {
  await ask(tab, "slow", "The long one.");
  // The sign that a turn is running now lives in the header, and says what
  // is being done rather than always claiming prose is being written.
  await expect(tab.getByTestId("working")).toBeVisible({ timeout: 20_000 });
  const composer = tab.locator("textarea");
  await composer.fill("And then this one.");
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByText("yours will go next")).toBeVisible();
});

test("the panel says what the agent is doing, not just that it is busy", async ({
  tab,
}) => {
  // A turn can sit inside a tool for many seconds with no prose arriving.
  // The panel used to show the same "is writing" line throughout, which
  // read as a panel that had stopped.
  await ask(tab, "working", "Read the theory chapter.");
  const working = tab.getByTestId("working");
  await expect(working).toBeVisible({ timeout: 20_000 });
  await expect(working).toContainText("Read");
  await expect(working).toContainText("02_theory.tex");
  // And it goes away when the turn does.
  await expect(working).toBeHidden({ timeout: 30_000 });
});

test("a new conversation empties the panel and keeps the tally", async ({
  tab,
}) => {
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({
    timeout: 20_000,
  });

  await tab.getByTestId("chat-menu-open").click();
  await tab.getByTestId("clear-chat").click();
  await tab.getByTestId("clear-confirm").click();

  await expect(tab.getByText(/A label attaches a name/)).toBeHidden();
  // The welcome message is what an empty conversation looks like, so a
  // cleared one lands on the right surface without anything extra.
  await expect(tab.getByRole("button", { name: /voice/i }).first()).toBeVisible();

  // Cleared conversations do not clear what the project has cost.
  await tab.getByRole("button", { name: "Usage" }).click();
  await expect(tab.getByText(/turn/)).toBeVisible();
});

test("a cleared conversation stays cleared after a reload", async ({ tab }) => {
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({
    timeout: 20_000,
  });
  await tab.getByTestId("chat-menu-open").click();
  await tab.getByTestId("clear-chat").click();
  await tab.getByTestId("clear-confirm").click();
  await expect(tab.getByText(/A label attaches a name/)).toBeHidden();

  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(tab.getByText(/A label attaches a name/)).toBeHidden();
});

test("the usage panel closes from the button that opened it", async ({ tab }) => {
  // The press that dismisses a popover arrives in the capture phase,
  // before the trigger's own click, so without an anchor this closed and
  // immediately reopened.
  const usage = tab.getByRole("button", { name: "Usage" });
  await usage.click();
  await expect(tab.getByText("estimated, this project")).toBeVisible();
  await usage.click();
  await expect(tab.getByText("estimated, this project")).toBeHidden();
});

test("auto mode approves without a card, and says so in the record", async ({
  tab,
}) => {
  await tab.getByTestId("chat-menu-open").click();
  await tab.getByTestId("auto-toggle").click();
  await expect(tab.getByTestId("auto-chip")).toBeVisible();

  await ask(tab, "permission", "Run something.");
  // No card to answer, and the composer is not left waiting on one.
  await expect(tab.getByTestId("decided-auto")).toBeVisible({ timeout: 20_000 });
  await expect(tab.getByTestId("allow")).toHaveCount(0);

  // Turning it off brings the card back.
  await tab.getByTestId("auto-chip").click();
  await expect(tab.getByTestId("auto-chip")).toHaveCount(0);
  await ask(tab, "permission", "Run something again.");
  await expect(tab.getByTestId("allow")).toBeVisible({ timeout: 20_000 });
  await tab.getByTestId("allow").click();
});

test("what the agent is told to remember survives a new conversation", async ({
  tab,
}) => {
  await ask(tab, "remember", "Remember where chapter 3's data came from.");
  await expect(tab.getByText(/Stony Brook/).first()).toBeVisible({
    timeout: 20_000,
  });

  await tab.getByTestId("chat-menu-open").click();
  await tab.getByTestId("clear-chat").click();
  await tab.getByTestId("clear-confirm").click();
  await expect(tab.getByText(/Stony Brook/)).toHaveCount(0);

  // Gone from the conversation, still on the shelf the agent reads from.
  await tab.getByRole("button", { name: /What .* reads/ }).click();
  await expect(tab.getByTestId("memory-text")).toContainText("Stony Brook");
});

test("the memory can be corrected by hand", async ({ tab }) => {
  await tab.getByRole("button", { name: /What .* reads/ }).click();
  await tab.getByTestId("memory-edit").click();
  await tab.getByTestId("memory-editor").fill("- The supervisor is Prof. Matsika");
  await tab.getByTestId("memory-save").click();
  await expect(tab.getByTestId("memory-text")).toContainText("Matsika");
});

test("the permission card does not move while you reach for it", async ({
  tab,
}) => {
  // The jank: focusing the card appended a keyboard hint inside each
  // button, and hovering "Allow always" added a line above them.  Both
  // changed the layout, so the buttons shifted out from under a cursor
  // that was travelling towards them -- and moving away put them back,
  // which made the pointer oscillate.  Playwright saw it as an element
  // that never became stable; a person sees it as a card that will not
  // hold still.
  await ask(tab, "permission", "Run something.");
  const allow = tab.getByTestId("allow");
  await expect(allow).toBeVisible({ timeout: 20_000 });
  // Past the 350 ms shield, so the buttons are live and the geometry is
  // the one a person would be clicking.
  await tab.waitForTimeout(500);

  const before = (await allow.boundingBox())!;
  await tab.getByTestId("always").hover();
  await tab.waitForTimeout(250);
  const hovered = (await allow.boundingBox())!;
  await allow.hover();
  await tab.waitForTimeout(250);
  const focused = (await allow.boundingBox())!;

  for (const after of [hovered, focused]) {
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  }
  await allow.click();
});
