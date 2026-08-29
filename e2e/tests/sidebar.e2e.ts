import { test, expect } from "@playwright/test";

test.describe("Desktop Sidebar", () => {
  test.use({ viewport: { width: 1280, height: 500 } });

  test("sign out button stays within the viewport on tall pages", async ({ page }) => {
    await page.goto("/dashboard");

    // Make the main content much taller than the viewport
    await page.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      document.querySelector("main")?.appendChild(filler);
    });

    const signOut = page
      .locator("aside")
      .getByRole("button", { name: /sign out/i });
    await expect(signOut).toBeVisible();

    const box = await signOut.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });
});
