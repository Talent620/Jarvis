"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ShieldCheck, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ApprovalStatusBadge } from "@/components/status-badges";

interface ApprovalRow {
  id: string;
  type: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED";
  title: string;
  summary: string | null;
  payload: { kind?: string; subject?: string | null; body?: string; channel?: string } | null;
  decisionNote: string | null;
  createdAt: string;
  lead: { id: string; name: string; companyName: string | null } | null;
  requestedBy: { name: string | null } | null;
}

export function ApprovalsClient() {
  const [items, setItems] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"PENDING" | "HISTORY">("PENDING");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setItems(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pending = items.filter((i) => i.status === "PENDING");
  const history = items.filter((i) => i.status !== "PENDING");
  const visible = tab === "PENDING" ? pending : history;

  async function decide(id: string, status: "APPROVED" | "REJECTED") {
    setBusy(id);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, decisionNote: notes[id]?.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success(status === "APPROVED" ? "Approved" : "Rejected");
      await load();
    } catch {
      toast.error("Could not record decision");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Every AI-generated action waits here for a human decision. Nothing is sent automatically."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "PENDING" | "HISTORY")}>
        <TabsList>
          <TabsTrigger value="PENDING">
            Pending{pending.length ? ` (${pending.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="HISTORY">History</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={tab === "PENDING" ? "Queue is clear" : "No history yet"}
          description={
            tab === "PENDING"
              ? "There are no AI actions waiting for review."
              : "Approved and rejected items will appear here."
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <Card key={item.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      <ApprovalStatusBadge status={item.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.lead ? (
                        <Link
                          href={`/leads/${item.lead.id}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {item.lead.name}
                        </Link>
                      ) : (
                        "No lead"
                      )}
                      {" · "}
                      requested {formatDistanceToNow(new Date(item.createdAt), {
                        addSuffix: true,
                      })}
                      {item.requestedBy?.name ? ` by ${item.requestedBy.name}` : ""}
                    </p>
                  </div>
                </div>

                {item.payload?.subject ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Subject: </span>
                    {item.payload.subject}
                  </p>
                ) : null}
                {item.payload?.body ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {item.payload.body}
                    </p>
                  </div>
                ) : item.summary ? (
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                ) : null}

                {item.status === "PENDING" ? (
                  <div className="space-y-2">
                    <Textarea
                      value={notes[item.id] ?? ""}
                      onChange={(e) =>
                        setNotes((n) => ({ ...n, [item.id]: e.target.value }))
                      }
                      placeholder="Optional note (e.g. why you're rejecting, or an edit instruction)"
                      rows={2}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => decide(item.id, "REJECTED")}
                        disabled={busy === item.id}
                      >
                        {busy === item.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => decide(item.id, "APPROVED")}
                        disabled={busy === item.id}
                      >
                        {busy === item.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Approve
                      </Button>
                    </div>
                  </div>
                ) : item.decisionNote ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Note:</span> {item.decisionNote}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
