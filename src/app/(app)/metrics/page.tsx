import { getContext } from "@/lib/context";
import { saveAccountMetrics } from "@/app/actions";
import { Card, Field, Flash, Note, PageHeader, SourceBadge, Val, Badge } from "@/components/ui";
import { Submit } from "@/components/client";
import { ACCOUNT_METRICS } from "@/lib/catalog";
import { addDays, fmtDate, fmtDateTime, jstDay, weekStart } from "@/lib/time";

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const acc = ctx.current;
  const lastWeekStart = addDays(weekStart(jstDay()), -7);
  const rows = await ctx.db.query<{ metric: string; period_start: string; period_end: string; value: number | null; status: string; unavailable_reason: string | null; source: string; measurement: string; captured_at: Date }>(
    `SELECT metric, period_start, period_end, value, status, unavailable_reason, source, measurement, captured_at FROM account_metrics WHERE account_id=$1 ORDER BY period_end DESC, metric LIMIT 120`,
    [acc.id],
  );
  return (
    <>
      <PageHeader title={`期間の指標｜${acc.display_name}`} sub="インサイト画面を見ながら入力できます。空欄は「未入力」のまま保存しません（ゼロとして扱いません）。" />
      <Flash sp={sp} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title="指標を入力">
          <form action={saveAccountMetrics} className="space-y-4">
            <input type="hidden" name="account_id" value={acc.id} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="期間開始日"><input type="date" name="period_start" defaultValue={lastWeekStart} className="field" required /></Field>
              <Field label="期間終了日"><input type="date" name="period_end" defaultValue={addDays(lastWeekStart, 6)} className="field" required /></Field>
              <Field label="計測区分">
                <select name="measurement" className="field" defaultValue="manual">
                  <option value="manual">手入力（インサイト画面の値）</option>
                  <option value="estimated">推定</option>
                </select>
              </Field>
            </div>
            <Note>同じ期間・同じ指標を再入力すると上書きします。ダッシュボードの比較は、期間が完全に一致する値どうしで行います。</Note>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {ACCOUNT_METRICS.map((m) => (
                <Field key={m.key} label={m.label} hint={m.key === "followers" ? "期間終了日時点の値" : undefined}>
                  <input name={`m_${m.key}`} inputMode="numeric" className="field num" placeholder="未入力" />
                </Field>
              ))}
            </div>
            <Submit>保存する</Submit>
          </form>
        </Card>
        <Card title="指標の定義と公式APIでの取得可否">
          <ul className="space-y-2 text-[13px]">
            {ACCOUNT_METRICS.map((m) => (
              <li key={m.key} className="border-b border-line/60 pb-2">
                <div className="flex flex-wrap items-center gap-1.5 font-semibold">{m.label}{m.api ? <Badge t="green">API: {m.api.name}</Badge> : <Badge>API非対応</Badge>}</div>
                <div className="text-muted">{m.definition}</div>
                {(m.api?.note || m.apiUnavailableReason) && <div className="text-[12px] text-muted">※ {m.api?.note ?? m.apiUnavailableReason}</div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="記録済みの値" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">期間</th><th>指標</th><th>値</th><th>区分</th><th>取得日時</th><th>備考</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="py-1.5">{fmtDate(r.period_start)}{r.period_start !== r.period_end && `〜${fmtDate(r.period_end)}`}</td>
                  <td>{ACCOUNT_METRICS.find((m) => m.key === r.metric)?.label ?? r.metric}</td>
                  <td><Val v={r.value} missing={r.status === "unavailable" ? "非対応/取得不可" : "未入力"} /></td>
                  <td><SourceBadge source={r.source} measurement={r.measurement} /></td>
                  <td className="text-xs text-muted">{fmtDateTime(r.captured_at)}</td>
                  <td className="text-xs text-muted">{r.unavailable_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="py-3 text-sm text-muted">まだ記録がありません。</p>}
        </div>
      </Card>
    </>
  );
}
