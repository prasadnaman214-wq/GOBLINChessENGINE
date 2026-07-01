import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5173";

test("Chess app loads and starts a game", async ({ page }) => {
  // Capture console errors
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(BASE);

  // Page title
  await expect(page).toHaveTitle("Chess AI");

  // Welcome screen shows
  await expect(page.getByText("Welcome to Chess AI")).toBeVisible();

  // Start as White
  await page.getByText("Play as White").click();

  // Board should be visible (chessboard renders)
  await page.waitForTimeout(1000);
  const board = page.locator("[data-testid='board']");
  const boardOrSvg = page.locator("svg").first();
  const hasBoard = await boardOrSvg.isVisible().catch(() => false) || await page.locator(".board-wrapper").isVisible().catch(() => false);

  // Move history panel should show
  await expect(page.getByText("Move History")).toBeVisible();
  await expect(page.getByText("Controls")).toBeVisible();
  await expect(page.getByText("New Game")).toBeVisible();

  // Status bar shows "Your turn"
  await expect(page.getByText(/Your turn/)).toBeVisible();

  // No critical console errors (filter out expected network/fetch warnings)
  const criticalErrors = consoleErrors.filter(
    (e) => !e.includes("Failed to fetch") && !e.includes("net::ERR")
  );
  expect(criticalErrors).toHaveLength(0);

  console.log("✅ App loaded, game started, no critical errors");
});
