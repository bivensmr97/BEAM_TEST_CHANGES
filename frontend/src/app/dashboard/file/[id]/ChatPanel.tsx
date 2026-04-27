"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColType = { name: string; inferred_type: string };

type HealthSummary = {
  score: number;
  grade: string;
  score_label: string;
  total_rows: number;
  total_columns: number;
  duplicate_count: number;
  issues: { key: string; severity: string; title: string; plain_message: string; recommendation: string }[];
  category_scores: Record<string, number>;
  category_labels: Record<string, string>;
  scoring_explanation: Record<string, string>;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  agents?: string[];
  loading?: boolean;
  isError?: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_LABELS: Record<string, string> = {
  health_advisor:     "Health Advisor",
  data_quality_coach: "Data Quality Coach",
  chart_interpreter:  "Chart Guide",
  action_planner:     "Action Planner",
  app_guide:          "App Guide",
};

const QUICK_PROMPTS: Record<string, string[]> = {
  overview: [
    "Summarise this file for me",
    "What should I look at first?",
    "What are the key patterns in this data?",
  ],
  health: [
    "Why is my score this low?",
    "What's the most important issue to fix?",
    "Give me a prioritised action plan",
  ],
  explore: [
    "What charts would work best for this data?",
    "How do I build a useful chart?",
    "What business questions can I answer here?",
  ],
};

const FALLBACK_PROMPTS = [
  "What should I do with this data?",
  "Explain my health score",
  "How do I use this app?",
];

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgentBadge({ agents }: { agents: string[] }) {
  if (!agents.length) return null;
  const label = agents.map((a) => AGENT_LABELS[a] ?? a).join(" · ");
  return (
    <span className="inline-block rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-xs font-medium text-cyan-400 mb-1.5">
      {label}
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center h-4">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-cyan-500 px-3.5 py-2.5 text-sm text-white leading-relaxed">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      {msg.agents && msg.agents.length > 0 && <AgentBadge agents={msg.agents} />}
      <div
        className={[
          "max-w-[90%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed",
          msg.isError
            ? "bg-red-950/40 border border-red-500/30 text-red-300"
            : "bg-[color:var(--bg-panel-2)] border border-[var(--border)] text-[var(--text-main)]",
        ].join(" ")}
      >
        {msg.loading ? (
          <TypingDots />
        ) : (
          <span className="whitespace-pre-wrap">{msg.content}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ChatPanel({
  fileId,
  token,
  currentTab,
  sheetName,
  healthContext,
  initialSummary,
}: {
  fileId: string;
  token: string;
  currentTab: string;
  sheetName?: string | null;
  healthContext?: HealthSummary | null;
  initialSummary?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  // Column types loaded once on first open
  const [colTypes, setColTypes] = useState<ColType[]>([]);
  const colsLoadedRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Focus input on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ── Load column types once on first open ──────────────────────────────────
  useEffect(() => {
    if (!open || colsLoadedRef.current || !fileId || !token) return;
    colsLoadedRef.current = true;

    const url = new URL(`${API_BASE_URL}/api/files/${fileId}/insights`);
    if (sheetName) url.searchParams.set("sheet_name", sheetName);

    fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.columns) setColTypes(data.columns as ColType[]);
      })
      .catch(() => {});
  }, [open, fileId, token, sheetName]);

  // ── Show initial AI summary as welcome message ────────────────────────────
  useEffect(() => {
    if (!open || !initialSummary || messages.length > 0) return;
    setMessages([
      {
        id: makeId(),
        role: "assistant",
        content: initialSummary,
        agents: ["health_advisor"],
      },
    ]);
  }, [open, initialSummary, messages.length]);

  // ── Send a message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      const userMsg: Message = { id: makeId(), role: "user", content: text.trim() };
      const assistantMsgId = makeId();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        loading: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setStreaming(true);

      // Build history from current messages (before the new pair is appended)
      const history = messages
        .filter((m) => !m.loading)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const body = {
        message: text.trim(),
        context: {
          tab: currentTab,
          sheet_name: sheetName ?? null,
          health_summary: healthContext ?? null,
          column_types: colTypes,
        },
        history,
      };

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/chat`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });

          // SSE events are separated by double newlines
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";

          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (!raw) continue;

              try {
                const event = JSON.parse(raw);

                if (event.type === "routing") {
                  // Show agent label as soon as routing is resolved
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, agents: event.agents ?? [], loading: true }
                        : m
                    )
                  );
                } else if (event.type === "token") {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: m.content + event.content, loading: false }
                        : m
                    )
                  );
                } else if (event.type === "error") {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: event.content, loading: false, isError: true }
                        : m
                    )
                  );
                } else if (event.type === "done") {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId ? { ...m, loading: false } : m
                    )
                  );
                }
              } catch {
                // Ignore malformed SSE lines
              }
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: "Couldn't reach the AI assistant. Please check your connection and try again.",
                    loading: false,
                    isError: true,
                  }
                : m
            )
          );
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [streaming, messages, currentTab, sheetName, healthContext, colTypes, fileId, token]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearConversation() {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
  }

  const quickPrompts = QUICK_PROMPTS[currentTab] ?? FALLBACK_PROMPTS;
  const isEmpty = messages.length === 0;

  // ── Collapsed button ───────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 bg-cyan-500 hover:bg-cyan-400 text-white font-bold rounded-full shadow-xl transition-all px-4 py-3 text-sm flex items-center gap-2"
        title="Ask the AI assistant a question about your data"
        aria-label="Open AI Assistant"
      >
        <span className="text-base leading-none">✦</span>
        Ask AI
      </button>
    );
  }

  // ── Open panel ────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed right-6 bottom-6 w-[22rem] sm:w-[26rem] rounded-2xl border border-[var(--border)] bg-[color:var(--bg-panel)] shadow-2xl flex flex-col overflow-hidden"
      style={{ maxHeight: "75vh", zIndex: 50 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[color:var(--bg-panel)] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 text-base leading-none">✦</span>
          <span className="text-sm font-semibold text-[var(--text-main)]">AI Assistant</span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearConversation}
              title="Clear conversation"
              aria-label="Clear conversation"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] px-1.5 py-1 rounded transition-colors"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] px-1.5 py-1 rounded transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-ai min-h-0">
        {isEmpty ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-[var(--text-muted)] leading-relaxed text-center">
              Ask anything about your data, your health score, or how to use the app.
            </p>
            <div className="space-y-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  disabled={streaming}
                  className="w-full text-left rounded-xl border border-[var(--border)] bg-[color:var(--bg-main)] hover:border-cyan-500/40 hover:bg-cyan-500/5 px-3.5 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[var(--border)] px-3 py-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={streaming ? "Responding…" : "Ask a question…"}
            disabled={streaming}
            maxLength={500}
            className="flex-1 rounded-xl border border-[var(--border)] bg-[color:var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-cyan-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="shrink-0 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 transition-colors"
            aria-label="Send"
          >
            Send
          </button>
        </form>
        <p className="mt-1.5 text-xs text-[var(--text-muted)] text-center">
          AI summaries use a sample of your data · Conversation resets on page reload
        </p>
      </div>
    </div>
  );
}
