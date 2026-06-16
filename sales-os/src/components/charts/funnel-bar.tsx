"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "./chart-theme";

export function FunnelBar({ data }: { data: { stage: string; count: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 42)}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: CHART.muted }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="stage"
          width={92}
          tick={{ fontSize: 12, fill: CHART.ink }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          contentStyle={{ borderRadius: 8, border: `1px solid ${CHART.grid}`, fontSize: 12 }}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color || CHART.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
