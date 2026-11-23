import type { Card } from "@/lib/kanban";

type KanbanCardPreviewProps = {
  card: Card;
};

export const KanbanCardPreview = ({ card }: KanbanCardPreviewProps) => (
  <article className="cyber-card rotate-2 cursor-grabbing border-[var(--cyan)] px-3 py-3 shadow-[var(--glow-cyan)]">
    <h4 className="break-words text-[15px] font-semibold leading-snug text-[var(--text)]">
      {card.title}
    </h4>
    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--muted)]">
      {card.details || "No details yet."}
    </p>
  </article>
);
