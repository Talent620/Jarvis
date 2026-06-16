"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Send, Loader2, User, ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

type CopilotAction =
  | { kind: "navigate"; label: string; href: string }
  | {
      kind: "createTask";
      label: string;
      title: string;
      leadId?: string;
      priority?: string;
      dueInDays?: number;
    };

const SUGGESTIONS = [
  "What should I focus on today?",
  "Summarise the state of the business.",
  "How can I improve my funnel?",
  "Which leads are most at risk of going cold?",
];

export function CopilotClient({ greeting }: { greeting: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: greeting },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState<CopilotAction[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [provider, setProvider] = useState<{ name: string; fallback: boolean } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = messages
      .filter((_, i) => i > 0)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setInput("");
    setActions([]);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });
      if (!res.ok) throw new Error();
      const data: {
        reply: string;
        provider: string;
        fallback: boolean;
        actions?: CopilotAction[];
      } = await res.json();
      setProvider({ name: data.provider, fallback: data.fallback });
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      setActions(data.actions ?? []);
    } catch {
      toast.error("Copilot is unavailable right now.");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Sorry — I couldn't process that. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: CopilotAction) {
    if (action.kind === "navigate") {
      router.push(action.href);
      return;
    }
    // createTask
    setBusyAction(action.label);
    try {
      const dueDate = action.dueInDays
        ? new Date(Date.now() + action.dueInDays * 86_400_000).toISOString()
        : undefined;
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: action.title,
          priority: action.priority,
          leadId: action.leadId,
          dueDate,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Task created");
      setActions((cur) => cur.filter((a) => a.label !== action.label));
    } catch {
      toast.error("Could not create the task");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <Card className="flex h-[calc(100vh-12rem)] min-h-[28rem] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </span>
          <div>
            <p className="text-sm font-medium leading-none">Sales Copilot</p>
            <p className="text-xs text-muted-foreground">
              Grounded in your live pipeline data
            </p>
          </div>
        </div>
        {provider ? (
          <Badge variant={provider.fallback ? "warning" : "success"}>
            {provider.fallback ? "mock" : provider.name}
          </Badge>
        ) : null}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 scroll-thin">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                m.role === "user" ? "bg-secondary" : "bg-primary/10",
              )}
            >
              {m.role === "user" ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              )}
            </span>
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted",
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}

        {loading ? (
          <div className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </span>
            <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        ) : null}

        {actions.length > 0 && !loading ? (
          <div className="space-y-2 pt-1">
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Suggested actions
            </p>
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => runAction(a)}
                  disabled={busyAction === a.label}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {busyAction === a.label ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : a.kind === "createTask" ? (
                    <Plus className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 text-primary" />
                  )}
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.length === 1 && !loading ? (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about your pipeline, leads, or what to do next…"
            rows={1}
            className="max-h-32 min-h-[2.5rem] resize-none"
          />
          <Button
            size="icon"
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Works without an API key (mock mode). Add credentials in Settings for live AI.
        </p>
      </div>
    </Card>
  );
}
