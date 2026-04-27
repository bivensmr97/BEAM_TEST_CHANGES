"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import React, { useEffect, useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type AISettings = {
  tenant_ai_enabled: boolean;
  user_ai_enabled: boolean;
  effective_ai_enabled: boolean;
};

export default function TopNav() {
  const { user, tokens, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [openSettings, setOpenSettings] = useState(false);
  const [aiSettings, setAiSettings] = useState<AISettings | null>(null);
  const [aiSettingsError, setAiSettingsError] = useState<string | null>(null);
  const [savingAISettings, setSavingAISettings] = useState(false);

  const envBadge = useMemo(() => {
    const v = process.env.NEXT_PUBLIC_ENV;
    return v ? v.toUpperCase() : null;
  }, []);

  useEffect(() => {
    if (!openSettings || !tokens.accessToken) return;

    async function loadAISettings() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/ai-settings`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!res.ok) throw new Error("Could not load AI settings");
        setAiSettings((await res.json()) as AISettings);
        setAiSettingsError(null);
      } catch (err) {
        setAiSettingsError(err instanceof Error ? err.message : "Could not load AI settings");
      }
    }

    loadAISettings();
  }, [openSettings, tokens.accessToken]);

  async function updateAISetting(scope: "me" | "tenant", aiEnabled: boolean) {
    if (!tokens.accessToken) return;
    setSavingAISettings(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai-settings/${scope}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ai_enabled: aiEnabled }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Could not update AI settings");
      }
      setAiSettings((await res.json()) as AISettings);
      setAiSettingsError(null);
    } catch (err) {
      setAiSettingsError(err instanceof Error ? err.message : "Could not update AI settings");
    } finally {
      setSavingAISettings(false);
    }
  }

  return (
    <header
      className="flex w-full items-center justify-between px-6 py-4"
      style={{
        background: "var(--header-bg)",
        borderBottom: `4px solid var(--header-border)`,
        color: "var(--header-text)",
      }}
    >
      {/* Left: favicon + titles */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg flex items-center justify-center"
             style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)" }}>
          <Image src="/favicon.png" alt="BEAM" width={20} height={20} priority />
        </div>

        <div className="leading-tight">
          <div className="font-semibold" style={{ fontSize: "1.15rem" }}>
            BEAM Analytics
          </div>
          <div className="text-xs" style={{ opacity: 0.8 }}>
            Data Quality Platform
          </div>
        </div>

        {envBadge && (
          <span
            className="ml-3 rounded-md px-2 py-1 text-xs font-semibold"
            style={{
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(0,0,0,0.15)",
            }}
          >
            {envBadge}
          </span>
        )}
      </div>

      {/* Right: user + settings + logout */}
      <div className="flex items-center gap-4 text-sm relative">
        {user && (
          <>
            <div className="text-right">
              <div className="font-medium">{user.email}</div>
            </div>

            {/* Settings button */}
            <button
              type="button"
              onClick={() => setOpenSettings((v) => !v)}
              className="rounded-md px-3 py-2 text-xs font-medium"
              style={{
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(0,0,0,0.15)",
              }}
              aria-label="Settings"
            >
              ⚙
            </button>

            {/* Settings dropdown */}
            {openSettings && (
              <div
                className="absolute right-14 top-12 w-56 p-3 rounded-xl"
                style={{
                  background: "var(--bg-panel)",
                  color: "var(--text-main)",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow)",
                }}
              >
                <div className="text-sm font-semibold mb-2">Settings</div>

                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                  Theme
                </label>
                <select
                  className="w-full rounded-md px-2 py-2 text-sm"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as "light" | "dark")}
                  style={{
                    background: "var(--bg-panel-2)",
                    color: "var(--text-main)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>

                <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-2 text-xs font-semibold" style={{ color: "var(--text-main)" }}>
                    AI access
                  </div>

                  {user.role === "admin" && (
                    <label className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <span style={{ color: "var(--text-muted)" }}>Tenant AI</span>
                      <input
                        type="checkbox"
                        checked={aiSettings?.tenant_ai_enabled ?? true}
                        disabled={savingAISettings || !aiSettings}
                        onChange={(e) => updateAISetting("tenant", e.target.checked)}
                      />
                    </label>
                  )}

                  <label className="flex items-center justify-between gap-3 text-xs">
                    <span style={{ color: "var(--text-muted)" }}>My AI</span>
                    <input
                      type="checkbox"
                      checked={aiSettings?.user_ai_enabled ?? true}
                      disabled={savingAISettings || !aiSettings}
                      onChange={(e) => updateAISetting("me", e.target.checked)}
                    />
                  </label>

                  {aiSettings && !aiSettings.effective_ai_enabled && (
                    <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      AI summaries are currently disabled for this account.
                    </p>
                  )}

                  {aiSettingsError && (
                    <p className="mt-2 text-xs text-red-400">{aiSettingsError}</p>
                  )}
                </div>

                {user.role === "admin" && (
                  <Link
                    href="/dashboard/admin/llm-usage"
                    onClick={() => setOpenSettings(false)}
                    className="mt-3 block w-full rounded-md px-3 py-2 text-xs font-medium text-center"
                    style={{
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-main)",
                    }}
                  >
                    AI Usage
                  </Link>
                )}

                <button
                  type="button"
                  onClick={() => setOpenSettings(false)}
                  className="mt-3 w-full rounded-md px-3 py-2 text-xs font-medium"
                  style={{
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-main)",
                  }}
                >
                  Close
                </button>
              </div>
            )}

            <button
              onClick={logout}
              className="rounded-md px-3 py-2 text-xs font-medium"
              style={{
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(0,0,0,0.15)",
              }}
            >
              Logout
            </button>
          </>
        )}
      </div>
    </header>
  );
}
