"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScoreBadge } from "@/components/score-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { formatCurrency } from "@/lib/utils";
import type { Priority } from "@prisma/client";

export interface BoardStage {
  id: string;
  name: string;
  color: string;
  probability: number;
}

export interface BoardLead {
  id: string;
  name: string;
  companyName: string | null;
  estimatedValue: number | null;
  score: number;
  scoreGrade: "A" | "B" | "C" | "D";
  priority: Priority;
  stageId: string | null;
}

export function PipelineBoard({
  stages,
  leads,
}: {
  stages: BoardStage[];
  leads: BoardLead[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<BoardLead[]>(leads);
  const [moving, setMoving] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<string, BoardLead[]>();
    for (const s of stages) map.set(s.id, []);
    const unassigned: BoardLead[] = [];
    for (const l of items) {
      if (l.stageId && map.has(l.stageId)) map.get(l.stageId)!.push(l);
      else unassigned.push(l);
    }
    return { map, unassigned };
  }, [items, stages]);

  const stageValue = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stages) {
      const leadsHere = byStage.map.get(s.id) ?? [];
      m.set(
        s.id,
        leadsHere.reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0),
      );
    }
    return m;
  }, [byStage, stages]);

  async function move(leadId: string, stageId: string) {
    const lead = items.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const prev = items;
    setItems((cur) => cur.map((l) => (l.id === leadId ? { ...l, stageId } : l)));
    setMoving(leadId);
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      if (!res.ok) throw new Error("Failed to move lead");
      const stageName = stages.find((s) => s.id === stageId)?.name ?? "stage";
      toast.success(`Moved to ${stageName}`);
      router.refresh();
    } catch {
      setItems(prev);
      toast.error("Could not move lead");
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="-mx-2 overflow-x-auto pb-4">
      <div className="flex min-w-full gap-3 px-2">
        {stages.map((stage) => {
          const leadsHere = byStage.map.get(stage.id) ?? [];
          return (
            <div
              key={stage.id}
              className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30"
            >
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-sm font-medium">{stage.name}</span>
                  <span className="rounded-full bg-background px-1.5 text-xs text-muted-foreground tabular-nums">
                    {leadsHere.length}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatCurrency(stageValue.get(stage.id) ?? 0)}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-2">
                {leadsHere.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                    No leads here
                  </p>
                ) : (
                  leadsHere.map((lead) => (
                    <div
                      key={lead.id}
                      className="rounded-lg border bg-background p-3 shadow-sm transition-shadow hover:shadow"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-sm font-medium leading-tight hover:underline"
                        >
                          {lead.name}
                        </Link>
                        {moving === lead.id ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <ScoreBadge score={lead.score} grade={lead.scoreGrade} />
                        )}
                      </div>
                      {lead.companyName ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {lead.companyName}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <PriorityBadge priority={lead.priority} />
                        <span className="text-xs font-medium tabular-nums">
                          {formatCurrency(lead.estimatedValue)}
                        </span>
                      </div>
                      <div className="mt-2">
                        <Select
                          value={lead.stageId ?? undefined}
                          onValueChange={(v) => move(lead.id, v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Move to…" />
                          </SelectTrigger>
                          <SelectContent>
                            {stages.map((s) => (
                              <SelectItem key={s.id} value={s.id} className="text-xs">
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
