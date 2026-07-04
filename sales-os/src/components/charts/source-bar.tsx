"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LeadSource } from "@prisma/client";
import { LEAD_SOURCE_LABELS } from "@/lib/constants";
import { CHART } from "./chart-theme";

export function SourceBar({ data }: { data: { source: string; count: number }[] }) {
  const rows = data.map((d) => ({
    label: LEAD_SOURCE_LABELS[d.source as LeadSource] ?? d.source,
    count: d.count,
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 38)}>
      <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: CHART.muted }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={104} tick={{ fontSize: 12, fill: CHART.ink }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ borderRadius: 8, border: `1px solid ${CHART.grid}`, fontSize: 12 }} />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18} fill={CHART.sand} />
      </BarChart>
    </ResponsiveContainer>
  );
}
