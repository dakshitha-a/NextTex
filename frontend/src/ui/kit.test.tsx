import { act } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { Button, IconButton } from "./Button";
import { Chip, ChipToggle, Empty, Field, Heading, Input, Kbd, Pressable, Row, Segmented, Select, Switch } from "./controls";
import { Menu, MenuDivider, MenuItem } from "./Menu";
import { Sheet } from "./Sheet";
import { FloatingCard, shellTheme } from "./FloatingCard";
import { SearchIcon } from "./icons";
import { mount } from "./mount";

// React 19 wants this flag to be told the environment supports act.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  delete document.documentElement.dataset.theme;
});

describe("Button", () => {
  test("carries its variant and size as data, and passes every attribute through", () => {
    const m = (mounted = mount(
      <Button variant="danger" size="inline" data-testid="x" aria-pressed="true" title="Delete it" disabled>
        Delete
      </Button>,
    ));
    const b = m.container.querySelector("button")!;
    expect(b.dataset.variant).toBe("danger");
    expect(b.dataset.size).toBe("inline");
    expect(b.dataset.testid).toBe("x");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.title).toBe("Delete it");
    expect(b.disabled).toBe(true);
    expect(b.type).toBe("button");
    expect(b.className).toBe("nx-button");
  });

  test("an icon button is named, and shows its on state", () => {
    const m = (mounted = mount(
      <IconButton label="Find a file" on>
        <SearchIcon />
      </IconButton>,
    ));
    const b = m.container.querySelector("button")!;
    expect(b.getAttribute("aria-label")).toBe("Find a file");
    expect(b.title).toBe("Find a file");
    expect(b.dataset.on).toBe("true");
    expect(b.classList.contains("nx-tap")).toBe(true);
    expect(b.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Menu", () => {
  test("focuses its first item on open, walks with the arrows, and closes on Escape", () => {
    let closed = 0;
    const m = (mounted = mount(
      <Menu open onClose={() => closed++} wanted={{ left: 10, top: 10 }} testid="m" label="File">
        <MenuItem hint="F2">Rename</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuDivider />
        <MenuItem danger hint="Del">Move to trash</MenuItem>
      </Menu>,
    ));
    const menu = m.container.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.dataset.testid).toBe("m");
    expect(menu.getAttribute("aria-label")).toBe("File");
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    expect(items.map((i) => i.textContent)).toEqual(["RenameF2", "Duplicate", "Move to trashDel"]);
    expect(document.activeElement).toBe(items[0]);
    expect(items[2].dataset.danger).toBe("true");
    expect(menu.querySelector('[role="separator"]')).not.toBeNull();
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(items[1]);
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(items[2]);
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closed).toBeGreaterThanOrEqual(1);
  });

  test("a menu without a role has plain buttons a spec finds by name", () => {
    const m = (mounted = mount(
      <Menu open onClose={() => {}} wanted={{ left: 0, top: 0 }} role="none">
        <MenuItem role="none">Move to trash</MenuItem>
      </Menu>,
    ));
    expect(m.container.querySelector('[role="menu"]')).toBeNull();
    const b = m.container.querySelector("button")!;
    expect(b.getAttribute("role")).toBeNull();
    expect(b.textContent).toBe("Move to trash");
  });

  test("renders nothing when closed", () => {
    const m = (mounted = mount(
      <Menu open={false} onClose={() => {}} wanted={{ left: 0, top: 0 }}>
        <MenuItem>Rename</MenuItem>
      </Menu>,
    ));
    expect(m.container.innerHTML).toBe("");
  });
});

describe("Sheet", () => {
  test("is a modal dialog named and tagged on the sheet, not the scrim", () => {
    const m = (mounted = mount(
      <Sheet open onClose={() => {}} label="Settings" testid="settings-sheet">
        <button>Done</button>
      </Sheet>,
    ));
    const dialog = m.container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Settings");
    expect(dialog.dataset.testid).toBe("settings-sheet");
    expect(dialog.parentElement?.classList.contains("nx-scrim")).toBe(true);
    expect(document.activeElement?.textContent).toBe("Done");
  });
});

describe("controls", () => {
  test("a switch is a switch, and reports its new state", () => {
    let last: boolean | null = null;
    const m = (mounted = mount(<Switch checked={false} onChange={(v) => (last = v)} aria-label="Spelling" />));
    const s = m.container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(s.getAttribute("aria-checked")).toBe("false");
    act(() => s.click());
    expect(last).toBe(true);
  });

  test("a toggle chip is a pressed button that reports its new state", () => {
    let last: boolean | null = null;
    const m = (mounted = mount(<ChipToggle pressed={false} onChange={(v) => (last = v)} data-testid="hover-tables">Tables</ChipToggle>));
    const chip = m.container.querySelector("button") as HTMLButtonElement;
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.classList.contains("nx-chip")).toBe(true);
    expect(chip.classList.contains("nx-chip-toggle")).toBe(true);
    expect(chip.dataset.testid).toBe("hover-tables");
    expect(chip.textContent).toBe("Tables");
    act(() => chip.click());
    expect(last).toBe(true);
  });

  test("a segmented choice is a group of pressed buttons with their testids", () => {
    let chosen = "";
    const m = (mounted = mount(
      <Segmented
        label="Theme"
        value="dark"
        onChange={(v) => (chosen = v)}
        options={[
          { value: "light", label: "Light", testid: "theme-light" },
          { value: "dark", label: "Dark", testid: "theme-dark" },
        ]}
      />,
    ));
    const group = m.container.querySelector('[role="group"]') as HTMLElement;
    expect(group.getAttribute("aria-label")).toBe("Theme");
    const [light, dark] = Array.from(group.querySelectorAll("button")) as HTMLButtonElement[];
    expect(light.dataset.testid).toBe("theme-light");
    expect(light.getAttribute("aria-pressed")).toBe("false");
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    act(() => light.click());
    expect(chosen).toBe("light");
  });

  test("a field puts the spec's attributes on the input", () => {
    const m = (mounted = mount(<Field placeholder="Find a file" aria-label="Find a file" data-testid="file-search" leading={<SearchIcon />} />));
    const input = m.container.querySelector("input")!;
    expect(input.placeholder).toBe("Find a file");
    expect(input.dataset.testid).toBe("file-search");
    expect(input.parentElement?.classList.contains("nx-field")).toBe(true);
    expect(input.parentElement?.querySelector("svg")).not.toBeNull();
  });

  test("a chip removes by a named button; a row reveals its trailing slot", () => {
    let removed = 0;
    const m = (mounted = mount(
      <>
        <Chip mono onRemove={() => removed++} removeLabel="Forget nonadiabatic">nonadiabatic</Chip>
        <Row selected leading={<SearchIcon />} trailing={<button>Actions</button>}>main.tex</Row>
      </>,
    ));
    const remove = m.container.querySelector('[aria-label="Forget nonadiabatic"]') as HTMLButtonElement;
    act(() => remove.click());
    expect(removed).toBe(1);
    const row = m.container.querySelector(".nx-row") as HTMLElement;
    expect(row.dataset.selected).toBe("true");
    expect(row.querySelector(".nx-row-trailing")?.textContent).toBe("Actions");
  });

  test("keys sit with nothing between them, a heading is a heading, an empty state is a sentence", () => {
    const m = (mounted = mount(
      <>
        <span data-testid="chord"><Kbd>⌘</Kbd><Kbd>⌥</Kbd><Kbd>⇧</Kbd><Kbd>T</Kbd></span>
        <Heading>Sections</Heading>
        <Empty action={<button>Keep versions here</button>}>Nothing yet.</Empty>
      </>,
    ));
    expect(m.container.querySelector('[data-testid="chord"]')?.textContent).toBe("⌘⌥⇧T");
    expect(m.container.querySelector("h2")?.textContent).toBe("Sections");
    expect(m.container.querySelector(".nx-empty p")?.textContent).toBe("Nothing yet.");
  });

  test("a floating card takes the shell's palette, not its host's", () => {
    document.documentElement.dataset.theme = "light";
    expect(shellTheme()).toBe("nx-theme-light");
    const m = (mounted = mount(<FloatingCard testid="c">hello</FloatingCard>));
    expect(m.container.querySelector(".nx-card")?.classList.contains("nx-theme-light")).toBe(true);
    document.documentElement.dataset.theme = "dark";
    expect(shellTheme()).toBe("nx-theme-dark");
  });
});


describe("the pass-through parts", () => {
  // Pressable, Input and Select take their look from their place, as
  // TextArea does, so what matters is that they add nothing and lose
  // nothing (Q-038).
  test("Pressable is a button that never submits unless told, with every attribute and its ref", () => {
    let ref: HTMLButtonElement | null = null;
    const m = (mounted = mount(
      <form>
        <Pressable ref={(el) => { ref = el; }} className="nx-row" data-testid="p" aria-pressed="true">Row</Pressable>
        <Pressable type="submit">Go</Pressable>
      </form>,
    ));
    const [row, go] = Array.from(m.container.querySelectorAll("button"));
    expect(row.type).toBe("button");
    expect(row.className).toBe("nx-row");
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(ref).toBe(row);
    expect(go.type).toBe("submit");
  });

  test("Input and Select pass everything through and add no class", () => {
    const m = (mounted = mount(
      <div>
        <Input type="checkbox" defaultChecked data-testid="c" />
        <Select defaultValue="b" aria-label="Pick">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
      </div>,
    ));
    const box = m.container.querySelector("input")!;
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(true);
    expect(box.className).toBe("");
    const pick = m.container.querySelector("select")!;
    expect(pick.value).toBe("b");
    expect(pick.getAttribute("aria-label")).toBe("Pick");
  });
});
