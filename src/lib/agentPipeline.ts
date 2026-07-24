import type { AgentPlan, PlanStep } from "./agentPlanner";
import type { RunDeps, RunResult, StepResult } from "./agentRun";
import { runPlan } from "./agentRun";

export type AgentRole = "planner" | "coder" | "tester" | "debugger" | "reviewer";

export interface PipelineEvent {
  at: number;
  role: AgentRole;
  state: "started" | "passed" | "failed" | "skipped";
  message: string;
}

export interface AgentPipelineResult {
  run: RunResult;
  events: PipelineEvent[];
  approved: boolean;
}

export function roleForStep(step: PlanStep): AgentRole {
  const text = `${step.intent} ${step.tool || ""}`.toLowerCase();
  if (/test|sprawd|build|lint|verify/.test(text)) return "tester";
  if (/debug|napraw|błąd|blad|error|diagn/.test(text)) return "debugger";
  if (/review|oceń|ocen|audyt|diff/.test(text)) return "reviewer";
  return "coder";
}

export async function runAgentPipeline(plan: AgentPlan, deps: RunDeps): Promise<AgentPipelineResult> {
  const now = deps.now || Date.now;
  const events: PipelineEvent[] = [{ at: now(), role: "planner", state: "passed", message: `Plan: ${plan.goal}` }];
  const originalOnStep = deps.onStep;
  const run = await runPlan(plan, {
    ...deps,
    onStep: async (step: StepResult) => {
      const source = plan.steps.find((item) => item.id === step.id);
      const role = source ? roleForStep(source) : "coder";
      events.push({
        at: now(),
        role,
        state: step.outcome.state === "CONFIRMED" ? "passed" : step.skipped ? "skipped" : "failed",
        message: step.intent,
      });
      await originalOnStep?.(step);
    },
  });
  const approved = run.verdict.canClaimSuccess;
  events.push({
    at: now(),
    role: "reviewer",
    state: approved ? "passed" : "failed",
    message: approved ? "Wynik i dowody zatwierdzone." : "Wynik wymaga poprawy lub potwierdzenia.",
  });
  return { run, events, approved };
}
