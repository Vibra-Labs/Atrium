import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteContent, insertMention, mentionQuery, toNoteContent } from "./mentions";

describe("mentionQuery", () => {
  it("finds the @word being typed at the caret", () => {
    expect(mentionQuery("Call @an", 8)).toEqual({ start: 5, query: "an" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("Call @Ann L", 11)).toEqual({ start: 5, query: "Ann L" });
  });

  it("ignores emails, finished lines and text after the caret", () => {
    expect(mentionQuery("me@ann.com", 10)).toBeNull();
    expect(mentionQuery("@ann\nnext", 9)).toBeNull();
    expect(mentionQuery("no at here", 10)).toBeNull();
    expect(mentionQuery("@ ", 2)).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces the typed @query with the picked name and puts the caret after it", () => {
    expect(insertMention("Call @an please", 5, 8, "Ann Lee")).toEqual({
      text: "Call @Ann Lee  please",
      caret: 14,
    });
  });
});

describe("toNoteContent", () => {
  it("turns each picked @Name still in the text into a mention", () => {
    const mentions = [
      { id: "c1", name: "Ann Lee" },
      { id: "c2", name: "Ann" },
      { id: "c3", name: "Gone" },
    ];
    expect(toNoteContent("@Ann Lee and @Ann, again @Ann", mentions)).toBe(
      "@[Ann Lee](contact:c1) and @[Ann](contact:c2), again @[Ann](contact:c2)",
    );
  });

  it("leaves text without picked mentions as it is", () => {
    expect(toNoteContent("email @someone", [])).toBe("email @someone");
  });
});

describe("NoteContent", () => {
  it("shows mentions as links to the contact", () => {
    const html: string = renderToStaticMarkup(<NoteContent content="Ask @[Ann Lee](contact:c1) today" />);
    expect(html).toContain('href="/dashboard/contacts/c1"');
    expect(html).toContain(">@Ann Lee</a>");
    expect(html).toContain("Ask ");
    expect(html).toContain(" today");
  });
});
