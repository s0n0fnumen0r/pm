import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import * as boardStorage from "@/lib/boardStorage";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];
const renderBoard = () => render(<KanbanBoard onLogout={() => {}} loggingOut={false} logoutError="" />);

describe("KanbanBoard", () => {
  beforeEach(() => sessionStorage.clear());

  it("renders five columns", () => {
    renderBoard();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("renames a column", async () => {
    renderBoard();
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
  });

  it("adds and removes a card", async () => {
    renderBoard();
    const column = getFirstColumn();
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("rejects a whitespace-only title and resets the form on cancel", async () => {
    renderBoard();
    const column = getFirstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "   ");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    expect(within(column).getByPlaceholderText(/card title/i)).toBeInTheDocument();
    expect(within(column).getAllByTestId(/card-/)).toHaveLength(2);
    await userEvent.click(within(column).getByRole("button", { name: /cancel/i }));
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    expect(within(column).getByPlaceholderText(/card title/i)).toHaveValue("");
  });

  it("reports invalid stored data without overwriting it", async () => {
    sessionStorage.setItem(boardStorage.BOARD_STORAGE_KEY, '{"columns":[]}');
    renderBoard();
    expect(screen.getByRole("alert")).toHaveTextContent("The saved board could not be loaded.");
    await userEvent.type(within(getFirstColumn()).getByLabelText("Column title"), " changed");
    expect(sessionStorage.getItem(boardStorage.BOARD_STORAGE_KEY)).toBe('{"columns":[]}');
  });

  it("reports when tab storage cannot be written", async () => {
    const write = vi.spyOn(boardStorage, "saveBoard").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    try {
      renderBoard();
      await userEvent.type(within(getFirstColumn()).getByLabelText("Column title"), " changed");
      expect(screen.getByRole("alert")).toHaveTextContent("Unable to save the board in this tab.");
    } finally {
      write.mockRestore();
    }
  });
});
