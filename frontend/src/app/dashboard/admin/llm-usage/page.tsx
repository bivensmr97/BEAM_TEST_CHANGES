"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type UsageSummary = {
  total_calls: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost: number;
  by_model: {
    model: string;
    operation: string;
    calls: number;
    total_tokens: number;
    estimated_cost: number;
  }[];
};

type UsageEvent = {
  id: string;
  operation: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  status: string;
  error_message?: string | null;
  file_id?: string | null;
  created_at: string;
};

function formatCost(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export default function LLMUsagePage() {
  const { tokens, user } = useAuth();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${tokens.accessToken ?? ""}` }),
    [tokens.accessToken]
  );

  useEffect(() => {
    if (!tokens.accessToken || !isAdmin) {
      setLoading(false);
      return;
    }

    async function loadUsage() {
      setLoading(true);
      try {
        const [summaryRes, eventsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/admin/llm-usage/summary`, { headers }),
          fetch(`${API_BASE_URL}/api/admin/llm-usage/events?limit=50`, { headers }),
        ]);

        if (!summaryRes.ok || !eventsRes.ok) {
          throw new Error("Could not load AI usage.");
        }

        setSummary((await summaryRes.json()) as UsageSummary);
        setEvents((await eventsRes.json()) as UsageEvent[]);
        setError(null);
      } catch (err: unknown) {
        setError(errorMessage(err, "Could not load AI usage."));
      } finally {
        setLoading(false);
      }
    }

    loadUsage();
  }, [headers, isAdmin, tokens.accessToken]);

  return (
    <AuthGuard>
      <div className="px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-[var(--text-main)]">AI Usage</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Estimated LLM usage and cost for your tenant.
          </p>
        </header>

        {!isAdmin && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-4 text-sm text-red-300">
            Admin privileges are required to view AI usage.
          </div>
        )}

        {loading && isAdmin && (
          <div className="py-12 text-center text-sm text-[var(--text-muted)]">
            Loading AI usage...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {summary && isAdmin && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Estimated cost", formatCost(summary.estimated_cost)],
                ["AI calls", summary.total_calls.toLocaleString()],
                ["Total tokens", summary.total_tokens.toLocaleString()],
                ["Output tokens", summary.completion_tokens.toLocaleString()],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-panel)] p-4"
                >
                  <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-cyan-300">{value}</p>
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-panel)] overflow-hidden">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <h2 className="text-sm font-semibold text-[var(--text-main)]">Usage by Model</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3">Model</th>
                      <th className="px-4 py-3">Operation</th>
                      <th className="px-4 py-3">Calls</th>
                      <th className="px-4 py-3">Tokens</th>
                      <th className="px-4 py-3">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_model.map((row) => (
                      <tr key={`${row.model}-${row.operation}`} className="border-t border-[var(--border)]">
                        <td className="px-4 py-3 text-[var(--text-main)]">{row.model}</td>
                        <td className="px-4 py-3 text-[var(--text-muted)]">{row.operation}</td>
                        <td className="px-4 py-3 text-[var(--text-main)]">{row.calls.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[var(--text-main)]">{row.total_tokens.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[var(--text-main)]">{formatCost(row.estimated_cost)}</td>
                      </tr>
                    ))}
                    {summary.by_model.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-[var(--text-muted)]" colSpan={5}>
                          No AI usage has been recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-panel)] overflow-hidden">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <h2 className="text-sm font-semibold text-[var(--text-main)]">Recent Events</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Operation</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Tokens</th>
                      <th className="px-4 py-3">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id} className="border-t border-[var(--border)]">
                        <td className="px-4 py-3 text-[var(--text-muted)]">
                          {new Date(event.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-main)]">{event.operation}</td>
                        <td className="px-4 py-3 text-[var(--text-main)]">{event.status}</td>
                        <td className="px-4 py-3 text-[var(--text-main)]">{event.total_tokens.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[var(--text-main)]">{formatCost(event.estimated_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AuthGuard>
  );
}
