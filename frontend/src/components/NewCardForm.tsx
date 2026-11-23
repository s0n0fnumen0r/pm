import { useState, type FormEvent } from "react";
import { MAX_CARD_DETAILS_LENGTH, MAX_CARD_TITLE_LENGTH, MAX_CARDS } from "@/lib/kanban";
import { PlusIcon } from "@/components/icons";

const initialFormState = { title: "", details: "" };

type NewCardFormProps = {
  onAdd: (title: string, details: string) => void;
  atLimit: boolean;
};

export const NewCardForm = ({ onAdd, atLimit }: NewCardFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState(initialFormState);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.title.trim()) {
      return;
    }
    onAdd(formState.title.trim(), formState.details.trim());
    setFormState(initialFormState);
    setIsOpen(false);
  };

  return (
    <div className="mt-3">
      {isOpen ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            value={formState.title}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, title: event.target.value }))
            }
            placeholder="Card title"
            maxLength={MAX_CARD_TITLE_LENGTH}
            className="cyber-input font-medium"
            required
          />
          <textarea
            value={formState.details}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, details: event.target.value }))
            }
            placeholder="Details"
            maxLength={MAX_CARD_DETAILS_LENGTH}
            rows={3}
            className="cyber-input resize-none"
          />
          <div className="flex items-center gap-2">
            <button type="submit" className="cyber-btn cyber-btn-primary">
              Add card
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setFormState(initialFormState);
              }}
              className="cyber-btn cyber-btn-ghost"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          disabled={atLimit}
          title={atLimit ? `The board is limited to ${MAX_CARDS} cards` : undefined}
          className="flex w-full items-center justify-center gap-2 border border-dashed border-[var(--line)] px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-[var(--cyan)] hover:bg-[rgba(0,240,255,0.06)] hover:text-[var(--cyan)] disabled:opacity-40"
        >
          <PlusIcon />
          Add a card
        </button>
      )}
    </div>
  );
};
