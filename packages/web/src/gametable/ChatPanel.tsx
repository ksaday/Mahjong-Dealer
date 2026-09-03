// The chat panel and signal buttons (docs/32_UX/Interaction_Patterns.md
// §6): plain text always, never persisted beyond the session (`FR-131`),
// and available in every table state including while paused.
//
// Docked-vs-drawer at narrow widths (Table_Layout_and_Perspective.md §4)
// is a pure CSS concern this component leaves to its stylesheet — it
// always renders the same markup rather than measuring viewport width in
// script, a known simplification flagged rather than silently narrowed.
import { useState, type FormEvent } from "react";
import type { Seat } from "@mahjong-dealer/shared";
import { seatLabel } from "./seatLayout.js";

const MAX_LENGTH = 512;
const WARN_AT = 480;

export interface ChatMessage {
  readonly key: string;
  readonly seat: Seat;
  readonly displayName: string;
  readonly text: string;
}

export interface ChatPanelProps {
  readonly messages: readonly ChatMessage[];
  readonly onSend: (text: string) => void;
  readonly onSignal: (signal: "knock" | "wait" | "ack") => void;
}

const SIGNAL_LABELS: Readonly<Record<"knock" | "wait" | "ack", string>> = {
  knock: "Knock",
  wait: "Wait",
  ack: "Ack",
};

export function ChatPanel({ messages, onSend, onSignal }: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || text.length > MAX_LENGTH) return;
    onSend(text);
    setDraft("");
  }

  return (
    <section className="chat-panel" aria-label="Table chat">
      <ul className="chat-log" aria-live="polite">
        {messages.map((m) => (
          <li key={m.key}>
            <span className="chat-sender">{seatLabel(m.seat)} ({m.displayName})</span>: <span className="chat-text">{m.text}</span>
          </li>
        ))}
      </ul>
      <div className="chat-signals">
        {(["knock", "wait", "ack"] as const).map((signal) => (
          <button key={signal} type="button" className="button-link" onClick={() => onSignal(signal)}>
            {SIGNAL_LABELS[signal]}
          </button>
        ))}
      </div>
      <form className="chat-form" onSubmit={handleSubmit}>
        <label htmlFor="chat-input" className="visually-hidden">
          Message
        </label>
        <input
          id="chat-input"
          type="text"
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the table"
        />
        {draft.length >= WARN_AT && (
          <span className="chat-count">
            {draft.length}/{MAX_LENGTH}
          </span>
        )}
        <button type="submit" className="button-primary" disabled={draft.trim().length === 0}>
          Send
        </button>
      </form>
    </section>
  );
}
