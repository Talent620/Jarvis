"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { SidebarNav } from "./sidebar";

export function MobileNav() {
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);

  return (
    <div className={cn("lg:hidden", open ? "" : "pointer-events-none")} aria-hidden={!open}>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-background/70 backdrop-blur-sm transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={() => setOpen(false)}
      />
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-card transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-3 top-4 rounded-md p-1 text-muted-foreground hover:bg-secondary"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </div>
    </div>
  );
}
