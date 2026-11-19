import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onDelete: (cardId: string) => void;
  onEdit: (cardId: string, title: string, details: string) => void;
  onEditingChange: (cardId: string, editing: boolean) => void;
};

export const KanbanCard = ({ card, onDelete, onEdit, onEditingChange }: KanbanCardProps) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const [titleError, setTitleError] = useState("");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: editing });

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError("A card title is required.");
      return;
    }
    onEdit(card.id, title.trim(), details.trim());
    setEditing(false);
    onEditingChange(card.id, false);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...(!editing && attributes)}
      {...(!editing && listeners)}
      data-testid={`card-${card.id}`}
    >
      {editing ? (
        <form onSubmit={save} onPointerDown={(event) => event.stopPropagation()} className="space-y-3">
          <label className="block text-xs font-semibold text-[var(--navy-dark)]">
            Card title
            <input
              aria-label="Edit card title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleError("");
              }}
              className="mt-1 w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm"
              required
            />
          </label>
          {titleError && <p role="alert" className="text-xs text-red-700">{titleError}</p>}
          <label className="block text-xs font-semibold text-[var(--navy-dark)]">
            Details
            <textarea
              aria-label="Edit card details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded-full bg-[var(--secondary-purple)] px-3 py-2 text-xs font-semibold text-white">
              Save
            </button>
            <button type="button" onClick={() => {
              setEditing(false);
              onEditingChange(card.id, false);
            }} className="rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold">
              Cancel
            </button>
          </div>
        </form>
      ) : <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
            {card.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
            {card.details}
          </p>
        </div>
        <div className="flex flex-col" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              setTitle(card.title);
              setDetails(card.details);
              setTitleError("");
              setEditing(true);
              onEditingChange(card.id, true);
            }}
            className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--primary-blue)] transition hover:border-[var(--stroke)]"
            aria-label={`Edit ${card.title}`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(card.id)}
            className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
            aria-label={`Delete ${card.title}`}
          >
            Remove
          </button>
        </div>
      </div>}
    </article>
  );
};
