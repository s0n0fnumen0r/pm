import { expect, test } from "@playwright/test";
import { resetTestBoard } from "./board-test-setup";

test.beforeEach(async ({ request, baseURL }) => {
  await resetTestBoard(request, baseURL);
});

test("requires valid credentials, keeps a session on refresh, and signs out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByTestId("column-col-backlog")).toHaveCount(0);

  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid username or password.");
  await expect(page.getByTestId("column-col-backlog")).toHaveCount(0);

  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await page.reload();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByTestId("column-col-backlog")).toHaveCount(0);
});

test("shows failures and permits retrying the session check and login", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({ status: 503 }));
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Unable to check your session. Please try again.");
  await page.unroute("**/api/session");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();

  await page.route("**/api/login", (route) => route.fulfill({ status: 503 }));
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Unable to sign in. Please try again.");
  await page.unroute("**/api/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
});

test("keeps the board visible on sign-out failure and signs out an expired session", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();

  await page.route("**/api/logout", (route) => route.fulfill({ status: 503 }));
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Unable to sign out. Please try again.");
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();

  await page.unroute("**/api/logout");
  await context.clearCookies();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("column-col-backlog")).toHaveCount(0);
});

test("reports an expired session when checking on page load", async ({ page }) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: 401, json: { detail: "Session expired" } })
  );
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Your session has expired. Please sign in again."
  );
  await expect(page.getByTestId("column-col-backlog")).toHaveCount(0);
});

test("keeps board changes through refresh, sign-out, and a new tab", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  const backlog = page.getByTestId("column-col-backlog");
  const review = page.getByTestId("column-col-review");
  await backlog.getByLabel("Column title").fill("Ideas");
  await backlog.getByLabel("Column title").press("Enter");
  await backlog.getByRole("button", { name: "Add a card" }).click();
  await backlog.getByPlaceholder("Card title").fill("Remember this");
  await backlog.getByPlaceholder("Details").fill("Tab-specific notes");
  await backlog.getByRole("button", { name: "Add card", exact: true }).click();
  await backlog.getByRole("button", { name: "Delete Gather customer signals", exact: true }).click();

  const card = await backlog.getByTestId("card-card-1").boundingBox();
  const target = await review.boundingBox();
  if (!card || !target) throw new Error("Unable to resolve drag coordinates.");
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(review.getByTestId("card-card-1")).toBeVisible();
  await expect(page.getByText("All changes saved.")).toBeVisible();

  const checkBoard = async () => {
    await expect(backlog.getByLabel("Column title")).toHaveValue("Ideas");
    await expect(backlog.getByText("Remember this")).toBeVisible();
    await expect(backlog.getByText("Tab-specific notes")).toBeVisible();
    await expect(backlog.getByText("Gather customer signals")).toHaveCount(0);
    await expect(review.getByTestId("card-card-1")).toBeVisible();
  };
  await page.reload();
  await checkBoard();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.reload();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await checkBoard();

  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(otherTab.getByTestId("column-col-backlog").getByLabel("Column title")).toHaveValue("Ideas");
  await expect(otherTab.getByText("Remember this")).toBeVisible();
  await otherTab.close();
});
