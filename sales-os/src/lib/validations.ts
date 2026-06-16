import {
  ApprovalStatus,
  CallStatus,
  CampaignChannel,
  CampaignStatus,
  ContentKind,
  LeadOutcome,
  LeadSource,
  Priority,
  SocialChannel,
  TaskStatus,
  TemplateKind,
} from "@prisma/client";
import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  companyName: z.string().trim().min(2, "Enter your company name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(72),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2, "Contact name is required").max(120),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: optionalString,
  position: optionalString,
  companyName: optionalString,
  website: optionalString,
  industry: optionalString,
  region: optionalString,
  source: z.nativeEnum(LeadSource).default(LeadSource.OTHER),
  sourceDetail: optionalString,
  budget: z.coerce.number().int().min(0).max(100_000_000).optional(),
  estimatedValue: z.coerce.number().int().min(0).max(100_000_000).optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  outcome: z.nativeEnum(LeadOutcome).default(LeadOutcome.OPEN),
  stageId: z.string().cuid().optional(),
  tags: z.array(z.string().trim().min(1)).max(12).default([]),
  expectedCloseAt: z.coerce.date().optional(),
  nextActionNote: optionalString,
});
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = leadCreateSchema.partial();

export const noteCreateSchema = z.object({
  body: z.string().trim().min(1, "Note can't be empty").max(5000),
  pinned: z.boolean().default(false),
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(2, "Task title is required").max(160),
  description: optionalString,
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
  dueDate: z.coerce.date().optional(),
  leadId: z.string().cuid().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  description: optionalString,
  priority: z.nativeEnum(Priority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  dueDate: z.coerce.date().optional().nullable(),
});

export const templateCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.nativeEnum(TemplateKind).default(TemplateKind.EMAIL),
  channel: z.nativeEnum(CampaignChannel).optional(),
  subject: optionalString,
  body: z.string().trim().min(1).max(8000),
  tags: z.array(z.string().trim()).max(12).default([]),
  variables: z.array(z.string().trim()).max(20).default([]),
});

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  goal: optionalString,
  channel: z.nativeEnum(CampaignChannel).default(CampaignChannel.EMAIL),
  status: z.nativeEnum(CampaignStatus).default(CampaignStatus.DRAFT),
  audienceId: z.string().cuid().optional(),
  offerId: z.string().cuid().optional(),
});

export const approvalDecisionSchema = z.object({
  status: z.enum([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED]),
  decisionNote: optionalString,
});

export const stageUpdateSchema = z.object({
  stageId: z.string().cuid(),
});

export const aiGenerateSchema = z.object({
  kind: z.nativeEnum(ContentKind),
  prompt: z.string().trim().max(2000).optional(),
  leadId: z.string().cuid().optional(),
  offerId: z.string().cuid().optional(),
  audienceId: z.string().cuid().optional(),
  tone: z.string().trim().max(60).optional(),
  channel: z.nativeEnum(CampaignChannel).optional(),
  createApproval: z.boolean().default(true),
});
export type AiGenerateInput = z.infer<typeof aiGenerateSchema>;

export const copilotSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .default([]),
});

export const campaignUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  goal: optionalString,
  channel: z.nativeEnum(CampaignChannel).optional(),
  status: z.nativeEnum(CampaignStatus).optional(),
  audienceId: z.string().cuid().optional().nullable(),
  offerId: z.string().cuid().optional().nullable(),
});

export const campaignMessageCreateSchema = z
  .object({
    generate: z.boolean().default(false),
    kind: z.nativeEnum(ContentKind).default(ContentKind.EMAIL),
    subject: optionalString,
    body: z.string().trim().max(8000).optional(),
    prompt: z.string().trim().max(2000).optional(),
    tone: z.string().trim().max(60).optional(),
    offerId: z.string().cuid().optional(),
    createApproval: z.boolean().default(false),
  })
  .refine((d) => d.generate || (!!d.body && d.body.trim().length > 0), {
    message: "Message body is required",
    path: ["body"],
  });
export type CampaignMessageCreateInput = z.infer<typeof campaignMessageCreateSchema>;

export const campaignTrackSchema = z.object({
  event: z.enum(["reply", "conversion"]),
});

export const discoverSchema = z.object({
  audienceId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type DiscoverInput = z.infer<typeof discoverSchema>;

export const inboundConfigSchema = z.object({
  autoDraft: z.boolean(),
});

/** Minimal validation for the public capture endpoint (kept permissive). */
export const publicLeadSchema = z
  .object({
    name: optionalString,
    email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
    phone: optionalString,
    companyName: optionalString,
    position: optionalString,
    website: optionalString,
    industry: optionalString,
    region: optionalString,
    message: z.string().trim().max(4000).optional(),
    sourceDetail: optionalString,
  })
  .refine((d) => !!(d.name || d.email || d.phone), {
    message: "Provide at least a name, email or phone",
  });
export type PublicLeadInput = z.infer<typeof publicLeadSchema>;

// ----------------------- Acquisition Autopilot ---------------------

export const acquisitionSettingsSchema = z
  .object({
    enabled: z.boolean(),
    cadenceMinutes: z.coerce.number().int().min(5).max(1440),
    dailyLeadCap: z.coerce.number().int().min(0).max(1000),
    targetPerDay: z.coerce.number().int().min(0).max(1000),
    perRunBatch: z.coerce.number().int().min(1).max(100),
    autoDraftInbound: z.boolean(),
    autoDraftOutbound: z.boolean(),
    autoEnroll: z.boolean(),
    enrichLeads: z.boolean(),
    minScoreToDraft: z.coerce.number().int().min(0).max(100),
    channels: z.array(z.nativeEnum(CampaignChannel)).max(6),
    quietHoursStart: z.coerce.number().int().min(0).max(23).nullable(),
    quietHoursEnd: z.coerce.number().int().min(0).max(23).nullable(),
    prospectingEnabled: z.boolean(),
    prospectingQueries: z.array(z.string().trim().min(3).max(120)).max(20),
    prospectingNoWebsiteOnly: z.boolean(),
    auditWebsites: z.boolean(),
    autoSendEmails: z.boolean(),
    dailyEmailCap: z.coerce.number().int().min(0).max(500),
  })
  .partial();
export type AcquisitionSettingsInput = z.infer<typeof acquisitionSettingsSchema>;

// ----------------------- Lead Finder (prospecting) -----------------

export const prospectingSearchSchema = z.object({
  category: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(25).default(15),
  noWebsiteOnly: z.boolean().default(false),
});
export type ProspectingSearchInput = z.infer<typeof prospectingSearchSchema>;

const businessCandidateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().toLowerCase().email().nullish().or(z.literal("").transform(() => null)),
  website: z.string().trim().max(300).nullish(),
  hasWebsite: z.boolean(),
  address: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(80).nullish(),
  category: z.string().trim().max(120).nullish(),
  rating: z.coerce.number().min(0).max(5).nullish(),
  reviewCount: z.coerce.number().int().min(0).nullish(),
  mapsUrl: z.string().trim().max(500).nullish(),
  nip: z.string().trim().max(20).nullish(),
  registeredAt: z.string().trim().max(30).nullish(),
  signals: z.array(z.string().max(160)).max(10).default([]),
  source: z.nativeEnum(LeadSource).default(LeadSource.GOOGLE_MAPS),
  sourceDetail: z.string().trim().max(80).default("Lead Finder"),
});

export const prospectingImportSchema = z.object({
  candidates: z.array(businessCandidateSchema).min(1).max(50),
  autoDraft: z.boolean().default(false),
  autoAudit: z.boolean().default(true),
});
export type ProspectingImportInput = z.infer<typeof prospectingImportSchema>;

// ----------------------------- Calls -------------------------------

export const callLogCreateSchema = z.object({
  status: z.nativeEnum(CallStatus),
  note: z.string().trim().max(4000).optional(),
  durationSec: z.coerce.number().int().min(0).max(86_400).optional(),
  nextCallAt: z.coerce.date().optional().nullable(),
});
export type CallLogCreateInput = z.infer<typeof callLogCreateSchema>;

// ----------------------------- Social ------------------------------

export const socialGenerateSchema = z.object({
  channel: z.nativeEnum(SocialChannel),
  kind: z.enum([ContentKind.AD, ContentKind.POST]).default(ContentKind.POST),
  topic: z.string().trim().min(3).max(600),
  offerId: z.string().cuid().optional().nullable(),
  link: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
});
export type SocialGenerateInput = z.infer<typeof socialGenerateSchema>;

export const socialPostUpdateSchema = z.object({
  title: z.string().trim().max(160).optional().nullable(),
  body: z.string().trim().min(1).max(5000).optional(),
  cta: z.string().trim().max(80).optional().nullable(),
  link: z.string().trim().max(300).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  hashtags: z.array(z.string().trim().max(60)).max(15).optional(),
  scheduledAt: z.coerce.date().optional().nullable(),
});
export type SocialPostUpdateInput = z.infer<typeof socialPostUpdateSchema>;

export const sequenceStepSchema = z.object({
  order: z.coerce.number().int().min(1).max(50),
  dayOffset: z.coerce.number().int().min(0).max(120),
  channel: z.nativeEnum(CampaignChannel).default(CampaignChannel.EMAIL),
  kind: z.nativeEnum(ContentKind).default(ContentKind.EMAIL),
  name: z.string().trim().min(2).max(120),
  prompt: z.string().trim().max(2000).optional(),
});

export const sequenceCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: optionalString,
  channel: z.nativeEnum(CampaignChannel).default(CampaignChannel.MULTI),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  audienceId: z.string().cuid().optional().nullable(),
  offerId: z.string().cuid().optional().nullable(),
  steps: z.array(sequenceStepSchema).min(1).max(20).optional(),
});
export type SequenceCreateInput = z.infer<typeof sequenceCreateSchema>;

export const sequenceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: optionalString,
  channel: z.nativeEnum(CampaignChannel).optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  audienceId: z.string().cuid().optional().nullable(),
  offerId: z.string().cuid().optional().nullable(),
});

export const enrollSchema = z.object({
  leadId: z.string().cuid().optional(),
  /** When true (and no leadId), enroll all eligible outbound leads. */
  eligible: z.boolean().default(false),
  max: z.coerce.number().int().min(1).max(200).optional(),
});

export const autopilotRunSchema = z.object({}).optional();
