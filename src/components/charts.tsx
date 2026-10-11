"use client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";

export function FollowerChart({ data, target }: { data: { day: string; value: number | null }[]; target?: number | null }) {
  if (data.filter((d) => d.value !== null).length < 2) {
    return <p className="text-sm text-muted">フォロワー数の記録が2点以上たまると推移を表示します。</p>;
  }
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#e2ded2" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5).replace("-", "/")} fontSize={11} stroke="#5f6b63" />
          <YAxis fontSize={11} stroke="#5f6b63" domain={["auto", "auto"]} />
          <Tooltip formatter={(v) => [Number(v).toLocaleString("ja-JP"), "フォロワー"]} labelFormatter={(l) => String(l)} />
          {target ? <ReferenceLine y={target} stroke="#b07d1f" strokeDasharray="4 4" /> : null}
          <Line type="monotone" dataKey="value" stroke="#2f6b4f" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
