import { describe, expect, it } from "bun:test";
import { autoMatch, socialSite, splitFullName, telHref } from "./contact-fields";

describe("autoMatch", () => {
  it("matches CRM export headers", () => {
    expect(autoMatch("First Name")).toBe("firstName");
    expect(autoMatch("last_name")).toBe("lastName");
    expect(autoMatch("Title")).toBe("jobTitle");
    expect(autoMatch("Job Title")).toBe("jobTitle");
    expect(autoMatch("Department")).toBe("department");
    expect(autoMatch("Rating")).toBe("rating");
    expect(autoMatch("LinkedIn")).toBe("socialLinks");
    expect(autoMatch("Twitter")).toBe("socialLinks");
    expect(autoMatch("Social")).toBe("socialLinks");
  });

  it("matches every kind of phone column to Phone", () => {
    for (const h of ["Phone", "Mobile", "Mobile Phone", "Work Phone", "Home Phone", "Phone Number", "Telephone", "Cell"]) {
      expect(autoMatch(h)).toBe("phone");
    }
  });

  it("matches About, Referred by, follow-up and company size headers", () => {
    expect(autoMatch("Description")).toBe("description");
    expect(autoMatch("About")).toBe("description");
    expect(autoMatch("Referred By")).toBe("referredBy");
    expect(autoMatch("Referrer")).toBe("referredBy");
    expect(autoMatch("Next Follow-up")).toBe("followUpAt");
    expect(autoMatch("Follow up date")).toBe("followUpAt");
    expect(autoMatch("Annual Revenue")).toBe("companyRevenue");
    expect(autoMatch("No. of Employees")).toBe("companyEmployees");
    expect(autoMatch("Employees")).toBe("companyEmployees");
  });

  it("keeps the existing matches and skips unknown headers", () => {
    expect(autoMatch("Name")).toBe("name");
    expect(autoMatch("E-mail")).toBe("email");
    expect(autoMatch("Company Name")).toBe("company");
    expect(autoMatch("Favourite colour")).toBe("skip");
  });
});

describe("socialSite", () => {
  it("picks the site by domain, including subdomains", () => {
    expect(socialSite("https://www.linkedin.com/in/ann").site).toBe("linkedin");
    expect(socialSite("https://uk.linkedin.com/in/ann").site).toBe("linkedin");
    expect(socialSite("https://instagram.com/ann").site).toBe("instagram");
    expect(socialSite("https://twitter.com/ann").site).toBe("x");
    expect(socialSite("https://x.com/ann").site).toBe("x");
    expect(socialSite("https://facebook.com/ann").site).toBe("facebook");
    expect(socialSite("https://www.tiktok.com/@ann")).toEqual({ site: "tiktok", host: "tiktok.com" });
    expect(socialSite("https://youtube.com/@ann").site).toBe("youtube");
  });

  it("anything else is 'other' with its host", () => {
    expect(socialSite("https://ann.dev/about")).toEqual({ site: "other", host: "ann.dev" });
    expect(socialSite("https://notlinkedin.com/x").site).toBe("other");
  });
});

describe("splitFullName", () => {
  it("splits on the first space", () => {
    expect(splitFullName(" Ann Marie Lee ")).toEqual({ firstName: "Ann", lastName: "Marie Lee" });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });
});

describe("telHref", () => {
  it("keeps digits and +", () => {
    expect(telHref("+1 (555) 010-2000")).toBe("tel:+15550102000");
  });
});
