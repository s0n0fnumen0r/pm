import { expect, test } from "@playwright/test";
import initialBoard from "../../backend/app/initial_board.json";

test("imports a previous tab board into an untouched database", async ({ page, request, baseURL }) => {
  test.skip(process.env.KANBAN_FRESH_TEST !== "1", "Requires a fresh isolated database.");
  if (process.env.KANBAN_ISOLATED_TEST !== "1" || !process.env.PLAYWRIGHT_BASE_URL || !baseURL) {
    throw new Error("Migration test requires an isolated test container.");
  }
  const headers = { Origin: new URL(baseURL).origin };
  const login = await request.post("/api/login", { headers, data: { username: "user", password: "password" } });
  expect(login.ok()).toBe(true);
  const initial = await request.get("/api/board");
  expect((await initial.json()).revision).toBe(0);

  const legacy = structuredClone(initialBoard);
  legacy.columns[0].title = "Imported tab board";
  await page.addInitScript((data) => {
    sessionStorage.setItem("kanban-studio-board", JSON.stringify(data));
  }, legacy);
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/previous board was found/i)).toBeVisible();
  await page.getByRole("button", { name: "Import tab board" }).click();
  await expect(page.getByText("All changes saved.")).toBeVisible();
  expect((await (await request.get("/api/board")).json()).board.columns[0].title).toBe("Imported tab board");
  await page.reload();
  await expect(page.getByTestId("column-col-backlog").getByLabel("Column title")).toHaveValue("Imported tab board");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("kanban-studio-board")!).columns[0].title)).toBe("Imported tab board");
});
