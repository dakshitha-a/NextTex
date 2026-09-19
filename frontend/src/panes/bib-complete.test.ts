import { describe, expect, test } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { ENTRY_TYPES, bibSource, enclosingType, entrySnippet } from "./bib-complete";

function at(text: string, explicit = false) {
  const state = EditorState.create({ doc: text });
  return bibSource(new CompletionContext(state, text.length, explicit));
}

const labels = (text: string, explicit = false) =>
  (at(text, explicit)?.options ?? []).map((option) => option.label);

describe("the entry types", () => {
  test("an @ at the start of a line offers every type", () => {
    const offered = labels("@");
    expect(offered).toContain("@article");
    expect(offered).toContain("@inproceedings");
    expect(offered.length).toBe(Object.keys(ENTRY_TYPES).length);
  });

  test("the typed head is what gets replaced", () => {
    expect(at("@art")!.from).toBe(0);
    expect(at("  @art")!.from).toBe(2);
  });

  test("an @ in the middle of a line is not a new entry", () => {
    expect(at("  author = {a@b")).toBeNull();
  });

  test("the snippet has the key first and the required fields as stops", () => {
    expect(entrySnippet("article")).toBe(
      "@article{#{key},\n  author = {#{}},\n  title = {#{}},\n  journal = {#{}},\n  year = {#{}},\n}",
    );
    expect(entrySnippet("misc")).toBe("@misc{#{key},\n}");
  });
});

describe("the fields", () => {
  test("a word at the start of a line inside an entry offers that type's fields, required first", () => {
    const offered = labels("@article{k,\n  author = {A},\n  j");
    expect(offered.slice(0, 4)).toEqual(["author", "title", "journal", "year"]);
    expect(offered).toContain("doi");
  });

  test("outside an entry, or after its closing brace, nothing", () => {
    expect(at("j")).toBeNull();
    expect(at("@article{k,\n  title = {T}\n}\nj")).toBeNull();
  });

  test("an empty line offers fields only when asked", () => {
    const text = "@book{k,\n";
    expect(at(text)).toBeNull();
    expect(labels(text, true)).toContain("publisher");
  });

  test("the enclosing type is read case-insensitively", () => {
    const state = EditorState.create({ doc: "@ARTICLE{k,\n  x" });
    expect(enclosingType(state.doc, state.doc.length)).toBe("article");
  });
});

describe("the table agrees with the Python one", () => {
  test("every type the check knows has a snippet", () => {
    for (const type of ["article", "book", "inproceedings", "incollection", "phdthesis",
      "mastersthesis", "techreport", "unpublished", "manual", "proceedings", "booklet", "misc"]) {
      expect(ENTRY_TYPES[type], type).toBeDefined();
    }
  });
});
