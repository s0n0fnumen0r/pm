import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { initialData, type BoardData } from "@/lib/kanban";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const chatResponse = (response: string, board: BoardData = initialData, revision = 0) =>
  json({ response, board, revision });

const onBoardUpdate = vi.fn();
const onConflict = vi.fn(async () => true);
const onPendingChange = vi.fn();
const onSessionExpired = vi.fn();

const renderChat = (disabled = false) => render(
  <AIChatSidebar
    disabled={disabled}
    onBoardUpdate={onBoardUpdate}
    onConflict={onConflict}
    onPendingChange={onPendingChange}
    onSessionExpired={onSessionExpired}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("sends prior conversation messages with the next request", async () => {
  const requests: { message: string; history: unknown[] }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return chatResponse(requests.length === 1 ? "First reply." : "Second reply.");
  }));
  const user = userEvent.setup();
  renderChat();

  await user.type(screen.getByLabelText("Message the assistant"), "First question");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("First reply.")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Message the assistant"), "Follow-up question");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Second reply.")).toBeInTheDocument();
  expect(requests[0]).toEqual({ message: "First question", history: [] });
  expect(requests[1]).toEqual({
    message: "Follow-up question",
    history: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First reply." },
    ],
  });
});

it("shows pending state and disables duplicate sends", async () => {
  let resolveResponse: ((response: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  })));
  const user = userEvent.setup();
  renderChat();

  await user.type(screen.getByLabelText("Message the assistant"), "Wait for it");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(screen.getByRole("status")).toHaveTextContent("Assistant is thinking");
  expect(screen.getByRole("button", { name: "Thinking..." })).toBeDisabled();
  expect(onPendingChange).toHaveBeenLastCalledWith(true);
  await act(async () => {
    resolveResponse?.(chatResponse("Done."));
  });
  expect(await screen.findByText("Done.")).toBeInTheDocument();
  await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
});

it("shows provider errors and keeps the failed request available to retry", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    json({ detail: "OpenRouter is temporarily unavailable." }, 502)
  ));
  const user = userEvent.setup();
  renderChat();

  await user.type(screen.getByLabelText("Message the assistant"), "Try this request");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("OpenRouter is temporarily unavailable.");
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("Try this request");
});

it("syncs a returned board and revision after an AI update", async () => {
  const updated = structuredClone(initialData);
  updated.columns[0].cardIds = updated.columns[0].cardIds.filter((id) => id !== "card-1");
  updated.columns[2].cardIds.push("card-1");
  updated.cards["card-1"].title = "Moved by AI";
  vi.stubGlobal("fetch", vi.fn(async () => chatResponse("Moved the card.", updated, 3)));
  const user = userEvent.setup();
  renderChat();

  await user.type(screen.getByLabelText("Message the assistant"), "Move the card.");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Moved the card.")).toBeInTheDocument();
  expect(onBoardUpdate).toHaveBeenCalledWith(updated, 3);
});

it("refreshes after a conflict and explains that the AI update was not applied", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    json({ detail: "Board has changed" }, 409)
  ));
  const user = userEvent.setup();
  renderChat();

  await user.type(screen.getByLabelText("Message the assistant"), "Make an update");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(onConflict).toHaveBeenCalledOnce();
  expect(await screen.findByRole("alert")).toHaveTextContent("Its update was not applied");
});

it("reports when the latest board cannot be loaded after a conflict", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    json({ detail: "Board has changed" }, 409)
  ));
  onConflict.mockResolvedValue(false);
  const user = userEvent.setup();
  renderChat();

  await user.type(screen.getByLabelText("Message the assistant"), "Make an update");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("latest board could not be loaded");
});
