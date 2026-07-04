"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, isPast, isToday } from "date-fns";
import { toast } from "sonner";
import { Plus, ListChecks, Loader2, Check, Calendar } from "lucide-react";
import { Priority, TaskStatus } from "@prisma/client";
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
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PriorityBadge } from "@/components/priority-badge";
import { TaskStatusBadge } from "@/components/status-badges";
import { cn } from "@/lib/utils";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/constants";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  source: "MANUAL" | "AI" | "SYSTEM";
  dueDate: string | null;
  completedAt: string | null;
  lead: { id: string; name: string; companyName: string | null } | null;
}

const FILTERS = ["OPEN", "TODO", "IN_PROGRESS", "DONE", "ALL"] as const;
type Filter = (typeof FILTERS)[number];

export function TasksClient() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setTasks(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = tasks.filter((t) => {
    if (filter === "ALL") return true;
    if (filter === "OPEN") return t.status === "TODO" || t.status === "IN_PROGRESS";
    return t.status === filter;
  });

  async function toggleDone(task: TaskRow) {
    const next = task.status === "DONE" ? "TODO" : "DONE";
    setBusy(task.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      setTasks((cur) =>
        cur.map((t) => (t.id === task.id ? { ...t, status: next } : t)),
      );
      router.refresh();
    } catch {
      toast.error("Could not update task");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Stay on top of follow-ups and to-dos.">
        <CreateTaskDialog onCreated={load} />
      </PageHeader>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="OPEN">Open</TabsTrigger>
          <TabsTrigger value="TODO">To do</TabsTrigger>
          <TabsTrigger value="IN_PROGRESS">In progress</TabsTrigger>
          <TabsTrigger value="DONE">Done</TabsTrigger>
          <TabsTrigger value="ALL">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing here"
          description="No tasks match this filter. Create one to get started."
        />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {visible.map((task) => {
              const done = task.status === "DONE";
              const due = task.dueDate ? new Date(task.dueDate) : null;
              const overdue = due && !done && isPast(due) && !isToday(due);
              return (
                <div key={task.id} className="flex items-start gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => toggleDone(task)}
                    disabled={busy === task.id}
                    aria-label={done ? "Mark as not done" : "Mark as done"}
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                      done
                        ? "border-success bg-success text-success-foreground"
                        : "border-input hover:border-foreground",
                    )}
                  >
                    {busy === task.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : done ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          done && "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </span>
                      {task.source !== "MANUAL" ? (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          {task.source}
                        </span>
                      ) : null}
                    </div>
                    {task.description ? (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {task.lead ? (
                        <Link
                          href={`/leads/${task.lead.id}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {task.lead.name}
                        </Link>
                      ) : null}
                      {due ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            overdue && "font-medium text-destructive",
                          )}
                        >
                          <Calendar className="h-3 w-3" />
                          {format(due, "MMM d")}
                          {overdue ? " · overdue" : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                    <TaskStatusBadge status={task.status} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CreateTaskDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");

  async function submit() {
    if (title.trim().length < 2) {
      toast.error("Please enter a task title");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          dueDate: dueDate || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Task created");
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setDueDate("");
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Could not create task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" />
          New task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Follow up with…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
