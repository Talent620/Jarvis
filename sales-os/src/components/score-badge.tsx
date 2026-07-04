import type { ScoreGrade } from "@prisma/client";
import { cn } from "@/lib/utils";
import { SCORE_GRADE_META } from "@/lib/constants";

function gradeFor(score: number): ScoreGrade {
  if (score >= SCORE_GRADE_META.A.min) return "A";
  if (score >= SCORE_GRADE_META.B.min) return "B";
  if (score >= SCORE_GRADE_META.C.min) return "C";
  return "D";
}

export function ScoreBadge({
  score,
  grade,
  className,
}: {
  score: number;
  grade?: ScoreGrade;
  className?: string;
}) {
  const g = grade ?? gradeFor(score);
  const meta = SCORE_GRADE_META[g];
  return (
    <span
      title={meta.label}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        meta.className,
        className,
      )}
    >
      <span className="font-semibold">{g}</span>
      <span className="opacity-70">·</span>
      {score}
    </span>
  );
}
