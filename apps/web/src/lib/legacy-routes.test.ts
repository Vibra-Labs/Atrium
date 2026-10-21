import { describe, expect, it } from "bun:test";
import { TEAM_PATH, clientsRedirectTarget, previewReturnPath } from "./legacy-routes";

describe("clientsRedirectTarget", () => {
  it("sends the Team tab to Settings → Team", () => {
    expect(clientsRedirectTarget("team")).toBe(TEAM_PATH);
    expect(TEAM_PATH).toBe("/dashboard/settings/team");
  });

  it("sends the Clients tab, no tab or anything else to contacts with portal access", () => {
    expect(clientsRedirectTarget("clients")).toBe("/dashboard/contacts?access=portal");
    expect(clientsRedirectTarget(undefined)).toBe("/dashboard/contacts?access=portal");
    expect(clientsRedirectTarget(["team", "x"])).toBe("/dashboard/contacts?access=portal");
  });
});

describe("previewReturnPath", () => {
  it("keeps a dashboard path", () => {
    expect(previewReturnPath("/dashboard/contacts/c-1")).toBe("/dashboard/contacts/c-1");
  });

  it("drops anything that could leave the dashboard", () => {
    expect(previewReturnPath(undefined)).toBeUndefined();
    expect(previewReturnPath("https://evil.example/dashboard/")).toBeUndefined();
    expect(previewReturnPath("//evil.example")).toBeUndefined();
    expect(previewReturnPath("/dashboard//evil.example")).toBeUndefined();
    expect(previewReturnPath("/dashboard/\\evil")).toBeUndefined();
    expect(previewReturnPath("/portal")).toBeUndefined();
  });
});
