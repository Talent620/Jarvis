"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LeadOutcome, LeadSource, Priority } from "@prisma/client";
import { RefreshCw, StickyNote, Plus, Pencil, Loader2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import {
  LEAD_SOURCE_LABELS,
  OUTCOME_LABELS,
  PRIORITY_LABELS,
} from "@/lib/constants";

interface StageOpt {
  id: string;
  name: string;
  color: string;
}

interface LeadEditable {
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  industry: string | null;
  region: string | null;
  website: string | null;
  source: LeadSource;
  priority: Priority;
  outcome: LeadOutcome;
  estimatedValue: number | null;
  budget: number | null;
  nextActionNote: string | null;
}

const SOURCES = Object.keys(LEAD_SOURCE_LABELS) as LeadSource[];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as Priority[];
const OUTCOMES = Object.keys(OUTCOME_LABELS) as LeadOutcome[];

export function LeadActions({
  leadId,
  stages,
  currentStageId,
  lead,
}: {
  leadId: string;
  stages: StageOpt[];
  currentStageId: string | null;
  draftKind?: string;
  lead: LeadEditable;
}) {
  const router = useRouter();
  const [stage, setStage] = useState(currentStageId ?? "");
  const [rescoring, setRescoring] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function changeStage(stageId: string) {
    setStage(stageId);
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Stage updated");
      router.refresh();
    } catch {
      toast.error("Could not update stage");
      setStage(currentStageId ?? "");
    }
  }

  async function rescore() {
    setRescoring(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/score`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`Rescored: ${data.score} (${data.grade})`);
      router.refresh();
    } catch {
      toast.error("Could not rescore");
    } finally {
      setRescoring(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={stage} onValueChange={changeStage}>
        <SelectTrigger className="w-44"><SelectValue placeholder="Set stage" /></SelectTrigger>
        <SelectContent>
          {stages.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button variant="outline" size="sm" onClick={rescore} disabled={rescoring}>
        {rescoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Rescore
      </Button>
      <Button variant="outline" size="sm" onClick={() => setNoteOpen(true)}>
        <StickyNote className="h-4 w-4" /> Note
      </Button>
      <Button variant="outline" size="sm" onClick={() => setTaskOpen(true)}>
        <Plus className="h-4 w-4" /> Task
      </Button>
      <Button size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="h-4 w-4" /> Edit
      </Button>

      <NoteDialog leadId={leadId} open={noteOpen} setOpen={setNoteOpen} onDone={() => router.refresh()} />
      <TaskDialog leadId={leadId} open={taskOpen} setOpen={setTaskOpen} onDone={() => router.refresh()} />
      <EditDialog leadId={leadId} lead={lead} open={editOpen} setOpen={setEditOpen} onDone={() => router.refresh()} />
    </div>
  );
}

function NoteDialog({ leadId, open, setOpen, onDone }: { leadId: string; open: boolean; setOpen: (v: boolean) => void; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (body.trim().length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, pinned }),
      });
      if (!res.ok) throw new Error();
      toast.success("Note added");
      setBody("");
      setPinned(false);
      setOpen(false);
      onDone();
    } catch {
      toast.error("Could not save note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add a note</DialogTitle></DialogHeader>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="What happened / what to remember…" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Pin to top
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !body.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({ leadId, open, setOpen, onDone }: { leadId: string; open: boolean; setOpen: (v: boolean) => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (title.trim().length < 2) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          priority,
          dueDate: dueDate || undefined,
          leadId,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Task created");
      setTitle("");
      setDescription("");
      setDueDate("");
      setOpen(false);
      onDone();
    } catch {
      toast.error("Could not create task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-title">Title</Label>
            <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up by email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Description</Label>
            <Textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-due">Due date</Label>
              <Input id="t-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || title.trim().length < 2}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  leadId,
  lead,
  open,
  setOpen,
  onDone,
}: {
  leadId: string;
  lead: LeadEditable;
  open: boolean;
  setOpen: (v: boolean) => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: lead.name,
    companyName: lead.companyName ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    position: lead.position ?? "",
    industry: lead.industry ?? "",
    region: lead.region ?? "",
    website: lead.website ?? "",
    source: lead.source,
    priority: lead.priority,
    outcome: lead.outcome,
    estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "",
    budget: lead.budget ? String(lead.budget) : "",
    nextActionNote: lead.nextActionNote ?? "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        companyName: form.companyName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        position: form.position || undefined,
        industry: form.industry || undefined,
        region: form.region || undefined,
        website: form.website || undefined,
        source: form.source,
        priority: form.priority,
        outcome: form.outcome,
        estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
        budget: form.budget ? Number(form.budget) : undefined,
        nextActionNote: form.nextActionNote || undefined,
      };
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast.success("Lead updated");
      setOpen(false);
      onDone();
    } catch {
      toast.error("Could not update lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit lead</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <Field label="Company"><Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} /></Field>
          <Field label="Position"><Input value={form.position} onChange={(e) => set("position", e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Industry"><Input value={form.industry} onChange={(e) => set("industry", e.target.value)} /></Field>
          <Field label="Region"><Input value={form.region} onChange={(e) => set("region", e.target.value)} /></Field>
          <Field label="Website" full><Input value={form.website} onChange={(e) => set("website", e.target.value)} /></Field>
          <Field label="Source">
            <Select value={form.source} onValueChange={(v) => set("source", v as LeadSource)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onValueChange={(v) => set("priority", v as Priority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Outcome">
            <Select value={form.outcome} onValueChange={(v) => set("outcome", v as LeadOutcome)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o} value={o}>{OUTCOME_LABELS[o]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Deal value"><Input inputMode="numeric" value={form.estimatedValue} onChange={(e) => set("estimatedValue", e.target.value)} /></Field>
          <Field label="Budget"><Input inputMode="numeric" value={form.budget} onChange={(e) => set("budget", e.target.value)} /></Field>
          <Field label="Next action note" full>
            <Textarea value={form.nextActionNote} onChange={(e) => set("nextActionNote", e.target.value)} rows={2} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || form.name.trim().length < 2}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`${full ? "col-span-2" : ""} space-y-1.5`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
