import {
  Crosshair,
  Quote,
  CheckCircle2,
  Circle,
  Swords,
  Clock,
  MessageCircleQuestion,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Playbook } from "@/lib/playbook";
import { cn } from "@/lib/utils";

/**
 * The lead "battle card": the best angle to hit, what's been done already,
 * and the statistically-backed next moves + objection answers. Server-rendered
 * — everything visible at a glance the moment you open the lead.
 */
export function PlaybookCard({ playbook }: { playbook: Playbook }) {
  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-primary" /> Battle card
        </CardTitle>
        <p className="text-sm text-muted-foreground">{playbook.summary}</p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-3">
        {/* Where to hit */}
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Crosshair className="h-3.5 w-3.5" /> Where to hit
          </p>
          {playbook.angles.map((a) => (
            <div
              key={a.title}
              className={cn(
                "rounded-md border p-3",
                a.power === "high"
                  ? "border-success/30 bg-success/5"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{a.title}</p>
                {a.power === "high" ? (
                  <Badge variant="outline" className="shrink-0 bg-success/10 text-success border-success/20">
                    strongest
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.detail}</p>
            </div>
          ))}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Quote className="h-3.5 w-3.5" /> Ready opener
            </p>
            <p className="mt-1.5 text-xs italic leading-relaxed text-foreground/85">{playbook.opener}</p>
          </div>
        </div>

        {/* What's done */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Where we stand
          </p>
          <ul className="space-y-2">
            {playbook.status.map((s) => (
              <li
                key={s.label}
                className="flex items-start gap-2.5 rounded-md border border-border bg-card p-2.5"
              >
                {s.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
                <span className="min-w-0">
                  <span className={cn("block text-sm", s.done ? "font-medium" : "text-muted-foreground")}>
                    {s.label}
                  </span>
                  {s.detail ? (
                    <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-1.5 rounded-md border border-warning/20 bg-warning/5 p-2.5 text-xs text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            {playbook.callWindow}
          </p>
        </div>

        {/* How to win */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            How to win them
          </p>
          <ol className="space-y-2">
            {playbook.moves.map((m, i) => (
              <li key={m.title} className="rounded-md border border-border bg-card p-3">
                <p className="text-sm font-medium">
                  <span className="mr-1.5 text-primary">{i + 1}.</span>
                  {m.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.detail}</p>
              </li>
            ))}
          </ol>
          <details className="group rounded-md border border-border bg-card">
            <summary className="flex cursor-pointer items-center gap-1.5 p-3 text-sm font-medium marker:content-none">
              <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
              Objection cheat sheet
              <span className="ml-auto text-xs text-muted-foreground group-open:hidden">show</span>
              <span className="ml-auto hidden text-xs text-muted-foreground group-open:inline">hide</span>
            </summary>
            <div className="space-y-3 border-t border-border p-3">
              {playbook.objections.map((o) => (
                <div key={o.objection}>
                  <p className="text-xs font-medium text-foreground">{o.objection}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{o.answer}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}
