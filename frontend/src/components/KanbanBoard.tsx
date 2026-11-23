"use client";

import { useEffect, useState, type FormEvent } from "react";
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

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                disabled={loggingOut || unsaved}
                className="rounded-full border border-[var(--stroke)] px-4 py-2 text-sm font-semibold text-[var(--navy-dark)] hover:border-[var(--primary-blue)] disabled:opacity-60"
              >
                {loggingOut ? "Signing out..." : "Sign out"}
              </button>
              {logoutError && <p role="alert" className="text-sm text-red-700">{logoutError}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board?.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
          {status === "loading" && <p role="status">Loading board...</p>}
          {status === "load-error" && (
            <div role="alert" className="text-sm text-red-700">
              Unable to load the board. <button type="button" onClick={retryLoad} className="underline">Try again</button>
            </div>
          )}
          {board && <p role="status" className="text-sm text-[var(--gray-text)]">
            {editingCards.size > 0 ? "Card edits are not saved until you select Save." :
              status === "saved" ? "All changes saved." : status === "saving" ? "Saving changes..." : ""}
          </p>}
          {warning && <p role="alert" className="text-sm text-red-700">{warning}</p>}
          {legacy && (
            <div className="space-y-3 rounded-xl border border-[var(--stroke)] p-4 text-sm">
              {legacyBlocked ? (
                <p>A previous board remains in this tab, but the database board has changed and cannot be replaced by an import.</p>
              ) : (
                <p>A previous board was found in this tab. Import it into the untouched database board, or use the database board instead.</p>
              )}
              <div className="flex flex-wrap gap-3">
                {!legacyBlocked && <button type="button" onClick={importLegacy} className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 font-semibold text-white">Import tab board</button>}
                <button type="button" onClick={keepDatabaseBoard} className="rounded-full border border-[var(--stroke)] px-4 py-2 font-semibold">
                  {legacyBlocked ? "Dismiss" : "Use database board"}
                </button>
              </div>
            </div>
          )}
          {(status === "error" || status === "invalid" || status === "conflict" || status === "expired" || status === "reloading") && (
            <div className="space-y-3 rounded-xl border border-red-200 p-4 text-sm">
              <p role="alert" className="text-red-700">
                {status === "error" && "Unable to save. Your changes are not saved."}
                {status === "invalid" && "Your changes are not saved. Correct them and retry, or load the latest board to discard them."}
                {status === "conflict" && "The board changed elsewhere. Your changes are not saved. Loading the latest board will discard these local changes."}
                {status === "expired" && "Your session expired. Your changes are not saved. Sign in again to retry."}
                {status === "reloading" && "Loading the latest board..."}
              </p>
              {(status === "error" || status === "invalid") && <button type="button" onClick={retrySave} className="mr-3 underline">Retry save</button>}
              {(status === "conflict" || status === "invalid") && <button type="button" disabled={editingCards.size > 0} onClick={() => void loadLatest()} className="mr-3 underline disabled:opacity-50">Load latest board</button>}
              {status !== "reloading" && (
                <button type="button" onClick={onLogout} disabled={loggingOut || editingCards.size > 0} className="underline disabled:opacity-50">
                  Discard unsaved changes and sign out
                </button>
              )}
              {status === "expired" && (
                <form onSubmit={handleReauthenticate} className="flex flex-wrap items-end gap-3">
                  <label>Username<input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="block rounded-xl border border-[var(--stroke)] px-3 py-2" /></label>
                  <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="block rounded-xl border border-[var(--stroke)] px-3 py-2" /></label>
                  <button disabled={reauthenticating} type="submit" className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 font-semibold text-white">Sign in and retry</button>
                  {reauthError && <p role="alert" className="text-red-700">{reauthError}</p>}
                </form>
              )}
            </div>
          )}
        </header>

        {board && (!legacy || legacyBlocked) && (
          <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <fieldset
                disabled={loggingOut || chatPending || status === "reloading"}
                className="grid min-w-0 gap-6 lg:grid-cols-5"
              >
                {board.columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
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
    </div>
  );
};
