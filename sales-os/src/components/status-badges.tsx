import type { ApprovalStatus, LeadOutcome, LeadSource, TaskStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import {
  APPROVAL_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
  OUTCOME_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/constants";

const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

const OUTCOME_CLASS: Record<LeadOutcome, string> = {
  OPEN: "bg-secondary text-secondary-foreground border-border",
  WON: "bg-success/10 text-success border-success/20",
  LOST: "bg-destructive/10 text-destructive border-destructive/20",
};

export function OutcomeBadge({ outcome, className }: { outcome: LeadOutcome; className?: string }) {
  return <span className={cn(base, OUTCOME_CLASS[outcome], className)}>{OUTCOME_LABELS[outcome]}</span>;
}

const TASK_CLASS: Record<TaskStatus, string> = {
  TODO: "bg-secondary text-secondary-foreground border-border",
  IN_PROGRESS: "bg-warning/10 text-warning border-warning/20",
  DONE: "bg-success/10 text-success border-success/20",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through",
};

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return <span className={cn(base, TASK_CLASS[status], className)}>{TASK_STATUS_LABELS[status]}</span>;
}

const APPROVAL_CLASS: Record<ApprovalStatus, string> = {
  PENDING: "bg-warning/10 text-warning border-warning/20",
  APPROVED: "bg-success/10 text-success border-success/20",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/20",
  EXECUTED: "bg-primary/10 text-primary border-primary/20",
};

export function ApprovalStatusBadge({ status, className }: { status: ApprovalStatus; className?: string }) {
  return <span className={cn(base, APPROVAL_CLASS[status], className)}>{APPROVAL_STATUS_LABELS[status]}</span>;
}

export function SourceBadge({ source, className }: { source: LeadSource; className?: string }) {
  return (
    <span className={cn(base, "bg-muted/60 text-muted-foreground border-border", className)}>
      {LEAD_SOURCE_LABELS[source]}
    </span>
  );
}
