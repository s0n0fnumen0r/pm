"use client";

import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { SendIcon } from "@/components/icons";
import { isBoardData } from "@/lib/boardStorage";
import type { BoardData } from "@/lib/kanban";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  response: string;
  revision: number;
  board: BoardData;
};

type AIChatSidebarProps = {
  disabled: boolean;
  onBoardUpdate: (board: BoardData, revision: number) => void;
  onConflict: () => Promise<boolean>;
  onPendingChange: (pending: boolean) => void;
  onSessionExpired: () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isChatResponse = (value: unknown): value is ChatResponse =>
  isRecord(value) &&
  typeof value.response === "string" &&
  value.response.trim().length > 0 &&
  typeof value.revision === "number" &&
  Number.isSafeInteger(value.revision) &&
  value.revision >= 0 &&
  isBoardData(value.board);

const getErrorDetail = (value: unknown): string | null =>
  isRecord(value) && typeof value.detail === "string" ? value.detail : null;

export const AIChatSidebar = ({
  disabled,
  onBoardUpdate,
  onConflict,
  onPendingChange,
  onSessionExpired,
}: AIChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending || disabled) return;

    setDraft("");
    setError("");
    setPending(true);
    onPendingChange(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: messages.slice(-40) }),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        setDraft(message);
        setError("The assistant returned an invalid response.");
        return;
      }

      if (!response.ok) {
        setDraft(message);
        if (response.status === 401) {
          setError("Your session expired. Please sign in again.");
          onSessionExpired();
        } else if (response.status === 409) {
          const loadedLatest = await onConflict();
          setError(
            loadedLatest
              ? "The board changed while the assistant was working. Its update was not applied; the latest board has been loaded."
              : "The board changed while the assistant was working. Its update was not applied, and the latest board could not be loaded."
          );
        } else {
          setError(getErrorDetail(body) ?? `The assistant request failed (${response.status}).`);
        }
        return;
      }

      if (!isChatResponse(body)) {
        setDraft(message);
        setError("The assistant returned an invalid response.");
        return;
      }

      onBoardUpdate(body.board, body.revision);
      setMessages((current) => [
        ...current,
        { role: "user", content: message },
        { role: "assistant", content: body.response },
      ]);
    } catch {
      setDraft(message);
      setError("Unable to reach the assistant. Check your connection and try again.");
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  };

  return (
    <aside
      aria-labelledby="ai-chat-title"
      className="hud-panel flex h-[480px] max-h-[80vh] min-h-[360px] flex-col 2xl:sticky 2xl:top-4 2xl:h-[calc(100vh-8.5rem)] 2xl:max-h-none"
    >
      <header className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.3em]">
          <span className="text-[var(--magenta)]">Kanban assistant</span>
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <span className={clsx("status-dot", (pending || disabled) && "status-dot-busy")} />
            {pending ? "Processing" : disabled ? "Standby" : "Online"}
          </span>
        </div>
        <h2 id="ai-chat-title" className="mt-1 font-display text-base font-bold uppercase text-[var(--text)]">
          Chat with your board
        </h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Your board and messages are sent to OpenRouter to answer your request.
        </p>
      </header>

      <div
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.length === 0 && (
          <p className="border border-dashed border-[var(--line)] p-4 font-mono text-xs leading-6 text-[var(--muted)]">
            <span className="neon-cyan">&gt;</span> Ask a question about your board or request card changes.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={clsx(
              "max-w-[92%] border px-3 py-2 text-sm leading-6",
              message.role === "user"
                ? "ml-auto border-[rgba(255,43,214,0.45)] bg-[rgba(255,43,214,0.1)] text-[var(--text)]"
                : "mr-auto border-[var(--line-strong)] bg-[rgba(0,240,255,0.06)] text-[var(--text)]"
            )}
          >
            <p className={clsx(
              "mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em]",
              message.role === "user" ? "neon-magenta" : "neon-cyan"
            )}>
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ))}
        {pending && <p role="status" className="cursor-blink font-mono text-xs uppercase tracking-[0.15em] text-[var(--cyan)]">Assistant is thinking...</p>}
      </div>

      {error && <p role="alert" className="px-4 pb-2 text-sm text-[var(--danger)]">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-[var(--line)] p-4">
        <label htmlFor="ai-chat-message" className="sr-only">Message the assistant</label>
        <textarea
          id="ai-chat-message"
          rows={3}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a question or request a board change..."
          disabled={disabled || pending}
          className="cyber-input resize-none"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] text-[var(--muted)]">{draft.length}/4000</span>
          <button
            type="submit"
            disabled={disabled || pending || !draft.trim()}
            className="cyber-btn cyber-btn-primary"
          >
            <SendIcon />
            {pending ? "Thinking..." : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
};
