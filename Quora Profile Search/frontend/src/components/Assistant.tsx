import { FormEvent, useEffect, useRef, useState } from "react";
import { api, type ChatMessage } from "../api/client";

const SUGGESTIONS = [
  "Write a short professional profile summary.",
  "Why might these profiles belong to the same person?",
  "Which matches are weakest, and why?",
  "What professional information is missing or conflicting?",
  "Which additional public sources could confirm this profile?",
];

export default function Assistant({ personId, personName }: { personId: number; personName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
  }, [personId]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const { reply } = await api.assistant(personId, next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card chat">
      <div className="chat-head">
        <h2>Assistant</h2>
        <div className="muted small">Answers only from the stored record for {personName}.</div>
      </div>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn sm" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="msg assistant progress"><span className="spinner" />Thinking…</div>}
        {error && <div className="alert small">{error}</div>}
      </div>
      <form className="chat-input" onSubmit={(e: FormEvent) => { e.preventDefault(); send(input); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask about this profile…"
        />
        <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
