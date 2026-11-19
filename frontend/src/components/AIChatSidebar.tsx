"use client";

import { useState, type FormEvent } from "react";
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
      className="flex h-[640px] max-h-[75vh] min-h-[420px] flex-col overflow-hidden rounded-[24px] border border-[var(--stroke)] bg-white/90 shadow-[var(--shadow)] backdrop-blur"
    >
      <header className="border-b border-[var(--stroke)] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
          Kanban assistant
        </p>
        <h2 id="ai-chat-title" className="mt-2 font-display text-xl font-semibold text-[var(--navy-dark)]">
          Chat with your board
        </h2>
        <p className="mt-2 text-xs leading-5 text-[var(--gray-text)]">
          Your board and messages are sent to OpenRouter to answer your request.
        </p>
      </header>

      <div
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.length === 0 && (
          <p className="rounded-2xl bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--gray-text)]">
            Ask a question about your board or request card changes.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[95%] rounded-2xl px-4 py-3 text-sm leading-6 ${
              message.role === "user"
                ? "ml-auto bg-[var(--navy-dark)] text-white"
                : "mr-auto border border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]"
            }`}
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ))}
        {pending && <p role="status" className="text-sm text-[var(--gray-text)]">Assistant is thinking...</p>}
      </div>

      {error && <p role="alert" className="px-4 pb-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-3 border-t border-[var(--stroke)] p-4">
        <label htmlFor="ai-chat-message" className="sr-only">Message the assistant</label>
        <textarea
          id="ai-chat-message"
          rows={3}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a question or request a board change..."
          disabled={disabled || pending}
          className="w-full resize-none rounded-2xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--primary-blue)] disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--gray-text)]">{draft.length}/4000</span>
          <button
            type="submit"
            disabled={disabled || pending || !draft.trim()}
            className="rounded-full bg-[var(--secondary-purple)] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {pending ? "Thinking..." : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
};
