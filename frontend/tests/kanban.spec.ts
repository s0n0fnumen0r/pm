import { expect, test } from "@playwright/test";
import { resetTestBoard } from "./board-test-setup";
import { initialData } from "../src/lib/kanban";

test.beforeEach(async ({ page, request, baseURL }) => {
  await resetTestBoard(request, baseURL);
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
});

test("loads the kanban board", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("renames a column and updates the header", async ({ page }) => {
  const firstColumn = page.getByTestId("column-col-backlog");
  await firstColumn.getByLabel("Column title").fill("Ideas");
  await firstColumn.getByLabel("Column title").press("Enter");
  await expect(page.getByRole("main").getByText("Ideas", { exact: true })).toBeVisible();
  await expect(page.getByText("All changes saved.")).toBeVisible();
});

test("adds and removes a card", async ({ page }) => {
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
  const cardId = await firstColumn.locator("article").filter({ hasText: "Playwright card" }).getAttribute("data-testid");
  if (!cardId) throw new Error("New card has no test ID");
  const card = page.getByTestId(cardId);
  await card.getByRole("button", { name: "Edit Playwright card" }).click();
  await card.getByLabel("Edit card title").fill("Edited card");
  await card.getByLabel("Edit card details").fill("Edited via e2e.");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(firstColumn.getByText("Edited via e2e.")).toBeVisible();
  await expect(page.getByText("All changes saved.")).toBeVisible();
  await page.reload();
  await expect(firstColumn.getByText("Edited card")).toBeVisible();
  await firstColumn.getByRole("button", { name: "Delete Edited card", exact: true }).click();
  await expect(firstColumn.getByText("Edited card")).not.toBeVisible();
  await expect(page.getByText("All changes saved.")).toBeVisible();
});

test("chat returns an answer without changing the board", async ({ page }) => {
  let chatRequest: { message: string; history: unknown[] } | undefined;
  await page.route("**/api/ai/chat", async (route) => {
    chatRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: "There are eight cards on your board.",
        revision: 0,
        board: initialData,
      }),
    });
  });

  await page.getByLabel("Message the assistant").fill("How many cards are on my board?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("There are eight cards on your board.")).toBeVisible();
  await expect(page.getByTestId("card-card-1")).toBeVisible();
  expect(chatRequest).toEqual({ message: "How many cards are on my board?", history: [] });
});

test("chat displays a multi-card AI update immediately", async ({ page }) => {
  const updated = structuredClone(initialData);
  updated.columns[0].cardIds = updated.columns[0].cardIds.filter((id) => id !== "card-1");
  updated.columns[2].cardIds.push("card-1");
  updated.cards["card-1"].title = "AI updated card";
  updated.columns[4].cardIds.push("ai-created-card");
  updated.cards["ai-created-card"] = {
    id: "ai-created-card",
    title: "AI created card",
    details: "Added by the assistant",
  };
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: "Moved and added cards.",
        revision: 1,
        board: updated,
      }),
    });
  });

  await page.getByLabel("Message the assistant").fill("Move the first task to In Progress and add a card to Done.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Moved and added cards.")).toBeVisible();
  await expect(page.getByTestId("column-col-progress").getByTestId("card-card-1")).toContainText("AI updated card");
  await expect(page.getByTestId("column-col-done").getByTestId("card-ai-created-card")).toContainText("AI created card");
});

test("keeps the board and chat usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sidebar = page.getByRole("complementary", { name: "Chat with your board" });
  await sidebar.scrollIntoViewIfNeeded();

  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
  await expect(sidebar.getByLabel("Message the assistant")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("serves frontend assets and API routes together", async ({ page, request }) => {
  const stylesheet = await page.locator('link[rel="stylesheet"]').first().getAttribute("href");
  const script = await page.locator('script[src*="/_next/static/"]').first().getAttribute("src");
  if (!stylesheet || !script) {
    throw new Error("Missing exported stylesheet or script");
  }
  for (const asset of [stylesheet, script]) {
    const response = await request.get(asset);
    expect(response.ok()).toBe(true);
  }
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect((await request.get("/api/not-found")).status()).toBe(404);
});

test("moves a card between columns", async ({ page }) => {
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
  await expect(page.getByText("All changes saved.")).toBeVisible();
});

for (const { name, cardId, offset } of [
  { name: "left edge", cardId: "card-1", offset: 0.1 },
  { name: "center", cardId: "card-1", offset: 0.5 },
  { name: "right edge", cardId: "card-4", offset: 0.9 },
]) {
  test(`moves a card into an empty column at the ${name}`, async ({ page }) => {
    const targetColumn = page.getByTestId("column-col-discovery");
    await targetColumn.getByRole("button", {
      name: "Delete Prototype analytics view",
      exact: true,
    }).click();

    const card = page.getByTestId(`card-${cardId}`);
    const emptyArea = targetColumn.getByText("Drop a card here");
    const cardBox = await card.boundingBox();
    const targetBox = await emptyArea.boundingBox();
    if (!cardBox || !targetBox) {
      throw new Error("Unable to resolve drag coordinates.");
    }

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width * offset, targetBox.y + targetBox.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    await expect(targetColumn.getByTestId(`card-${cardId}`)).toBeVisible();
    await expect(page.getByText("All changes saved.")).toBeVisible();
  });
}

test("reorders cards within a column", async ({ page }) => {
  const column = page.getByTestId("column-col-backlog");
  await column.getByTestId("card-card-2").scrollIntoViewIfNeeded();
  const source = await column.getByTestId("card-card-2").boundingBox();
  const target = await column.getByTestId("card-card-1").boundingBox();
  if (!source || !target) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(column.locator('[data-testid^="card-"]').first()).toHaveAttribute("data-testid", "card-card-2");
  await expect(page.getByText("All changes saved.")).toBeVisible();
});
