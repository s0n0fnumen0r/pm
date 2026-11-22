import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { resetTestBoard } from "./board-test-setup";

test.beforeEach(async ({ request, baseURL }) => {
  await resetTestBoard(request, baseURL);
});

test("reports a conflict between two tabs without overwriting newer changes", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  const secondTitle = second.getByTestId("column-col-backlog").getByLabel("Column title");
  await expect(secondTitle).toHaveValue("Backlog");
  await page.getByTestId("column-col-backlog").getByLabel("Column title").fill("First tab");
  await page.getByTestId("column-col-backlog").getByLabel("Column title").press("Enter");
  await expect(page.getByText("All changes saved.")).toBeVisible();
  await secondTitle.fill("Second tab");
  await secondTitle.press("Enter");
  await expect(second.getByRole("main").getByRole("alert")).toContainText("changed elsewhere");
  await expect(secondTitle).toHaveValue("Second tab");
  await second.getByRole("button", { name: "Load latest board" }).click();
  await expect(secondTitle).toHaveValue("First tab");
  await second.close();
});

test("keeps a board after the isolated container restarts", async ({ page, request }) => {
  const container = process.env.KANBAN_TEST_CONTAINER_ID;
  test.skip(!container, "An isolated test container is required for the restart check.");
  const name = execFileSync("docker", ["inspect", "--format", "{{.Name}}", container!], { encoding: "utf8" }).trim();
  if (!name.startsWith("/kanban-part7-test-")) throw new Error("Refusing to restart a non-test container");
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  const title = page.getByTestId("column-col-backlog").getByLabel("Column title");
  await title.fill("After restart");
  await title.press("Enter");
  await expect(page.getByText("All changes saved.")).toBeVisible();
  execFileSync("docker", ["restart", container!], { timeout: 30000 });
  await expect.poll(async () => {
    try { return (await request.get("/api/health", { timeout: 2000 })).status(); }
    catch { return 0; }
  }, { timeout: 20000 }).toBe(200);
  await page.reload();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(title).toHaveValue("After restart");
});
