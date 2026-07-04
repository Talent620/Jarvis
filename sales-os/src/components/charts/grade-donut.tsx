"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { GRADE_COLORS } from "./chart-theme";

export function GradeDonut({ data }: { data: { grade: string; count: number }[] }) {
  const rows = data.filter((d) => d.count > 0);
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No scored leads yet.</p>;
  }
  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width="55%" height={180}>
        <PieChart>
          <Pie data={rows} dataKey="count" nameKey="grade" innerRadius={45} outerRadius={75} paddingAngle={2}>
            {rows.map((d) => (
              <Cell key={d.grade} fill={GRADE_COLORS[d.grade] ?? "#94a3b8"} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="space-y-2 text-sm">
        {rows.map((d) => (
          <li key={d.grade} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: GRADE_COLORS[d.grade] }} />
            <span className="font-medium">Grade {d.grade}</span>
            <span className="text-muted-foreground">· {d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
