"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import React, { useMemo, useState } from "react";

export default function TopNav() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [openSettings, setOpenSettings] = useState(false);

  const envBadge = useMemo(() => {
    const v = process.env.NEXT_PUBLIC_ENV;
    return v ? v.toUpperCase() : null;
  }, []);

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
            className="ml-3 rounded-md px-2 py-1 text-[10px] font-semibold"
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
