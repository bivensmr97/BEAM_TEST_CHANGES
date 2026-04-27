"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiUploadFile } from "@/lib/api";
import SidebarFiles from "./SidebarFiles";

export default function SidebarContent() {
  const { tokens, loading } = useAuth();

  // Hooks MUST be at the top
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadFlag, setReloadFlag] = useState(0); // 🔥 shared reload signal

  // Authentication gating
  if (loading) {
    return (
      <div className="px-4 py-2 text-xs text-[var(--text-muted)]">
        Checking authentication...
      </div>
    );
  }

  if (!tokens?.accessToken) {
    return (
      <div className="px-4 py-2 text-xs text-red-500">
        Not authenticated
      </div>
    );
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;

    try {
      setUploading(true);
      setError(null);

      const accessToken = tokens.accessToken!;
      await apiUploadFile(accessToken, selectedFile);

      setSelectedFile(null);

      // 🔥 Trigger SidebarFiles reload
      setReloadFlag((prev) => prev + 1);

    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-6">

      {/* Upload Section */}
      <section className="border border-[var(--border)] bg-[color:var(--bg-panel)] p-4 rounded-lg">
        <h2 className="font-semibold text-[var(--text-main)] text-sm mb-2">
          Upload a File
        </h2>

        <form onSubmit={handleUpload} className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">CSV or Excel file (.xlsx), max 50 MB</span>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-[var(--text-main)] file:mr-3 file:border-0 file:bg-cyan-500 file:text-[var(--dark-text)] file:font-semibold file:rounded file:px-3 file:py-1.5 file:cursor-pointer hover:file:bg-cyan-400"
            />
          </label>

          {selectedFile && (
            <p className="text-xs text-[var(--text-muted)] truncate">
              Selected: <span className="text-[var(--text-main)]">{selectedFile.name}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-[var(--dark-text)] font-semibold rounded-md py-2 text-sm disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading…" : "Upload File"}
          </button>

          {error && (
            <p className="rounded-md border border-red-500/40 bg-red-950/20 px-2 py-1.5 text-xs text-red-300">
              {error}
            </p>
          )}
        </form>
      </section>

      {/* Sidebar File List */}
      <section>
        <SidebarFiles reloadFlag={reloadFlag} />
      </section>
    </div>
  );
}
