import { afterEach, describe, expect, it } from "vitest";
import { walkGrid, walkMenu } from "./panes/menu-keys";

/** A menu of rows, each row a few chips, the download menu's shape:
 *  the project row has one chip and each document row has one or four. */
function grid(rows: string[][]): HTMLElement {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  for (const chips of rows) {
    const row = document.createElement("div");
    row.setAttribute("data-menu-row", "");
    for (const chip of chips) {
      const button = document.createElement("button");
      button.setAttribute("role", "menuitem");
      button.dataset.id = chip;
      row.appendChild(button);
    }
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  return menu;
}

function press(menu: HTMLElement, key: string, onClose = () => {}): boolean {
  let prevented = false;
  const event = {
    key,
    currentTarget: menu,
    preventDefault: () => { prevented = true; },
  } as unknown as import("react").KeyboardEvent<HTMLElement>;
  const taken = walkGrid(event, onClose);
  expect(prevented).toBe(taken);
  return taken;
}

const focused = () => (document.activeElement as HTMLElement | null)?.dataset.id;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("walkGrid", () => {
  const rows = [["zip"], ["a.pdf", "a.docx", "a.html", "a.md"], ["b.pdf"]];

  it("moves down a column and stops at a shorter row's last chip", () => {
    const menu = grid(rows);
    menu.querySelector<HTMLElement>("[data-id='a.html']")!.focus();
    press(menu, "ArrowDown");
    expect(focused()).toBe("b.pdf");
    press(menu, "ArrowUp");
    // Back up into the four-chip row at the column it came from, which
    // is the third; the row it left kept no memory of the fourth.
    expect(focused()).toBe("a.pdf");
  });

  it("wraps from the last row to the first and back", () => {
    const menu = grid(rows);
    menu.querySelector<HTMLElement>("[data-id='b.pdf']")!.focus();
    press(menu, "ArrowDown");
    expect(focused()).toBe("zip");
    press(menu, "ArrowUp");
    expect(focused()).toBe("b.pdf");
  });

  it("walks along a row and stops at its ends", () => {
    const menu = grid(rows);
    menu.querySelector<HTMLElement>("[data-id='a.pdf']")!.focus();
    press(menu, "ArrowLeft");
    expect(focused()).toBe("a.pdf");
    press(menu, "ArrowRight");
    press(menu, "ArrowRight");
    press(menu, "ArrowRight");
    press(menu, "ArrowRight");
    expect(focused()).toBe("a.md");
  });

  it("Home and End are the first and last rows, Escape closes", () => {
    const menu = grid(rows);
    menu.querySelector<HTMLElement>("[data-id='a.docx']")!.focus();
    press(menu, "End");
    expect(focused()).toBe("b.pdf");
    press(menu, "Home");
    expect(focused()).toBe("zip");
    let closed = false;
    press(menu, "Escape", () => { closed = true; });
    expect(closed).toBe(true);
  });

  it("with nothing focused yet, Down is the first row and Up the last", () => {
    const menu = grid(rows);
    press(menu, "ArrowDown");
    expect(focused()).toBe("zip");
    (document.activeElement as HTMLElement).blur();
    press(menu, "ArrowUp");
    expect(focused()).toBe("b.pdf");
  });

  it("leaves other keys to the caller, as walkMenu does", () => {
    const menu = grid(rows);
    expect(press(menu, "Tab")).toBe(false);
    const event = {
      key: "Tab", currentTarget: menu, preventDefault: () => {},
    } as unknown as import("react").KeyboardEvent<HTMLElement>;
    expect(walkMenu(event, () => {})).toBe(false);
  });
});
