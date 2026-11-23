"use client";

import { useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { PowerIcon } from "@/components/icons";
import { MAX_CARDS, createId, moveCard } from "@/lib/kanban";
import { useBoard } from "@/lib/useBoard";

const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

type KanbanBoardProps = {
  onLogout: () => void;
  onSessionExpired: () => void;
  loggingOut: boolean;
  logoutError: string;
};

export const KanbanBoard = ({ onLogout, onSessionExpired, loggingOut, logoutError }: KanbanBoardProps) => {
  const { board, status, warning, legacy, legacyBlocked, updateBoard, retrySave,
    loadLatest, importLegacy, keepDatabaseBoard, retryLoad, acceptServerBoard } = useBoard(onSessionExpired);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reauthenticating, setReauthenticating] = useState(false);
  const [reauthError, setReauthError] = useState("");
  const [editingCards, setEditingCards] = useState<Set<string>>(new Set());
  const [chatPending, setChatPending] = useState(false);

  useEffect(() => {
    if (editingCards.size === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editingCards]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (loggingOut || chatPending || status === "reloading" || !over || active.id === over.id) {
      return;
    }

    updateBoard((prev) => ({
      ...prev,
      columns: moveCard(prev.columns, active.id as string, over.id as string),
    }));
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    updateBoard((prev) => ({
      ...prev,
      columns: prev.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    }));
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const id = createId();
    updateBoard((prev) => Object.keys(prev.cards).length >= MAX_CARDS ? prev : ({
      ...prev,
      cards: {
        ...prev.cards,
        [id]: { id, title, details },
      },
      columns: prev.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    }));
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    updateBoard((prev) => {
      return {
        ...prev,
        cards: Object.fromEntries(
          Object.entries(prev.cards).filter(([id]) => id !== cardId)
        ),
        columns: prev.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                cardIds: column.cardIds.filter((id) => id !== cardId),
              }
            : column
        ),
      };
    });
  };

  const handleEditCard = (cardId: string, title: string, details: string) => {
    updateBoard((prev) => ({
      ...prev,
      cards: { ...prev.cards, [cardId]: { ...prev.cards[cardId], title, details } },
    }));
  };

  const handleEditingChange = (cardId: string, editing: boolean) => {
    setEditingCards((current) => {
      const next = new Set(current);
      if (editing) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  };

  const handleReauthenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReauthenticating(true);
    setReauthError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.status === 401) {
        setReauthError("Invalid username or password.");
      } else if (!response.ok) {
        setReauthError("Unable to sign in. Please try again.");
      } else {
        setPassword("");
        retrySave();
      }
    } catch {
      setReauthError("Unable to sign in. Please try again.");
    } finally {
      setReauthenticating(false);
    }
  };

  const activeCard = activeCardId && board ? board.cards[activeCardId] : null;
  const unsaved = editingCards.size > 0 || chatPending ||
    (status !== "loading" && status !== "load-error" && status !== "saved");

  const errorPanel = status === "error" || status === "invalid" || status === "conflict" ||
    status === "expired" || status === "reloading";
  const linkButton = "font-mono text-xs uppercase tracking-[0.15em] text-[var(--cyan)] underline underline-offset-4 hover:text-white disabled:opacity-50";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[2400px] flex-col gap-4 overflow-x-clip px-4 py-4 sm:px-6 lg:px-8">
      <header className="hud-panel px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="shrink-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.35em] text-[var(--magenta)]">
              SYS://single_board <span className="text-[var(--muted)]">{"// link stable"}</span>
            </p>
            <h1 className="mt-1 font-display text-2xl font-black uppercase sm:text-3xl">
              <span className="glitch">
                Kanban Studio
                <span className="glitch-layer glitch-layer-a" aria-hidden="true">Kanban Studio</span>
                <span className="glitch-layer glitch-layer-b" aria-hidden="true">Kanban Studio</span>
              </span>
            </h1>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {board?.columns.map((column, index) => (
              <div
                key={column.id}
                className="flex items-center gap-2 border border-[var(--line)] bg-[var(--field)] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--text)]"
              >
                <span className={["neon-cyan", "neon-magenta", "neon-yellow"][index % 3]}>
                  {column.cardIds.length.toString().padStart(2, "0")}
                </span>
                <span>{column.title}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4">
            {board && (
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--muted)]">
                <span className={clsx("status-dot", (status !== "saved" || editingCards.size > 0) && "status-dot-busy")} />
                <p role="status" className="max-w-[16rem]">
                  {editingCards.size > 0 ? "Card edits are not saved until you select Save." :
                    status === "saved" ? "All changes saved." : status === "saving" ? "Saving changes..." : ""}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              disabled={loggingOut || unsaved}
              className="cyber-btn cyber-btn-ghost"
            >
              <PowerIcon />
              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
        {logoutError && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{logoutError}</p>}
        {status === "loading" && <p role="status" className="cursor-blink mt-3 font-mono text-sm text-[var(--cyan)]">Loading board...</p>}
        {status === "load-error" && (
          <div role="alert" className="mt-3 text-sm text-[var(--danger)]">
            Unable to load the board. <button type="button" onClick={retryLoad} className={linkButton}>Try again</button>
          </div>
        )}
        {warning && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{warning}</p>}
        {legacy && (
          <div className="mt-4 space-y-3 border border-[rgba(249,233,0,0.4)] bg-[rgba(249,233,0,0.05)] p-4 text-sm">
            {legacyBlocked ? (
              <p>A previous board remains in this tab, but the database board has changed and cannot be replaced by an import.</p>
            ) : (
              <p>A previous board was found in this tab. Import it into the untouched database board, or use the database board instead.</p>
            )}
            <div className="flex flex-wrap gap-3">
              {!legacyBlocked && <button type="button" onClick={importLegacy} className="cyber-btn cyber-btn-primary">Import tab board</button>}
              <button type="button" onClick={keepDatabaseBoard} className="cyber-btn cyber-btn-ghost">
                {legacyBlocked ? "Dismiss" : "Use database board"}
              </button>
            </div>
          </div>
        )}
        {errorPanel && (
          <div className="mt-4 space-y-3 border border-[rgba(255,59,92,0.5)] bg-[rgba(255,59,92,0.07)] p-4 text-sm">
            <p role="alert" className="text-[var(--danger)]">
              {status === "error" && "Unable to save. Your changes are not saved."}
              {status === "invalid" && "Your changes are not saved. Correct them and retry, or load the latest board to discard them."}
              {status === "conflict" && "The board changed elsewhere. Your changes are not saved. Loading the latest board will discard these local changes."}
              {status === "expired" && "Your session expired. Your changes are not saved. Sign in again to retry."}
              {status === "reloading" && "Loading the latest board..."}
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {(status === "error" || status === "invalid") && <button type="button" onClick={retrySave} className={linkButton}>Retry save</button>}
              {(status === "conflict" || status === "invalid") && <button type="button" disabled={editingCards.size > 0} onClick={() => void loadLatest()} className={linkButton}>Load latest board</button>}
              {status !== "reloading" && (
                <button type="button" onClick={onLogout} disabled={loggingOut || editingCards.size > 0} className={linkButton}>
                  Discard unsaved changes and sign out
                </button>
              )}
            </div>
            {status === "expired" && (
              <form onSubmit={handleReauthenticate} className="flex flex-wrap items-end gap-3">
                <label className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--muted)]">Username<input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="cyber-input mt-1 block normal-case" /></label>
                <label className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--muted)]">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="cyber-input mt-1 block" /></label>
                <button disabled={reauthenticating} type="submit" className="cyber-btn cyber-btn-primary">Sign in and retry</button>
                {reauthError && <p role="alert" className="text-[var(--danger)]">{reauthError}</p>}
              </form>
            )}
          </div>
        )}
      </header>

      {board && (!legacy || legacyBlocked) && (
        <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <fieldset
              disabled={loggingOut || chatPending || status === "reloading"}
              className="grid min-w-0 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
            >
              {board.columns.map((column, index) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  index={index}
                  cards={column.cardIds.map((cardId) => board.cards[cardId])}
                  atCardLimit={Object.keys(board.cards).length >= MAX_CARDS}
                  onRename={handleRenameColumn}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                  onEditCard={handleEditCard}
                  onEditingChange={handleEditingChange}
                />
              ))}
            </fieldset>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          <AIChatSidebar
            disabled={loggingOut || status !== "saved" || editingCards.size > 0}
            onBoardUpdate={acceptServerBoard}
            onConflict={loadLatest}
            onPendingChange={setChatPending}
            onSessionExpired={onSessionExpired}
          />
        </div>
      )}
    </main>
  );
};
