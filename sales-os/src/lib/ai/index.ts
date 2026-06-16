import { prisma } from "@/lib/prisma";
import type { AiActionType, AiResultStatus } from "@prisma/client";
import type { ContentKind } from "@prisma/client";
import { aiConfig, getLiveProvider } from "./adapter";
import { mockCopilot, mockGenerateContent, type MockCopilotSnapshot } from "./mock";
import {
  buildGenerationPrompt,
  companyContextBlock,
  COPILOT_SYSTEM,
  sanitize,
  type CompanyContext,
  type LeadContext,
  type OfferContext,
} from "./prompts";

export type { CompanyContext, LeadContext, OfferContext };
export type { MockCopilotSnapshot };

/** Result of a single AI generation/copilot call (pure — no persistence). */
export interface AiOutput {
  text: string;
  provider: string;
  model: string;
  fallback: boolean;
  promptKey: string;
  tokensUsed?: number;
}

interface GenerateArgs {
  kind: ContentKind;
  company: CompanyContext;
  lead?: LeadContext;
  offer?: OfferContext;
  tone?: string;
  channel?: string;
  userPrompt?: string;
}

/**
 * Generate sales content. Tries the configured live provider; on any failure
 * (or when no key is set) falls back to the deterministic mock so the product
 * always returns something usable. Pure: the caller persists + logs.
 */
export async function generateContent(args: GenerateArgs): Promise<AiOutput> {
  const { system, user, promptKey } = buildGenerationPrompt({
    kind: args.kind,
    company: args.company,
    lead: args.lead,
    offer: args.offer,
    tone: args.tone,
    channel: args.channel,
    userPrompt: args.userPrompt,
  });

  const live = getLiveProvider();
  if (live) {
    try {
      const r = await live.complete({
        system,
        messages: [{ role: "user", content: user }],
        temperature: 0.7,
        maxTokens: 900,
      });
      if (r.text) {
        return {
          text: r.text,
          provider: r.provider,
          model: r.model,
          fallback: false,
          promptKey,
          tokensUsed: r.tokensUsed,
        };
      }
    } catch (e) {
      console.error("[ai] live generation failed, using mock:", e);
    }
  }

  const text = mockGenerateContent({
    kind: args.kind,
    company: args.company,
    lead: args.lead,
    offer: args.offer,
    tone: args.tone,
    userPrompt: args.userPrompt,
  });
  return { text, provider: "mock", model: "mock", fallback: true, promptKey };
}

interface CopilotArgs {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  company: CompanyContext;
  snapshot: MockCopilotSnapshot;
}

/**
 * Answer a Copilot question, grounded in a live business snapshot so the model
 * never invents numbers. Falls back to the deterministic mock. Pure.
 */
export async function copilotReply(args: CopilotArgs): Promise<AiOutput> {
  const s = args.snapshot;
  const dataBlock = [
    "Live business snapshot (do not invent other numbers):",
    `- Total leads: ${s.totalLeads}`,
    `- Hot leads (score >= 75): ${s.hotLeads}`,
    `- Open tasks: ${s.openTasks} (overdue: ${s.overdueTasks})`,
    `- Pending AI approvals: ${s.pendingApprovals}`,
    `- Pipeline value (open): ${s.pipelineValue} ${s.currency}`,
    `- Won value: ${s.wonValue} ${s.currency}`,
    `- Reply rate: ${s.replyRate}%`,
  ].join("\n");

  const system = `${COPILOT_SYSTEM}\n\n${companyContextBlock(args.company)}\n\n${dataBlock}`;

  const live = getLiveProvider();
  if (live) {
    try {
      const r = await live.complete({
        system,
        messages: [
          ...args.history.slice(-10),
          { role: "user", content: sanitize(args.message, 2000) },
        ],
        temperature: 0.5,
        maxTokens: 700,
      });
      if (r.text) {
        return {
          text: r.text,
          provider: r.provider,
          model: r.model,
          fallback: false,
          promptKey: "copilot.query",
          tokensUsed: r.tokensUsed,
        };
      }
    } catch (e) {
      console.error("[ai] copilot live failed, using mock:", e);
    }
  }

  const text = mockCopilot(args.message, s);
  return { text, provider: "mock", model: "mock", fallback: true, promptKey: "copilot.query" };
}

/**
 * Append an entry to the AI decision/audit log. Never throws — logging must
 * not break the user-facing flow.
 */
export async function logAiDecision(input: {
  companyId: string;
  userId?: string | null;
  actionType: AiActionType;
  status: AiResultStatus;
  provider: string;
  model?: string | null;
  promptKey?: string | null;
  inputSummary?: string | null;
  output?: string | null;
  tokensUsed?: number | null;
  relatedLeadId?: string | null;
}) {
  try {
    await prisma.aiDecisionLog.create({
      data: {
        companyId: input.companyId,
        userId: input.userId ?? null,
        actionType: input.actionType,
        status: input.status,
        provider: input.provider,
        model: input.model ?? aiConfig.model,
        promptKey: input.promptKey ?? null,
        inputSummary: input.inputSummary?.slice(0, 500) ?? null,
        output: input.output?.slice(0, 4000) ?? null,
        tokensUsed: input.tokensUsed ?? null,
        relatedLeadId: input.relatedLeadId ?? null,
      },
    });
  } catch (e) {
    console.error("[ai] failed to write AiDecisionLog:", e);
  }
}
