"use client";

import React from "react";
import SidebarContent from "./SidebarContent";

export default function Sidebar({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <aside
      className={`${
        open ? "w-80" : "w-10"
      } bg-[color:var(--bg-panel)] border-r border-[var(--border)] transition-all duration-300 flex flex-col`}
    >
      {/* Toggle Button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-center border-b border-[var(--border)] text-sm font-semibold tracking-wide text-[var(--text-muted)] hover:text-[var(--text-main)]"
        type="button"
      >
        {open ? "<<" : ">>"}
      </button>

      {/* Sidebar Content (hidden when collapsed) */}
      {open && <SidebarContent />}
    </aside>
  );
}
