"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Megaphone, Loader2, Plus } from "lucide-react";
import { CampaignChannel, CampaignStatus } from "@prisma/client";
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
import { pct } from "@/lib/utils";

interface Opt {
  id: string;
  name: string;
}

interface CampaignRow {
  id: string;
  name: string;
  goal: string | null;
  channel: CampaignChannel;
  status: CampaignStatus;
  sentCount: number;
  repliedCount: number;
  convertedCount: number;
  audience: { name: string } | null;
  offer: { name: string } | null;
  _count: { messages: number };
}

const NONE = "NONE";
const CHANNELS: CampaignChannel[] = [
  "EMAIL",
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "COLD_CALL",
  "MULTI",
];
const STATUSES: CampaignStatus[] = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "ARCHIVED",
];

const STATUS_VARIANT: Record<CampaignStatus, "default" | "secondary" | "success" | "warning" | "outline"> = {
  DRAFT: "secondary",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "default",
  ARCHIVED: "outline",
};

function label(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ");
}

export function CampaignsClient({
  audiences,
  offers,
}: {
  audiences: Opt[];
  offers: Opt[];
}) {
  const [items, setItems] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" });
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Group your outreach into measurable plays."
      >
        <CreateCampaignDialog audiences={audiences} offers={offers} onCreated={load} />
      </PageHeader>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Create your first campaign to organise outreach and track replies."
          action={
            <CreateCampaignDialog
              audiences={audiences}
              offers={offers}
              onCreated={load}
            />
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {label(c.channel)}
                        {c.audience ? ` · ${c.audience.name}` : ""}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[c.status]}>{label(c.status)}</Badge>
                  </div>
                  {c.goal ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{c.goal}</p>
                  ) : null}
                  <div className="grid grid-cols-4 gap-2 border-t pt-3 text-center">
                    <Stat label="Drafts" value={c._count.messages} />
                    <Stat label="Sent" value={c.sentCount} />
                    <Stat label="Replied" value={c.repliedCount} />
                    <Stat
                      label="Reply %"
                      value={c.sentCount ? `${pct(c.repliedCount, c.sentCount)}%` : "—"}
                    />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="font-display text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function CreateCampaignDialog({
  audiences,
  offers,
  onCreated,
}: {
  audiences: Opt[];
  offers: Opt[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [channel, setChannel] = useState<CampaignChannel>("EMAIL");
  const [status, setStatus] = useState<CampaignStatus>("DRAFT");
  const [audienceId, setAudienceId] = useState(NONE);
  const [offerId, setOfferId] = useState(NONE);

  async function submit() {
    if (name.trim().length < 2) {
      toast.error("Please enter a campaign name");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          goal: goal.trim() || undefined,
          channel,
          status,
          audienceId: audienceId === NONE ? undefined : audienceId,
          offerId: offerId === NONE ? undefined : offerId,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Campaign created");
      setName("");
      setGoal("");
      setChannel("EMAIL");
      setStatus("DRAFT");
      setAudienceId(NONE);
      setOfferId(NONE);
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Could not create campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" />
          New campaign
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 manufacturing outreach"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-goal">Goal</Label>
            <Textarea
              id="c-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Book 10 discovery calls with mid-size manufacturers"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as CampaignChannel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {label(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as CampaignStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {label(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Audience</Label>
              <Select value={audienceId} onValueChange={setAudienceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {audiences.map((au) => (
                    <SelectItem key={au.id} value={au.id}>
                      {au.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Offer</Label>
              <Select value={offerId} onValueChange={setOfferId}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {offers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
