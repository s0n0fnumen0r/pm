import type { APIRequestContext } from "@playwright/test";
import initialBoard from "../../backend/app/initial_board.json";

export async function resetTestBoard(request: APIRequestContext, baseURL: string | undefined) {
  if (process.env.KANBAN_ISOLATED_TEST !== "1" || !process.env.PLAYWRIGHT_BASE_URL || !baseURL) {
    throw new Error("Browser tests reset the board. Set KANBAN_ISOLATED_TEST=1 and PLAYWRIGHT_BASE_URL to an isolated test container.");
  }
  const headers = { Origin: new URL(baseURL).origin };
  const login = await request.post("/api/login", { headers, data: { username: "user", password: "password" } });
  if (!login.ok()) throw new Error(`Test sign-in failed: ${login.status()}`);
  const read = await request.get("/api/board");
  if (!read.ok()) throw new Error(`Test board read failed: ${read.status()}`);
  const { revision } = await read.json();
  const reset = await request.put("/api/board", { headers, data: { revision, board: initialBoard } });
  if (!reset.ok()) throw new Error(`Test board reset failed: ${reset.status()}`);
}
