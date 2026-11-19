import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
  await expect(page.getByRole("main").getByText("Ideas", { exact: true })).toBeVisible();
});

test("adds and removes a card", async ({ page }) => {
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
  await firstColumn.getByRole("button", { name: "Delete Playwright card", exact: true }).click();
  await expect(firstColumn.getByText("Playwright card")).not.toBeVisible();
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
  const response = await request.get("/api/hello");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ message: "Hello from the API!" });
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
});
