import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { MAX_CARD_DETAILS_LENGTH, MAX_CARD_TITLE_LENGTH, type Card } from "@/lib/kanban";
import { DeleteIcon, EditIcon } from "@/components/icons";

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
        "cyber-card group px-3 py-3",
        editing ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30"
      )}
      {...(!editing && attributes)}
      {...(!editing && listeners)}
      data-testid={`card-${card.id}`}
    >
      {editing ? (
        <form onSubmit={save} onPointerDown={(event) => event.stopPropagation()} className="space-y-3">
          <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--cyan)]">
            Card title
            <input
              aria-label="Edit card title"
              maxLength={MAX_CARD_TITLE_LENGTH}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleError("");
              }}
              className="cyber-input mt-1 font-sans normal-case tracking-normal"
              required
            />
          </label>
          {titleError && <p role="alert" className="text-xs text-[var(--danger)]">{titleError}</p>}
          <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--cyan)]">
            Details
            <textarea
              aria-label="Edit card details"
              maxLength={MAX_CARD_DETAILS_LENGTH}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              className="cyber-input mt-1 resize-y font-sans normal-case tracking-normal"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="cyber-btn cyber-btn-primary">
              Save
            </button>
            <button type="button" onClick={() => {
              setEditing(false);
              onEditingChange(card.id, false);
            }} className="cyber-btn cyber-btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <h4 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-[var(--text)]">
              {card.title}
            </h4>
            <div
              className="-mr-1 -mt-1 flex shrink-0 opacity-60 transition group-hover:opacity-100 group-focus-within:opacity-100"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setTitle(card.title);
                  setDetails(card.details);
                  setTitleError("");
                  setEditing(true);
                  onEditingChange(card.id, true);
                }}
                className="icon-btn"
                aria-label={`Edit ${card.title}`}
                title="Edit card"
              >
                <EditIcon />
              </button>
              <button
                type="button"
                onClick={() => onDelete(card.id)}
                className="icon-btn icon-btn-danger"
                aria-label={`Delete ${card.title}`}
                title="Delete card"
              >
                <DeleteIcon />
              </button>
            </div>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--muted)]">
            {card.details || "No details yet."}
          </p>
        </>
      )}
    </article>
  );
};
