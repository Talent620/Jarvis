import {
  ApprovalStatus,
  CallStatus,
  ContentKind,
  LeadOutcome,
  LeadSource,
  Priority,
  ScoreGrade,
  SocialChannel,
  SocialPostStatus,
  TaskStatus,
} from "@prisma/client";

/** Default pipeline created for every new company. */
export const DEFAULT_FUNNEL_STAGES = [
  { name: "New", order: 1, probability: 0.05, color: "#94a3b8" },
  { name: "Contacted", order: 2, probability: 0.15, color: "#0ea5e9" },
  { name: "Qualified", order: 3, probability: 0.35, color: "#6366f1" },
  { name: "Proposal", order: 4, probability: 0.55, color: "#a855f7" },
  { name: "Negotiation", order: 5, probability: 0.75, color: "#f59e0b" },
  { name: "Won", order: 6, probability: 1, color: "#16a34a", isWon: true },
  { name: "Lost", order: 7, probability: 0, color: "#ef4444", isLost: true },
] as const;

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  WEBSITE: "Website",
  INBOUND_FORM: "Inbound form",
  REFERRAL: "Referral",
  LINKEDIN: "LinkedIn",
  FACEBOOK_GROUP: "Facebook group",
  MARKETPLACE: "Marketplace",
  COLD_OUTREACH: "Cold outreach",
  EVENT: "Event",
  ADS: "Ads",
  GOOGLE_MAPS: "Google Maps",
  BUSINESS_REGISTRY: "Business registry",
  OTHER: "Other",
};

export const CALL_STATUS_META: Record<
  CallStatus,
  { label: string; className: string }
> = {
  NOT_CALLED: { label: "Not called", className: "bg-muted text-muted-foreground border-border" },
  NO_ANSWER: { label: "No answer", className: "bg-secondary text-secondary-foreground border-border" },
  VOICEMAIL: { label: "Voicemail", className: "bg-secondary text-secondary-foreground border-border" },
  WRONG_NUMBER: { label: "Wrong number", className: "bg-muted text-muted-foreground border-border" },
  CALLBACK: { label: "Callback scheduled", className: "bg-warning/10 text-warning border-warning/20" },
  INTERESTED: { label: "Interested", className: "bg-success/10 text-success border-success/20" },
  NOT_INTERESTED: { label: "Not interested", className: "bg-destructive/10 text-destructive border-destructive/20" },
  MEETING_BOOKED: { label: "Meeting booked", className: "bg-success/10 text-success border-success/20" },
};

export const SOCIAL_CHANNEL_LABELS: Record<SocialChannel, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  GOOGLE_BUSINESS: "Google Business",
  LINKEDIN: "LinkedIn",
};

export const SOCIAL_POST_STATUS_META: Record<
  SocialPostStatus,
  { label: string; className: string }
> = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
  APPROVED: { label: "Approved", className: "bg-primary/10 text-primary border-primary/20" },
  SCHEDULED: { label: "Scheduled", className: "bg-warning/10 text-warning border-warning/20" },
  PUBLISHING: { label: "Publishing…", className: "bg-warning/10 text-warning border-warning/20" },
  PUBLISHED: { label: "Published", className: "bg-success/10 text-success border-success/20" },
  PUBLISHED_CONFIRMED: { label: "Published ✓", className: "bg-success/10 text-success border-success/20" },
  SIMULATED: { label: "Simulated (not published)", className: "bg-muted text-muted-foreground border-border" },
  FAILED: { label: "Failed", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

/** Audit overall-score below this ⇒ the site is a "modernization" lead. */
export const WEAK_WEBSITE_THRESHOLD = 50;

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const OUTCOME_LABELS: Record<LeadOutcome, string> = {
  OPEN: "Open",
  WON: "Won",
  LOST: "Lost",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXECUTED: "Executed",
};

export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  EMAIL: "Cold / outreach email",
  DM: "Direct message",
  AD: "Ad copy",
  FOLLOW_UP: "Follow-up",
  POST: "Social post",
  OFFER: "Offer / proposal",
  SUBJECT_LINE: "Subject lines",
  COLD_CALL_SCRIPT: "Cold-call script",
};

export const SCORE_GRADE_META: Record<
  ScoreGrade,
  { label: string; className: string; min: number }
> = {
  A: { label: "A · Hot", className: "bg-success/10 text-success border-success/20", min: 75 },
  B: { label: "B · Warm", className: "bg-warning/10 text-warning border-warning/20", min: 50 },
  C: { label: "C · Cool", className: "bg-secondary text-secondary-foreground border-border", min: 25 },
  D: { label: "D · Cold", className: "bg-muted text-muted-foreground border-border", min: 0 },
};

export const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  URGENT: { label: "Urgent", className: "bg-destructive/10 text-destructive border-destructive/20" },
  HIGH: { label: "High", className: "bg-warning/10 text-warning border-warning/20" },
  MEDIUM: { label: "Medium", className: "bg-secondary text-secondary-foreground border-border" },
  LOW: { label: "Low", className: "bg-muted text-muted-foreground border-border" },
};

/** Threshold used by jobs + dashboard to flag a lead as "hot". */
export const HOT_LEAD_THRESHOLD = 75;
