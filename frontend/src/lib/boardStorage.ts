import { initialData, type BoardData } from "@/lib/kanban";

export const BOARD_STORAGE_KEY = "kanban-studio-board";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoardData = (value: unknown): value is BoardData => {
  if (!isRecord(value) || !Array.isArray(value.columns) || !isRecord(value.cards)) {
    return false;
  }

  const cards = value.cards;
  if (!Object.entries(cards).every(([id, card]) =>
    isRecord(card) && card.id === id && typeof card.title === "string" && typeof card.details === "string"
  )) {
    return false;
  }

  const cardIds: string[] = [];
  const validColumns = value.columns.length === initialData.columns.length &&
    value.columns.every((column, index) => {
      if (!isRecord(column) || column.id !== initialData.columns[index].id ||
          typeof column.title !== "string" || !Array.isArray(column.cardIds)) {
        return false;
      }
      for (const id of column.cardIds) {
        if (typeof id !== "string" || !Object.hasOwn(cards, id)) return false;
        cardIds.push(id);
      }
      return true;
    });

  return validColumns && new Set(cardIds).size === cardIds.length &&
    cardIds.length === Object.keys(cards).length;
};

export const loadBoard = (): { board: BoardData; canSave: boolean; error: string } => {
  if (typeof window === "undefined") {
    return { board: initialData, canSave: true, error: "" };
  }

  try {
    const saved = window.sessionStorage.getItem(BOARD_STORAGE_KEY);
    if (saved === null) return { board: initialData, canSave: true, error: "" };
    const board: unknown = JSON.parse(saved);
    if (!isBoardData(board)) throw new Error("Invalid saved board");
    return { board, canSave: true, error: "" };
  } catch {
    return {
      board: initialData,
      canSave: false,
      error: "The saved board could not be loaded. Changes will not be saved in this tab.",
    };
  }
};

export const saveBoard = (board: BoardData) => {
  window.sessionStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(board));
};
