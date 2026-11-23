import {
  MAX_CARDS,
  MAX_CARD_DETAILS_LENGTH,
  MAX_CARD_TITLE_LENGTH,
  MAX_COLUMN_TITLE_LENGTH,
  MAX_ID_LENGTH,
  initialData,
  type BoardData,
} from "@/lib/kanban";

export const BOARD_STORAGE_KEY = "kanban-studio-board";
const MIGRATION_KEY = "kanban-studio-board-migration";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Count code points, as the backend does, rather than UTF-16 units.
const isText = (value: unknown, maxLength: number, required = false): value is string =>
  typeof value === "string" && [...value].length <= maxLength && (!required || value.trim().length > 0);

// Mirrors the backend Board validation in backend/app/board.py.
export const isBoardData = (value: unknown): value is BoardData => {
  if (!isRecord(value) || !Array.isArray(value.columns) || !isRecord(value.cards)) {
    return false;
  }
  const cards = value.cards;
  const columnIds = initialData.columns.map((column) => column.id);
  if (Object.keys(cards).length > MAX_CARDS || !Object.entries(cards).every(([id, card]) =>
    id.length > 0 && !columnIds.includes(id) && isRecord(card) &&
    card.id === id && isText(id, MAX_ID_LENGTH) && isText(card.title, MAX_CARD_TITLE_LENGTH, true) &&
    isText(card.details, MAX_CARD_DETAILS_LENGTH)
  )) {
    return false;
  }
  const cardIds: string[] = [];
  const validColumns = value.columns.length === columnIds.length &&
    value.columns.every((column, index) => {
      if (!isRecord(column) || column.id !== columnIds[index] ||
          !isText(column.title, MAX_COLUMN_TITLE_LENGTH, true) || !Array.isArray(column.cardIds)) {
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

export const readLegacyBoard = (): { board: BoardData | null; warning: string } => {
  try {
    if (sessionStorage.getItem(MIGRATION_KEY) === "handled") return { board: null, warning: "" };
    const saved = sessionStorage.getItem(BOARD_STORAGE_KEY);
    if (saved === null) return { board: null, warning: "" };
    const board: unknown = JSON.parse(saved);
    if (!isBoardData(board)) {
      return { board: null, warning: "The previous tab board is invalid and was not imported. Its data has been retained." };
    }
    return { board, warning: "" };
  } catch {
    return { board: null, warning: "The previous tab board could not be read. Its data has not been changed." };
  }
};

export const markLegacyHandled = () => {
  sessionStorage.setItem(MIGRATION_KEY, "handled");
};
