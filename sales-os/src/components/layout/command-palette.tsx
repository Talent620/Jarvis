"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Phone, Search, User } from "lucide-react";
import type { ScoreGrade } from "@prisma/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScoreBadge } from "@/components/score-badge";
import { NAV_FLAT } from "./nav-config";
import { cn } from "@/lib/utils";

interface LeadHit {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  score: number;
  scoreGrade: ScoreGrade;
  hasWebsite: boolean | null;
}

interface Item {
  key: string;
  kind: "page" | "lead";
  label: string;
  hint?: string | null;
  href: string;
  lead?: LeadHit;
}

/**
 * Global quick-switcher: ⌘K / Ctrl+K from anywhere. Jumps to any page and
 * finds any lead by name, company, phone or email — the "never use the mouse"
 * feature that makes the tool feel instant.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<LeadHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Open with ⌘K / Ctrl+K, close with Esc (Dialog handles Esc itself).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setLeads([]);
      setActive(0);
    } else {
      // Focus after the dialog mounts.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced lead search.
  useEffect(() => {
    if (query.trim().length < 2) {
      setLeads([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { leads: LeadHit[] };
          setLeads(data.leads);
        }
      } catch {
        /* aborted or offline — keep previous results */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: Item[] = NAV_FLAT.filter(
      (n) => !q || n.label.toLowerCase().includes(q),
    ).map((n) => ({ key: `p:${n.href}`, kind: "page", label: n.label, href: n.href }));
    const leadItems: Item[] = leads.map((l) => ({
      key: `l:${l.id}`,
      kind: "lead",
      label: l.name,
      hint: [l.companyName, l.phone ?? l.email].filter(Boolean).join(" · ") || null,
      href: `/leads/${l.id}`,
      lead: l,
    }));
    // With a query, leads first (that's what you're hunting for).
    return q ? [...leadItems, ...pages.slice(0, 4)] : pages;
  }, [query, leads]);

  useEffect(() => setActive(0), [items.length, query]);

  const go = useCallback(
    (item: Item) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      go(items[active]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[18%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4">
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search leads by name, company, phone… or jump to a page"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {query.trim().length >= 2 && !loading ? "No matches." : "Type to search…"}
            </p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm",
                  i === active ? "bg-secondary text-foreground" : "text-foreground/90",
                )}
              >
                {item.kind === "lead" ? (
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.label}</span>
                  {item.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                  ) : null}
                </span>
                {item.lead ? (
                  <span className="flex shrink-0 items-center gap-2">
                    {item.lead.phone ? <Phone className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    <ScoreBadge score={item.lead.score} grade={item.lead.scoreGrade} />
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">Page</span>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Topbar trigger that opens the palette (also bound to ⌘K / Ctrl+K). */
export function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
      }
      className="hidden h-9 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted sm:flex sm:w-56 lg:w-72"
      aria-label="Search"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px]">
        Ctrl K
      </kbd>
    </button>
  );
}
