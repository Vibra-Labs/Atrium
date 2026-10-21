import { describe, expect, it } from "bun:test";
import { mentionToken, mentionedContactIds, mentionsAsText, splitMentions } from "@atrium/shared";

describe("note mentions", () => {
  it("writes a token that keeps the name readable and survives brackets in it", () => {
    expect(mentionToken("Ann Lee", "c1")).toBe("@[Ann Lee](contact:c1)");
    expect(mentionToken("Ann [CEO] Lee", "c1")).toBe("@[Ann (CEO) Lee](contact:c1)");
  });

  it("splits a note into text and mentions", () => {
    const content = `Call ${mentionToken("Ann Lee", "c1")} and ${mentionToken("Bo", "c2")}.`;
    expect(splitMentions(content)).toEqual([
      { text: "Call " },
      { mention: { name: "Ann Lee", contactId: "c1" } },
      { text: " and " },
      { mention: { name: "Bo", contactId: "c2" } },
      { text: "." },
    ]);
    expect(splitMentions("no mentions")).toEqual([{ text: "no mentions" }]);
  });

  it("lists each mentioned contact once", () => {
    const content = `${mentionToken("Ann", "c1")} ${mentionToken("Ann", "c1")} ${mentionToken("Bo", "c2")}`;
    expect(mentionedContactIds(content)).toEqual(["c1", "c2"]);
  });

  it("reads as plain @names wherever links can't be shown", () => {
    expect(mentionsAsText(`Ask ${mentionToken("Ann Lee", "c1")}`)).toBe("Ask @Ann Lee");
  });

  it("ignores text that only looks like a mention", () => {
    expect(mentionedContactIds("email me @ann or @[Ann](user:1)")).toEqual([]);
  });
});
