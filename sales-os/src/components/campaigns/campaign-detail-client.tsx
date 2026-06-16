"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  Send,
  Sparkles,
  Plus,
  Loader2,
  MessageSquareReply,
  Trophy,
  Mail,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { CampaignChannel, CampaignStatus, ContentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CONTENT_KIND_LABELS } from "@/lib/constants";
import { pct } from "@/lib/utils";

const NONE = "NONE";

interface Opt {
  id: string;
  name: string;
}

interface MessageRow {
  id: string;
  kind: ContentKind;
  subject: string | null;
  body: string;
  isAiGenerated: boolean;
  approved: boolean;
  sentAt: string | null;
  createdAt: string;
}

interface CampaignData {
  id: string;
  name: string;
  goal: string | null;
  channel: CampaignChannel;
  status: CampaignStatus;
  sentCount: number;
  repliedCount: number;
  convertedCount: number;
  startAt: string | null;
  endAt: string | null;
  audience: { name: string } | null;
  offer: { name: string } | null;
  messages: MessageRow[];
}

const STATUSES: CampaignStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];
const CONTENT_KINDS: ContentKind[] = [
  "EMAIL",
  "DM",
  "FOLLOW_UP",
  "AD",
  "POST",
  "OFFER",
  "SUBJECT_LINE",
  "COLD_CALL_SCRIPT",
];

const STATUS_VARIANT: Record<
  CampaignStatus,
  "default" | "secondary" | "success" | "warning" | "outline"
> = {
  DRAFT: "secondary",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "default",
  ARCHIVED: "outline",
};

function label(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}

export function CampaignDetailClient({
  campaign,
  offers,
  recipientEstimate,
}: {
  campaign: CampaignData;
  offers: Opt[];
  recipientEstimate: number;
}) {
  const router = useRouter();
  const [statusBusy, setStatusBusy] = useState(false);
  const [trackBusy, setTrackBusy] = useState<string | null>(null);

  const replyRate = campaign.sentCount ? pct(campaign.repliedCount, campaign.sentCount) : 0;
  const convRate = campaign.sentCount ? pct(campaign.convertedCount, campaign.sentCount) : 0;
  const closed = campaign.status === "COMPLETED" || campaign.status === "ARCHIVED";

  async function changeStatus(status: CampaignStatus) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Status: ${label(status)}`);
      router.refresh();
    } catch {
      toast.error("Could not update status");
    } finally {
      setStatusBusy(false);
    }
  }

  async function track(event: "reply" | "conversion") {
    setTrackBusy(event);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      });
      if (!res.ok) throw new Error();
      const data: { capped?: boolean } = await res.json();
      if (data.capped) {
        toast.info(`Can't exceed ${campaign.sentCount} sent. Send the campaign to more leads first.`);
      } else {
        toast.success(event === "reply" ? "Reply recorded" : "Conversion recorded");
        router.refresh();
      }
    } catch {
      toast.error("Could not record that");
    } finally {
      setTrackBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/campaigns"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Campaigns
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight">{campaign.name}</h1>
              <Badge variant={STATUS_VARIANT[campaign.status]}>{label(campaign.status)}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {label(campaign.channel)}
              {campaign.audience ? ` · ${campaign.audience.name}` : ""}
              {campaign.offer ? ` · ${campaign.offer.name}` : ""}
            </p>
            {campaign.goal ? (
              <p className="max-w-2xl pt-1 text-sm text-muted-foreground">{campaign.goal}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Select value={campaign.status} onValueChange={(v) => changeStatus(v as CampaignStatus)} disabled={statusBusy}>
              <SelectTrigger className="w-36">
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
            <SendDialog
              campaignId={campaign.id}
              recipientEstimate={recipientEstimate}
              disabled={closed}
              onDone={() => router.refresh()}
            />
          </div>
        </div>
      </div>

      {/* Performance */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sent" value={campaign.sentCount} icon={Mail} />
        <StatCard label="Replies" value={campaign.repliedCount} icon={MessageSquareReply} hint={`${replyRate}% reply rate`} />
        <StatCard label="Conversions" value={campaign.convertedCount} icon={Trophy} hint={`${convRate}% conversion`} />
        <StatCard label="Messages" value={campaign.messages.length} icon={MessageSquareReply} />
      </div>

      {/* Quick tracking */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Log outcomes:</span>
        <Button variant="outline" size="sm" onClick={() => track("reply")} disabled={trackBusy !== null || campaign.sentCount === 0}>
          {trackBusy === "reply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareReply className="h-4 w-4" />}
          Record reply
        </Button>
        <Button variant="outline" size="sm" onClick={() => track("conversion")} disabled={trackBusy !== null || campaign.sentCount === 0}>
          {trackBusy === "conversion" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
          Record conversion
        </Button>
        {campaign.sentCount === 0 ? (
          <span className="text-xs text-muted-foreground">Send the campaign to start tracking replies.</span>
        ) : null}
      </div>

      {/* Messages */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Messages</h2>
          <div className="flex gap-2">
            <ManualMessageDialog campaignId={campaign.id} channel={campaign.channel} onDone={() => router.refresh()} />
            <GenerateMessageDialog
              campaignId={campaign.id}
              offers={offers}
              onDone={() => router.refresh()}
            />
          </div>
        </div>

        {campaign.messages.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Sparkles className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No messages yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Generate a draft with AI or add one manually, then send the campaign to your audience.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {campaign.messages.map((m) => (
              <Card key={m.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{CONTENT_KIND_LABELS[m.kind]}</span>
                    {m.isAiGenerated ? (
                      <Badge variant="secondary" className="gap-1">
                        <Sparkles className="h-3 w-3" /> AI
                      </Badge>
                    ) : null}
                    {m.sentAt ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Sent
                      </Badge>
                    ) : m.approved ? (
                      <Badge variant="outline">Ready</Badge>
                    ) : (
                      <Badge variant="warning" className="gap-1">
                        <Clock className="h-3 w-3" /> Awaiting approval
                      </Badge>
                    )}
                  </div>
                  {m.subject ? <p className="text-sm font-medium">{m.subject}</p> : null}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground line-clamp-[8]">
                    {m.body}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.sentAt
                      ? `Sent ${formatDistanceToNow(new Date(m.sentAt), { addSuffix: true })}`
                      : `Created ${formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}`}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label: lab,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{lab}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function SendDialog({
  campaignId,
  recipientEstimate,
  disabled,
  onDone,
}: {
  campaignId: string;
  recipientEstimate: number;
  disabled: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data: { recipients: number } = await res.json();
      toast.success(
        data.recipients > 0
          ? `Sent to ${data.recipients} lead${data.recipients === 1 ? "" : "s"}`
          : "No matching leads to send to yet",
      );
      setOpen(false);
      onDone();
    } catch {
      toast.error("Could not send the campaign");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Send className="mr-1.5 h-4 w-4" /> Send
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send this campaign?</DialogTitle>
          <DialogDescription>
            This will record outreach against <strong>{recipientEstimate}</strong> matching open
            lead{recipientEstimate === 1 ? "" : "s"} — logging activity, stamping approved messages
            as sent and updating your counters. No external email is sent unless a channel
            integration is connected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending}>
            {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Send now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GenerateMessageDialog({
  campaignId,
  offers,
  onDone,
}: {
  campaignId: string;
  offers: Opt[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ContentKind>("EMAIL");
  const [offerId, setOfferId] = useState(NONE);
  const [tone, setTone] = useState("");
  const [prompt, setPrompt] = useState("");
  const [createApproval, setCreateApproval] = useState(true);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generate: true,
          kind,
          offerId: offerId === NONE ? undefined : offerId,
          tone: tone.trim() || undefined,
          prompt: prompt.trim() || undefined,
          createApproval,
        }),
      });
      if (!res.ok) throw new Error();
      const data: { fallback?: boolean } = await res.json();
      toast.success(
        createApproval
          ? `Draft generated${data.fallback ? " (mock)" : ""} — sent for approval`
          : `Draft generated${data.fallback ? " (mock)" : ""}`,
      );
      setPrompt("");
      setTone("");
      setOpen(false);
      onDone();
    } catch {
      toast.error("Could not generate the message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Sparkles className="mr-1.5 h-4 w-4" /> Generate with AI
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a message</DialogTitle>
          <DialogDescription>
            AI drafts using this campaign&apos;s goal, channel and offer. Works in mock mode without
            an API key.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ContentKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CONTENT_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Offer</Label>
              <Select value={offerId} onValueChange={setOfferId}>
                <SelectTrigger>
                  <SelectValue placeholder="Campaign default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Campaign default</SelectItem>
                  {offers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-tone">Tone</Label>
            <Input
              id="g-tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="Direct, warm, consultative…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-prompt">Extra instructions</Label>
            <Textarea
              id="g-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Leave blank to use the campaign goal."
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={createApproval}
              onChange={(e) => setCreateApproval(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Send to approvals queue before it counts as ready
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualMessageDialog({
  campaignId,
  channel,
  onDone,
}: {
  campaignId: string;
  channel: CampaignChannel;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ContentKind>(channel === "EMAIL" ? "EMAIL" : "DM");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  async function submit() {
    if (body.trim().length === 0) {
      toast.error("Message body is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generate: false,
          kind,
          subject: subject.trim() || undefined,
          body: body.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Message added");
      setSubject("");
      setBody("");
      setOpen(false);
      onDone();
    } catch {
      toast.error("Could not add the message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1.5 h-4 w-4" /> Add manually
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ContentKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CONTENT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind === "EMAIL" ? (
            <div className="space-y-1.5">
              <Label htmlFor="m-subject">Subject</Label>
              <Input id="m-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="m-body">Message</Label>
            <Textarea id="m-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || body.trim().length === 0}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Add message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
