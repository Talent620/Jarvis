"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { LeadSource, Priority } from "@prisma/client";
import { Plus, Search, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ScoreBadge } from "@/components/score-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { SourceBadge } from "@/components/status-badges";
import { formatCurrency } from "@/lib/utils";
import { LEAD_SOURCE_LABELS, PRIORITY_LABELS } from "@/lib/constants";

interface StageOpt {
  id: string;
  name: string;
  color: string;
}

interface LeadRow {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  source: LeadSource;
  score: number;
  scoreGrade: "A" | "B" | "C" | "D";
  priority: Priority;
  estimatedValue: number | null;
  updatedAt: string;
  stage: { id: string; name: string; color: string } | null;
}

const ALL = "ALL";
type SortKey = "score" | "value" | "name" | "updated";

const SOURCES = Object.keys(LEAD_SOURCE_LABELS) as LeadSource[];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as Priority[];

const formSchema = z.object({
  name: z.string().min(2, "Contact name is required"),
  companyName: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  industry: z.string().optional(),
  source: z.nativeEnum(LeadSource),
  priority: z.nativeEnum(Priority),
  estimatedValue: z.string().optional(),
  budget: z.string().optional(),
  stageId: z.string().optional(),
  nextActionNote: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function LeadsClient({ stages }: { stages: StageOpt[] }) {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [stageId, setStageId] = useState<string>(ALL);
  const [source, setSource] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>("score");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (stageId !== ALL) params.set("stageId", stageId);
      if (source !== ALL) params.set("source", source);
      const res = await fetch(`/api/leads?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      setLeads(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, stageId, source]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const sorted = useMemo(() => {
    const copy = [...leads];
    copy.sort((a, b) => {
      if (sort === "score") return b.score - a.score;
      if (sort === "value") return (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0);
      if (sort === "name") return a.name.localeCompare(b.name);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return copy;
  }, [leads, sort]);

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="Every prospect, scored and prioritised automatically.">
        <LeadDialog
          stages={stages}
          open={dialogOpen}
          setOpen={setDialogOpen}
          onCreated={() => {
            load();
            router.refresh();
          }}
        />
      </PageHeader>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, company or email…"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 lg:flex lg:w-auto">
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger className="lg:w-40"><SelectValue placeholder="Stage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All stages</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="lg:w-40"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="lg:w-36"><SelectValue placeholder="Sort" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">Top score</SelectItem>
                <SelectItem value="value">Deal value</SelectItem>
                <SelectItem value="updated">Recent</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {error ? (
        <ErrorState onRetry={load} />
      ) : loading ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads found"
          description="Try clearing filters, or add your first lead to get started."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" /> Add lead
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden lg:table-cell">Stage</TableHead>
                <TableHead className="hidden sm:table-cell">Priority</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  <TableCell>
                    <p className="font-medium text-foreground">{lead.name}</p>
                    <p className="text-xs text-muted-foreground">{lead.companyName ?? lead.email ?? "—"}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <SourceBadge source={lead.source} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {lead.stage ? (
                      <span className="inline-flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: lead.stage.color }} />
                        {lead.stage.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <PriorityBadge priority={lead.priority} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {lead.estimatedValue ? formatCurrency(lead.estimatedValue) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ScoreBadge score={lead.score} grade={lead.scoreGrade} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function LeadDialog({
  stages,
  open,
  setOpen,
  onCreated,
}: {
  stages: StageOpt[];
  open: boolean;
  setOpen: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { source: LeadSource.OTHER, priority: Priority.MEDIUM },
  });

  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      const payload = {
        ...values,
        email: values.email || undefined,
        estimatedValue: values.estimatedValue ? Number(values.estimatedValue) : undefined,
        budget: values.budget ? Number(values.budget) : undefined,
        stageId: values.stageId || undefined,
      };
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create lead");
      toast.success("Lead added");
      reset({ source: LeadSource.OTHER, priority: Priority.MEDIUM });
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> New lead
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="name">Contact name *</Label>
              <Input id="name" {...register("name")} placeholder="Jane Doe" />
              {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Company</Label>
              <Input id="companyName" {...register("companyName")} placeholder="Acme Sp. z o.o." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" {...register("industry")} placeholder="Manufacturing" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} placeholder="jane@acme.com" />
              {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} placeholder="+48 600 000 000" />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Controller
                control={control}
                name="source"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimatedValue">Deal value</Label>
              <Input id="estimatedValue" inputMode="numeric" {...register("estimatedValue")} placeholder="15000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="budget">Budget</Label>
              <Input id="budget" inputMode="numeric" {...register("budget")} placeholder="10000" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Initial stage</Label>
              <Controller
                control={control}
                name="stageId"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="First stage (default)" /></SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="nextActionNote">Next action note</Label>
              <Textarea id="nextActionNote" {...register("nextActionNote")} placeholder="e.g. Send intro email referencing their new product line" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
