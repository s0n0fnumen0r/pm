"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isBoardData, markLegacyHandled, readLegacyBoard } from "@/lib/boardStorage";
import type { BoardData } from "@/lib/kanban";

type BoardResponse = { revision: number; board: BoardData };
type Status = "loading" | "load-error" | "saved" | "saving" | "error" | "invalid" | "conflict" | "expired" | "reloading";

class BoardRequestError extends Error {
  constructor(public status: number, public detail = "") {
    super(`Board request failed: ${status}`);
  }
}

// FastAPI reports validation failures as a list; show the first message without Pydantic's prefix.
const errorDetail = async (response: Response) => {
  try {
    const { detail } = await response.json();
    if (typeof detail === "string") return detail;
    const message = Array.isArray(detail) ? detail[0]?.msg : undefined;
    return typeof message === "string" ? message.replace(/^Value error, /, "") : "";
  } catch {
    return "";
  }
};

const requestBoard = async (options?: RequestInit): Promise<BoardResponse> => {
  const response = await fetch("/api/board", { cache: "no-store", ...options });
  if (!response.ok) throw new BoardRequestError(response.status, await errorDetail(response));
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("revision" in body) ||
      typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
      !("board" in body) || !isBoardData(body.board)) {
    throw new Error("Invalid board response");
  }
  return { revision: body.revision, board: body.board };
};

export const useBoard = (onSessionExpired: () => void) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [warning, setWarning] = useState("");
  const [legacy, setLegacy] = useState<BoardData | null>(null);
  const [legacyBlocked, setLegacyBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const boardRef = useRef<BoardData | null>(null);
  const revision = useRef(0);
  const sequence = useRef(0);
  const savedSequence = useRef(0);
  const inFlight = useRef(false);
  const blocked = useRef(false);
  const importing = useRef(false);
  const mounted = useRef(false);
  const expiredCallback = useRef(onSessionExpired);

  useEffect(() => {
    expiredCallback.current = onSessionExpired;
  });

  const rememberLegacyChoice = () => {
    try {
      markLegacyHandled();
    } catch {
      setWarning("Unable to remember the tab-board choice. The old tab data has not been changed.");
    }
  };

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await requestBoard({ signal: controller.signal });
        if (controller.signal.aborted) return;
        boardRef.current = result.board;
        revision.current = result.revision;
        setBoard(result.board);
        const previous = readLegacyBoard();
        setWarning(previous.warning);
        setLegacy(previous.board);
        setLegacyBlocked(previous.board !== null && result.revision !== 0);
        setStatus("saved");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof BoardRequestError && error.status === 401) {
          expiredCallback.current();
        } else {
          setStatus("load-error");
        }
      }
    };
    void load();
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [attempt]);

  useEffect(() => {
    if (status === "loading" || status === "load-error" || status === "saved") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  const flush = useCallback(async () => {
    if (inFlight.current || blocked.current) return;
    inFlight.current = true;
    try {
      while (savedSequence.current < sequence.current && boardRef.current) {
        const snapshot = boardRef.current;
        const sentSequence = sequence.current;
        const result = await requestBoard({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: revision.current, board: snapshot }),
        });
        revision.current = result.revision;
        savedSequence.current = sentSequence;
        if (!mounted.current) return;
        if (importing.current) {
          importing.current = false;
          rememberLegacyChoice();
        }
      }
      if (mounted.current) setStatus("saved");
    } catch (error) {
      blocked.current = true;
      if (mounted.current) {
        if (error instanceof BoardRequestError && error.status === 409) setStatus("conflict");
        else if (error instanceof BoardRequestError && error.status === 401) setStatus("expired");
        else if (error instanceof BoardRequestError && error.status === 422) {
          setStatus("invalid");
          setWarning(error.detail && `The server rejected these changes: ${error.detail}`);
        } else setStatus("error");
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  const updateBoard = (update: (current: BoardData) => BoardData) => {
    if (!boardRef.current || status === "reloading") return;
    const next = update(boardRef.current);
    if (next === boardRef.current) return;
    boardRef.current = next;
    sequence.current += 1;
    setBoard(next);
    if (!blocked.current) {
      setStatus("saving");
      void flush();
    }
  };

  const retrySave = () => {
    blocked.current = false;
    setWarning("");
    setStatus("saving");
    void flush();
  };

  const loadLatest = async (): Promise<boolean> => {
    setStatus("reloading");
    try {
      const result = await requestBoard();
      if (!mounted.current) return false;
      acceptServerBoard(result.board, result.revision);
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      if (error instanceof BoardRequestError && error.status === 401) setStatus("expired");
      else setStatus("conflict");
      setWarning("Unable to load the latest board. Your unsaved changes are still shown.");
      return false;
    }
  };

  const acceptServerBoard = (serverBoard: BoardData, serverRevision: number) => {
    if (!mounted.current) return;
    boardRef.current = serverBoard;
    revision.current = serverRevision;
    savedSequence.current = sequence.current;
    blocked.current = false;
    importing.current = false;
    setBoard(serverBoard);
    setWarning("");
    setStatus("saved");
  };

  const importLegacy = () => {
    if (!legacy || legacyBlocked) return;
    importing.current = true;
    setLegacy(null);
    updateBoard(() => legacy);
  };

  const keepDatabaseBoard = () => {
    rememberLegacyChoice();
    setLegacy(null);
    setLegacyBlocked(false);
  };

  return {
    board, status, warning, legacy, legacyBlocked, updateBoard, retrySave, loadLatest, acceptServerBoard,
    importLegacy, keepDatabaseBoard, retryLoad: () => {
      setStatus("loading");
      setAttempt((value) => value + 1);
    },
  };
};
