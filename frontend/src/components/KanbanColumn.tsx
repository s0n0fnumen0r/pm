import { useState, type CSSProperties } from "react";
import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { MAX_COLUMN_TITLE_LENGTH, type Card, type Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

const ACCENTS = ["var(--cyan)", "var(--magenta)", "var(--yellow)"];

type KanbanColumnProps = {
  column: Column;
  index: number;
  cards: Card[];
  atCardLimit: boolean;
  onRename: (columnId: string, title: string) => void;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onDeleteCard: (columnId: string, cardId: string) => void;
  onEditCard: (cardId: string, title: string, details: string) => void;
  onEditingChange: (cardId: string, editing: boolean) => void;
};

export const KanbanColumn = ({
  column,
  index,
  cards,
  atCardLimit,
  onRename,
  onAddCard,
  onDeleteCard,
  onEditCard,
  onEditingChange,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [draft, setDraft] = useState(column.title);
  const [savedTitle, setSavedTitle] = useState(column.title);
  if (column.title !== savedTitle) {
    setSavedTitle(column.title);
    setDraft(column.title);
  }

  // Rename once editing ends; a blank title reverts to the current one.
  const commitTitle = () => {
    const title = draft.trim();
    if (!title) setDraft(column.title);
    else if (title !== column.title) onRename(column.id, title);
    else setDraft(title);
  };

  const accent = ACCENTS[index % ACCENTS.length];

  return (
    <section
      ref={setNodeRef}
      style={{ "--col-accent": accent } as CSSProperties}
      className={clsx(
        "hud-panel flex min-h-[200px] min-w-0 flex-col p-3 transition-shadow sm:min-h-[360px] lg:min-h-[calc(100vh-260px)]",
        isOver && "shadow-[0_0_0_1px_var(--col-accent),0_0_28px_-4px_var(--col-accent)]"
      )}
      data-testid={`column-${column.id}`}
    >
      <div className="border-b border-[var(--line)] pb-3">
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.25em]">
          <span style={{ color: accent }}>{`${String(index + 1).padStart(2, "0")} //`}</span>
          <span className="text-[var(--muted)]">{cards.length} cards</span>
        </div>
        <input
          value={draft}
          maxLength={MAX_COLUMN_TITLE_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(column.title);
          }}
          className="mt-2 w-full border-b border-transparent bg-transparent font-display text-sm font-bold uppercase text-[var(--text)] outline-none transition focus:border-[var(--col-accent)]"
          aria-label="Column title"
        />
        <div className="mt-2 h-[2px] w-full" style={{ background: `linear-gradient(90deg, ${accent}, transparent)`, boxShadow: `0 0 8px ${accent}` }} />
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-2.5">
        <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              onDelete={(cardId) => onDeleteCard(column.id, cardId)}
              onEdit={onEditCard}
              onEditingChange={onEditingChange}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center border border-dashed border-[var(--line)] px-3 py-6 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
            Drop a card here
          </div>
        )}
      </div>
      <NewCardForm
        atLimit={atCardLimit}
        onAdd={(title, details) => onAddCard(column.id, title, details)}
      />
    </section>
  );
};
