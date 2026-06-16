"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles, Loader2, Copy, Check, ArrowRight, Wand2 } from "lucide-react";
import { CampaignChannel, ContentKind } from "@prisma/client";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CONTENT_KIND_LABELS } from "@/lib/constants";

interface Opt {
  id: string;
  name: string;
  companyName?: string | null;
}

interface GenResult {
  content: string;
  subject: string | null;
  body: string;
  provider: string;
  fallback: boolean;
  messageId: string | null;
  approvalId: string | null;
}

const NONE = "NONE";
const TONES = ["Professional", "Warm", "Direct", "Consultative", "Playful"];
const CHANNELS: CampaignChannel[] = [
  "EMAIL",
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "COLD_CALL",
  "MULTI",
];

export function GeneratorClient({
  leads,
  offers,
  defaultLeadId,
  defaultKind,
}: {
  leads: Opt[];
  offers: Opt[];
  defaultLeadId?: string;
  defaultKind?: ContentKind;
}) {
  const [kind, setKind] = useState<ContentKind>(defaultKind ?? "EMAIL");
  const [leadId, setLeadId] = useState<string>(defaultLeadId ?? NONE);
  const [offerId, setOfferId] = useState<string>(NONE);
  const [tone, setTone] = useState<string>("Professional");
  const [channel, setChannel] = useState<CampaignChannel>("EMAIL");
  const [prompt, setPrompt] = useState("");
  const [createApproval, setCreateApproval] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          leadId: leadId === NONE ? undefined : leadId,
          offerId: offerId === NONE ? undefined : offerId,
          tone,
          channel,
          prompt: prompt.trim() || undefined,
          createApproval,
        }),
      });
      if (!res.ok) throw new Error();
      const data: GenResult = await res.json();
      setResult(data);
      if (data.fallback) {
        toast.info("Generated with the built-in mock engine (no API key set).");
      } else {
        toast.success("Draft generated");
      }
    } catch {
      toast.error("Generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    const text = result.subject
      ? `${result.subject}\n\n${result.body}`
      : result.content;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4 text-primary" />
            Compose
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Content type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ContentKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONTENT_KIND_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>For lead</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger>
                <SelectValue placeholder="No specific lead" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No specific lead</SelectItem>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                    {l.companyName ? ` · ${l.companyName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Offer</Label>
            <Select value={offerId} onValueChange={setOfferId}>
              <SelectTrigger>
                <SelectValue placeholder="No offer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No offer</SelectItem>
                {offers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as CampaignChannel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.charAt(0) + c.slice(1).toLowerCase().replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gen-prompt">Extra instructions</Label>
            <Textarea
              id="gen-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. mention our trade-fair experience and keep it under 120 words"
              rows={4}
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 p-3">
            <input
              type="checkbox"
              checked={createApproval}
              onChange={(e) => setCreateApproval(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-sm">
              <span className="font-medium">Send to approval queue</span>
              <span className="block text-xs text-muted-foreground">
                Nothing is sent automatically — a human reviews every AI draft.
              </span>
            </span>
          </label>

          <Button onClick={generate} disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            Generate draft
          </Button>
        </CardContent>
      </Card>

      <Card className="min-h-[24rem]">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Result</CardTitle>
          {result ? (
            <div className="flex items-center gap-2">
              <Badge variant={result.fallback ? "warning" : "success"}>
                {result.fallback ? "mock" : result.provider}
              </Badge>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                )}
                Copy
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Drafting your {CONTENT_KIND_LABELS[kind].toLowerCase()}…</p>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {result.subject ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Subject
                  </p>
                  <p className="mt-1 font-medium">{result.subject}</p>
                </div>
              ) : null}
              <div>
                {result.subject ? (
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Body
                  </p>
                ) : null}
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                  {result.body}
                </p>
              </div>
              {result.approvalId ? (
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">
                    Added to the approval queue for review.
                  </p>
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/approvals">
                      Review
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Sparkles className="h-7 w-7 opacity-40" />
              <p className="text-sm">
                Configure the options and generate a draft.
                <br />
                Works out of the box — no API key required.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
