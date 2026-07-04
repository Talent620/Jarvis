"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Plus, Star, Copy, Check } from "lucide-react";
import { CampaignChannel, TemplateKind } from "@prisma/client";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";

interface TemplateRow {
  id: string;
  name: string;
  kind: TemplateKind;
  channel: CampaignChannel | null;
  subject: string | null;
  body: string;
  tags: string[];
  variables: string[];
  isFavorite: boolean;
  usageCount: number;
}

const KINDS: TemplateKind[] = [
  "EMAIL",
  "DM",
  "AD",
  "FOLLOW_UP",
  "POST",
  "OFFER",
  "SUBJECT_LINE",
];

function label(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ");
}

export function TemplatesClient() {
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/templates", { cache: "no-store" });
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

  async function copy(t: TemplateRow) {
    const text = t.subject ? `${t.subject}\n\n${t.body}` : t.body;
    await navigator.clipboard.writeText(text);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        description="Reusable, on-brand building blocks for your outreach."
      >
        <CreateTemplateDialog onCreated={load} />
      </PageHeader>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          description="Save your best-performing messages as templates to reuse them fast."
          action={<CreateTemplateDialog onCreated={load} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t.isFavorite ? (
                        <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                      ) : null}
                      <p className="truncate text-sm font-medium">{t.name}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{label(t.kind)}</Badge>
                      {t.channel ? (
                        <span className="text-xs text-muted-foreground">
                          {label(t.channel)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => copy(t)}>
                    {copiedId === t.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                {t.subject ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Subject: </span>
                    {t.subject}
                  </p>
                ) : null}
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {t.body}
                </p>
                {t.variables.length ? (
                  <div className="flex flex-wrap gap-1">
                    {t.variables.map((v) => (
                      <code
                        key={v}
                        className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {`{{${v}}}`}
                      </code>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTemplateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TemplateKind>("EMAIL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  async function submit() {
    if (name.trim().length < 2) {
      toast.error("Please enter a template name");
      return;
    }
    if (body.trim().length < 1) {
      toast.error("Template body cannot be empty");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          subject: subject.trim() || undefined,
          body: body.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Template saved");
      setName("");
      setKind("EMAIL");
      setSubject("");
      setBody("");
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Could not save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" />
          New template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Name</Label>
              <Input
                id="t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Intro email — manufacturers"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as TemplateKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {label(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-subject">Subject (optional)</Label>
            <Input
              id="t-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A quick idea for {{company}}"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-body">Body</Label>
            <Textarea
              id="t-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"Hi {{name}},\n\n…"}
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              Use {"{{name}}"}, {"{{company}}"} etc. as placeholders.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
