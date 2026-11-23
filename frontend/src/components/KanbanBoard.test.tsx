import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { BOARD_STORAGE_KEY, isBoardData } from "@/lib/boardStorage";
import {
  MAX_CARDS,
  MAX_CARD_DETAILS_LENGTH,
  MAX_CARD_TITLE_LENGTH,
  MAX_COLUMN_TITLE_LENGTH,
  initialData,
  type BoardData,
} from "@/lib/kanban";

let serverBoard: BoardData;
let revision: number;
let putOverride: ((update: { revision: number; board: BoardData }) => Promise<Response>) | undefined;
let chatOverride: ((request: { message: string; history: { role: string; content: string }[] }) => Promise<Response>) | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const renderBoard = () => render(
  <KanbanBoard onLogout={() => {}} onSessionExpired={() => {}} loggingOut={false} logoutError="" />
);
const firstColumn = async () => screen.findByTestId("column-col-backlog");
const saved = () => screen.findByText("All changes saved.");
// Column titles are committed when the input loses focus.
const rename = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

beforeEach(() => {
  sessionStorage.clear();
  serverBoard = structuredClone(initialData);
  revision = 0;
  putOverride = undefined;
  chatOverride = undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/login") return json({ username: "user" });
    if (url === "/api/ai/chat") {
      if (!chatOverride) throw new Error("Unexpected chat request");
      return chatOverride(JSON.parse(String(init?.body)));
    }
    if (url !== "/api/board") throw new Error(`Unexpected request: ${url}`);
    if (init?.method !== "PUT") return json({ revision, board: serverBoard });
    const update: { revision: number; board: BoardData } = JSON.parse(String(init.body));
    if (putOverride) return putOverride(update);
    if (update.revision !== revision) return json({ detail: "conflict" }, 409);
    serverBoard = update.board;
    revision += 1;
    return json({ revision, board: serverBoard });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads and persists rename, card creation, editing, and deletion", async () => {
  renderBoard();
  const column = await firstColumn();
  expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  rename(within(column).getByLabelText("Column title"), "Ideas");
  await saved();
  expect(serverBoard.columns[0].title).toBe("Ideas");

  await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
  await userEvent.type(within(column).getByPlaceholderText("Card title"), "New card");
  await userEvent.type(within(column).getByPlaceholderText("Details"), "Notes");
  await userEvent.click(within(column).getByRole("button", { name: /^Add card$/ }));
  await saved();
  const card = within(column).getByText("New card").closest("article")!;
  await userEvent.click(within(card).getByRole("button", { name: "Edit New card" }));
  expect(card).not.toHaveAttribute("aria-disabled", "true");
  expect(screen.getByText("Card edits are not saved until you select Save.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  await userEvent.clear(within(card).getByLabelText("Edit card title"));
  await userEvent.type(within(card).getByLabelText("Edit card title"), "   ");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  expect(within(card).getByRole("alert")).toHaveTextContent("A card title is required.");
  await userEvent.clear(within(card).getByLabelText("Edit card title"));
  await userEvent.type(within(card).getByLabelText("Edit card title"), "Edited card");
  await userEvent.clear(within(card).getByLabelText("Edit card details"));
  await userEvent.type(within(card).getByLabelText("Edit card details"), "Edited notes");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  await saved();
  expect(within(column).getByText("Edited notes")).toBeInTheDocument();
  expect(Object.values(serverBoard.cards).some((item) => item.title === "Edited card" && item.details === "Edited notes")).toBe(true);

  await userEvent.click(within(column).getByRole("button", { name: "Delete Edited card" }));
  await saved();
  expect(Object.values(serverBoard.cards).some((item) => item.title === "Edited card")).toBe(false);
});

it("serializes rapid edits and saves the latest board with the confirmed revision", async () => {
  let release: ((response: Response) => void) | undefined;
  let firstUpdate: { revision: number; board: BoardData } | undefined;
  putOverride = async (update) => {
    if (!firstUpdate) {
      firstUpdate = update;
      return new Promise<Response>((resolve) => { release = resolve; });
    }
    expect(update.revision).toBe(1);
    serverBoard = update.board;
    revision = 2;
    return json({ revision, board: serverBoard });
  };
  renderBoard();
  const input = within(await firstColumn()).getByLabelText("Column title");
  rename(input, "First");
  rename(input, "Final");
  expect(screen.getByText("Saving changes...")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  expect(firstUpdate?.board.columns[0].title).toBe("First");
  release!(json({ revision: 1, board: firstUpdate!.board }));
  await saved();
  expect(serverBoard.columns[0].title).toBe("Final");
  expect(revision).toBe(2);
});

it("commits a column rename only on blur or Enter and ignores blank titles", async () => {
  renderBoard();
  const input = within(await firstColumn()).getByLabelText("Column title");
  fireEvent.change(input, { target: { value: "Dra" } });
  fireEvent.change(input, { target: { value: "Draft" } });
  expect(serverBoard.columns[0].title).toBe("Backlog");
  expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/board", expect.objectContaining({ method: "PUT" }));
  await userEvent.type(input, "{Enter}");
  await saved();
  expect(serverBoard.columns[0].title).toBe("Draft");
  expect(revision).toBe(1);

  rename(input, "   ");
  expect(input).toHaveValue("Draft");
  fireEvent.change(input, { target: { value: "Ignored" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("Draft");
  expect(revision).toBe(1);
});

it("limits input lengths", async () => {
  renderBoard();
  const column = await firstColumn();
  expect(within(column).getByLabelText("Column title")).toHaveAttribute("maxLength", String(MAX_COLUMN_TITLE_LENGTH));
  await userEvent.click(within(column).getByRole("button", { name: "Add a card" }));
  expect(within(column).getByPlaceholderText("Card title")).toHaveAttribute("maxLength", String(MAX_CARD_TITLE_LENGTH));
  expect(within(column).getByPlaceholderText("Details")).toHaveAttribute("maxLength", String(MAX_CARD_DETAILS_LENGTH));
});

it("shows a placeholder for empty details without saving it", async () => {
  renderBoard();
  const column = await firstColumn();
  await userEvent.click(within(column).getByRole("button", { name: "Add a card" }));
  await userEvent.type(within(column).getByPlaceholderText("Card title"), "No notes");
  await userEvent.click(within(column).getByRole("button", { name: /^Add card$/ }));
  await saved();
  expect(within(column).getByText("No details yet.")).toBeInTheDocument();
  expect(Object.values(serverBoard.cards).find((card) => card.title === "No notes")?.details).toBe("");
});

it("rejects a blank new card and clears the cancelled form", async () => {
  renderBoard();
  const column = await firstColumn();
  await userEvent.click(within(column).getByRole("button", { name: "Add a card" }));
  await userEvent.type(within(column).getByPlaceholderText("Card title"), "   ");
  await userEvent.click(within(column).getByRole("button", { name: /^Add card$/ }));
  expect(within(column).getAllByTestId(/card-/)).toHaveLength(2);
  await userEvent.click(within(column).getByRole("button", { name: "Cancel" }));
  await userEvent.click(within(column).getByRole("button", { name: "Add a card" }));
  expect(within(column).getByPlaceholderText("Card title")).toHaveValue("");
});

it("keeps failed edits visible and retries without claiming they were saved", async () => {
  putOverride = async () => json({ detail: "unavailable" }, 503);
  renderBoard();
  const input = within(await firstColumn()).getByLabelText("Column title");
  rename(input, "Unsaved");
  expect(await screen.findByRole("alert")).toHaveTextContent("Your changes are not saved");
  expect(input).toHaveValue("Unsaved");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  const leave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(true);
  putOverride = undefined;
  await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await saved();
  expect(serverBoard.columns[0].title).toBe("Unsaved");
  const savedLeave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(savedLeave);
  expect(savedLeave.defaultPrevented).toBe(false);
});

it("does not overwrite a newer board on conflict", async () => {
  putOverride = async () => {
    serverBoard.columns[0].title = "Changed elsewhere";
    revision = 1;
    return json({ detail: "conflict" }, 409);
  };
  renderBoard();
  const input = within(await firstColumn()).getByLabelText("Column title");
  rename(input, "Local edit");
  expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
  expect(input).toHaveValue("Local edit");
  await userEvent.click(screen.getByRole("button", { name: "Load latest board" }));
  await saved();
  expect(input).toHaveValue("Changed elsewhere");
  expect(serverBoard.columns[0].title).toBe("Changed elsewhere");
});

it("retains unsaved edits through session expiration and retries after sign-in", async () => {
  putOverride = async () => json({ detail: "expired" }, 401);
  renderBoard();
  const input = within(await firstColumn()).getByLabelText("Column title");
  rename(input, "Keep this");
  expect(await screen.findByRole("alert")).toHaveTextContent("session expired");
  expect(input).toHaveValue("Keep this");
  putOverride = undefined;
  await userEvent.type(screen.getByLabelText("Username"), "user");
  await userEvent.type(screen.getByLabelText("Password"), "password");
  await userEvent.click(screen.getByRole("button", { name: "Sign in and retry" }));
  await saved();
  expect(serverBoard.columns[0].title).toBe("Keep this");
});

it("asks before importing a tab board and retains the original tab data", async () => {
  const legacy = structuredClone(initialData);
  legacy.columns[0].title = "Previous tab";
  const raw = JSON.stringify(legacy);
  sessionStorage.setItem(BOARD_STORAGE_KEY, raw);
  renderBoard();
  expect(await screen.findByText(/previous board was found/i)).toBeInTheDocument();
  expect(screen.queryByTestId("column-col-backlog")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Import tab board" }));
  await saved();
  expect(serverBoard.columns[0].title).toBe("Previous tab");
  expect(sessionStorage.getItem(BOARD_STORAGE_KEY)).toBe(raw);
});

it("keeps the database board when import is declined and remembers the choice", async () => {
  const legacy = structuredClone(initialData);
  legacy.columns[0].title = "Previous tab";
  const raw = JSON.stringify(legacy);
  sessionStorage.setItem(BOARD_STORAGE_KEY, raw);
  const { unmount } = renderBoard();
  await userEvent.click(await screen.findByRole("button", { name: "Use database board" }));
  expect(within(await firstColumn()).getByLabelText("Column title")).toHaveValue("Backlog");
  expect(serverBoard.columns[0].title).toBe("Backlog");
  expect(sessionStorage.getItem(BOARD_STORAGE_KEY)).toBe(raw);
  unmount();
  renderBoard();
  await firstColumn();
  expect(screen.queryByRole("button", { name: "Import tab board" })).not.toBeInTheDocument();
});

it("does not offer an import over a changed database board", async () => {
  sessionStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(initialData));
  revision = 1;
  serverBoard.columns[0].title = "Database board";
  renderBoard();
  expect(await screen.findByText(/database board has changed/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Import tab board" })).not.toBeInTheDocument();
  expect(within(await firstColumn()).getByLabelText("Column title")).toHaveValue("Database board");
});

it("retains tab data when another update wins an import race", async () => {
  const legacy = structuredClone(initialData);
  legacy.columns[0].title = "Previous tab";
  const raw = JSON.stringify(legacy);
  sessionStorage.setItem(BOARD_STORAGE_KEY, raw);
  putOverride = async () => {
    serverBoard.columns[0].title = "Changed elsewhere";
    revision = 1;
    return json({ detail: "conflict" }, 409);
  };
  renderBoard();
  await userEvent.click(await screen.findByRole("button", { name: "Import tab board" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
  expect(sessionStorage.getItem(BOARD_STORAGE_KEY)).toBe(raw);
  expect(within(await firstColumn()).getByLabelText("Column title")).toHaveValue("Previous tab");
  await userEvent.click(screen.getByRole("button", { name: "Load latest board" }));
  expect(within(await firstColumn()).getByLabelText("Column title")).toHaveValue("Changed elsewhere");
  expect(sessionStorage.getItem(BOARD_STORAGE_KEY)).toBe(raw);
});

it("reports invalid prior tab data without overwriting it", async () => {
  sessionStorage.setItem(BOARD_STORAGE_KEY, '{"columns":[]}');
  renderBoard();
  expect(await screen.findByRole("alert")).toHaveTextContent("previous tab board is invalid");
  expect(await firstColumn()).toBeInTheDocument();
  expect(sessionStorage.getItem(BOARD_STORAGE_KEY)).toBe('{"columns":[]}');
});

it.each([
  ["a blank column title", (board: BoardData) => { board.columns[0].title = " "; }],
  ["an over-long card title", (board: BoardData) => { board.cards["card-1"].title = "x".repeat(MAX_CARD_TITLE_LENGTH + 1); }],
  ["over-long card details", (board: BoardData) => { board.cards["card-1"].details = "x".repeat(MAX_CARD_DETAILS_LENGTH + 1); }],
  ["an over-long column title", (board: BoardData) => { board.columns[0].title = "x".repeat(MAX_COLUMN_TITLE_LENGTH + 1); }],
])("does not offer to import a tab board the server would reject: %s", async (_name, corrupt) => {
  const legacy = structuredClone(initialData);
  corrupt(legacy);
  sessionStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(legacy));
  renderBoard();
  expect(await screen.findByRole("alert")).toHaveTextContent("previous tab board is invalid");
  expect(screen.queryByRole("button", { name: "Import tab board" })).not.toBeInTheDocument();
});

it("counts text limits in characters, as the server does", () => {
  const board = structuredClone(initialData);
  board.cards["card-1"].title = "\u{1F680}".repeat(MAX_CARD_TITLE_LENGTH);
  expect(isBoardData(board)).toBe(true);
  board.cards["card-1"].title += "\u{1F680}";
  expect(isBoardData(board)).toBe(false);
});

it("reports a server rejection and lets the user discard the rejected changes", async () => {
  putOverride = async () => json({ detail: [{ msg: "Value error, Column titles must not be blank" }] }, 422);
  renderBoard();
  const input = within(await firstColumn()).getByLabelText("Column title");
  rename(input, "Rejected");
  expect(await screen.findByText("The server rejected these changes: Column titles must not be blank")).toBeInTheDocument();
  expect(screen.getByText(/Correct them and retry, or load the latest board/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry save" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Load latest board" }));
  await saved();
  expect(input).toHaveValue("Backlog");
  expect(screen.queryByText(/server rejected/)).not.toBeInTheDocument();
});

it("never adds a card beyond the limit, even from forms opened earlier", async () => {
  for (let index = Object.keys(serverBoard.cards).length; index < MAX_CARDS - 1; index += 1) {
    const id = `extra-${index}`;
    serverBoard.cards[id] = { id, title: "Extra", details: "" };
    serverBoard.columns[0].cardIds.push(id);
  }
  renderBoard();
  const columns = [await firstColumn(), screen.getByTestId("column-col-done")];
  for (const column of columns) {
    fireEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    fireEvent.change(within(column).getByPlaceholderText("Card title"), { target: { value: "Late card" } });
  }
  for (const column of columns) {
    fireEvent.click(within(column).getByRole("button", { name: /^Add card$/ }));
  }
  await saved();
  expect(Object.keys(serverBoard.cards)).toHaveLength(MAX_CARDS);
}, 30_000);

it("retries a failed initial board load", async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementationOnce(async () => json({}, 503));
  renderBoard();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the board");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByTestId("column-col-backlog")).toBeInTheDocument());
});

it("applies an AI board update to the visible board", async () => {
  const updated = structuredClone(initialData);
  updated.columns[0].cardIds = updated.columns[0].cardIds.filter((id) => id !== "card-1");
  updated.columns[2].cardIds.push("card-1");
  updated.cards["card-1"].title = "AI updated card";
  updated.cards["card-1"].details = "AI updated details";
  updated.columns[4].cardIds.push("ai-created-card");
  updated.cards["ai-created-card"] = {
    id: "ai-created-card",
    title: "AI created card",
    details: "Added by the assistant",
  };
  chatOverride = async () => {
    serverBoard = updated;
    revision = 1;
    return json({ response: "Moved and added cards.", board: serverBoard, revision });
  };
  renderBoard();

  await firstColumn();
  await userEvent.type(screen.getByLabelText("Message the assistant"), "Move and add cards");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Moved and added cards.")).toBeInTheDocument();
  expect(within(screen.getByTestId("column-col-progress")).getByTestId("card-card-1")).toHaveTextContent("AI updated card");
  expect(within(screen.getByTestId("column-col-done")).getByTestId("card-ai-created-card")).toHaveTextContent("AI created card");
  expect(await saved()).toBeInTheDocument();
  expect(serverBoard).toEqual(updated);
});
