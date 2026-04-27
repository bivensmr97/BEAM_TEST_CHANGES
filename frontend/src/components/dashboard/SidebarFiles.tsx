"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

type FileSummary = {
  id: string;
  original_name: string;
  uploaded_at: string;
  status: string;
  size_bytes: number | null;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const STATUS_LABELS: Record<string, string> = {
  ready: "Ready",
  processing: "Processing…",
  error: "Error",
  pending: "Pending",
  uploaded: "Ready",
};

function friendlyStatus(status: string): string {
  return STATUS_LABELS[status?.toLowerCase()] ?? status;
}

export default function SidebarFiles({ reloadFlag }: { reloadFlag: number }) {
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const pathname = usePathname();
  const { tokens } = useAuth();

  async function loadFiles() {
    if (!tokens?.accessToken) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 🔥 TRAILING SLASH REQUIRED FOR AZURE ACA
      const res = await fetch(`${API_BASE_URL}/api/files/`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to load files: ${res.status}`);
      }

      const data = (await res.json()) as FileSummary[];
      setFiles(data);
    } catch (err: any) {
      setError(err.message || "Failed to load files");
    } finally {
      setLoading(false);
    }
  }

  async function downloadFile(file: FileSummary) {
    if (!tokens?.accessToken) {
      setError("Not authenticated");
      return;
    }

    try {
      setError(null);
      setDownloadingId(file.id);

      // 🔥 Keep consistent with ACA trailing slash behavior
      const res = await fetch(`${API_BASE_URL}/api/files/${file.id}/download/`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Download failed: ${res.status}`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = file.original_name || `file-${file.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Download failed");
    } finally {
      setDownloadingId(null);
    }
  }

  useEffect(() => {
    loadFiles();
  }, [tokens?.accessToken, reloadFlag]); // 🔥 reload on upload

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide">
          Files
        </span>
      </div>

      {loading && (
        <div className="px-4 py-2 text-xs text-(--text-muted)">
          Loading files…
        </div>
      )}

      {error && !loading && (
        <div className="px-4 py-2 text-xs text-red-500">{error}</div>
      )}

      {!loading && !error && files.length === 0 && (
        <div className="px-4 py-2 text-xs text-(--text-muted)">
          No files uploaded yet.
        </div>
      )}

      <nav className="mt-1 space-y-1 px-2 pb-4">
        {files.map((file) => {
          const href = `/dashboard/file/${file.id}`;
          const isActive = pathname === href;

          const uploaded = new Date(file.uploaded_at);
          const dateLabel = uploaded.toLocaleDateString();
          const timeLabel = uploaded.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          const isDownloading = downloadingId === file.id;

          return (
            <div
              key={file.id}
              className={[
                "group rounded-md px-2 py-2 text-sm",
                "border border-transparent",
                "hover:bg-(--bg-panel-2) hover:border-(--border)",
                "flex items-start gap-2",
                isActive
                  ? "bg-(--bg-panel-2) border-(--accent) text-(--text-main)"
                  : "text-(--text-main)",
              ].join(" ")}
            >
              <Link href={href} className="flex-1 min-w-0">
                <div className="truncate">{file.original_name}</div>
                <div className="mt-0.5 text-xs text-(--text-muted) flex justify-between">
                  <span>{friendlyStatus(file.status)}</span>
                  <span>
                    {dateLabel} • {timeLabel}
                  </span>
                </div>
              </Link>

              <button
                type="button"
                className={[
                  "shrink-0 mt-0.5",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "text-xs px-2 py-1 rounded",
                  "border border-(--border)",
                  "hover:bg-(--bg-panel)",
                  "text-(--text-main)",
                  isDownloading ? "opacity-100 cursor-wait" : "",
                ].join(" ")}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isDownloading) downloadFile(file);
                }}
                title={isDownloading ? "Downloading…" : "Download"}
                aria-label={`Download ${file.original_name}`}
                disabled={isDownloading}
              >
                {isDownloading ? "…" : "⬇"}
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
