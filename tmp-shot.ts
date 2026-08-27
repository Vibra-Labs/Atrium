import { chromium } from "@playwright/test";
const WEB = "http://localhost:3000";
const SHOTS = "/private/tmp/claude-501/-Users-edgar-Documents-Development-Projects-Atrium/f543172e-f1a0-4694-a288-bc360c8ee65b/scratchpad";

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } } as never);
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 150)));
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill("demo-1787858152089@test.local");
  await page.getByLabel(/password/i).fill("TestPass123!");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(dashboard|setup)/, { timeout: 25000 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/header-full.png` });

  await page.getByRole("button", { name: /switch organization/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/header-open.png`, clip: { x: 0, y: 0, width: 460, height: 230 } });

  // mobile: MobileNav should still carry its own icons, with no duplicate bar
  await page.setViewportSize({ width: 390, height: 780 });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/header-mobile.png`, clip: { x: 0, y: 0, width: 390, height: 200 } });
  console.log("captured");
  await browser.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
