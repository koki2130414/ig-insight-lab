import Link from "next/link";
import { getContext } from "@/lib/context";
import { deleteConversion, saveConversion, saveCost, saveUtm } from "@/app/actions";
import { Badge, Card, Field, Flash, Note, Options, PageHeader, SourceBadge, Val } from "@/components/ui";
import { CopyButton, Disclosure, Submit } from "@/components/client";
import { ATTRIBUTIONS, CONVERSION_KINDS, COST_CATEGORIES } from "@/lib/catalog";
import { safeRate } from "@/lib/analytics";
import { addDays, fmtDate, fmtDateTime, isDay, jstDay, jstDayEnd, jstDayStart, toJstLocalInput } from "@/lib/time";

type SP = { start?: string; end?: string; ok?: string; err?: string };

export default async function FunnelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const acc = ctx.current;
  const end = isDay(sp.end) ? sp.end : jstDay();
  const start = isDay(sp.start) ? sp.start : addDays(end, -27);

  const [{ n: postCount }] = await ctx.db.query<{ n: number }>(`SELECT count(*)::int n FROM posts WHERE account_id=$1 AND posted_at >= $2 AND posted_at < $3`, [acc.id, jstDayStart(start), jstDayEnd(end)]);
  // 期間内に完全に含まれる期間指標だけを合計。どの期間が入力済みかも返す
  const periodRows = await ctx.db.query<{ metric: string; period_start: string; period_end: string; value: number | null; source: string; measurement: string }>(
    `SELECT DISTINCT ON (metric, period_start, period_end) metric, period_start, period_end, value, source, measurement FROM account_metrics
      WHERE account_id=$1 AND metric IN ('profile_visits','link_taps','line_signups','site_sessions') AND period_start >= $2 AND period_end <= $3
      ORDER BY metric, period_start, period_end, CASE source WHEN 'api' THEN 0 WHEN 'csv' THEN 1 WHEN 'json' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END`,
    [acc.id, start, end]);
  const stage = (metric: string) => {
    const rows = periodRows.filter((r) => r.metric === metric);
    const withVal = rows.filter((r) => r.value !== null);
    return { value: withVal.length ? withVal.reduce((a, r) => a + (r.value ?? 0), 0) : null, periods: rows.length, missing: rows.length - withVal.length, sources: [...new Set(withVal.map((r) => r.source + ":" + r.measurement))] };
  };
  const conv = await ctx.db.query<{ id: string; occurred_at: Date; kind: string; quantity: number | null; revenue: number | null; gross_profit: number | null; attribution: string; utm_campaign: string | null; note: string | null; source: string; initiative_id: string | null; title: string | null }>(
    `SELECT c.*, i.title FROM conversions c LEFT JOIN initiatives i ON i.id=c.initiative_id WHERE c.account_id=$1 AND c.occurred_at >= $2 AND c.occurred_at < $3 ORDER BY c.occurred_at DESC`,
    [acc.id, jstDayStart(start), jstDayEnd(end)]);
  const pv = stage("profile_visits"), lt = stage("link_taps"), line = stage("line_signups"), site = stage("site_sessions");
  const outcomes = (attr: string) => conv.filter((c) => c.attribution === attr && ["inquiry", "purchase", "experience"].includes(c.kind)).length;

  const initiatives = await ctx.db.query<{ id: string; title: string; status: string; production_cost: number | null }>(
    `SELECT i.id, i.title, i.status, p.production_cost FROM initiatives i LEFT JOIN posts p ON p.id=i.post_id WHERE i.account_id=$1 ORDER BY i.updated_at DESC LIMIT 40`, [acc.id]);
  const costRows = await ctx.db.query<{ initiative_id: string; category: string; total: number }>(`SELECT initiative_id, category, sum(amount)::float8 total FROM costs WHERE account_id=$1 AND initiative_id IS NOT NULL GROUP BY 1,2`, [acc.id]);
  const allConv = await ctx.db.query<{ initiative_id: string; attribution: string; n: number; revenue: number | null; gp: number | null; gp_missing: number }>(
    `SELECT initiative_id, attribution, count(*)::int n, sum(revenue)::float8 revenue, sum(gross_profit)::float8 gp, count(*) FILTER (WHERE revenue IS NOT NULL AND gross_profit IS NULL)::int gp_missing
       FROM conversions WHERE account_id=$1 AND initiative_id IS NOT NULL GROUP BY 1,2`, [acc.id]);
  const utms = await ctx.db.query<{ id: string; label: string | null; full_url: string; created_at: Date }>(`SELECT * FROM utm_links WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20`, [acc.id]);
  const [rule] = await ctx.db.query<{ value: string | null }>(`SELECT value FROM user_settings WHERE user_id=$1 AND key='gross_profit_rule'`, [ctx.userId]);

  const renderStage = ({ label, s, prev, prevLabel }: { label: string; s: { value: number | null; periods: number; missing: number; sources: string[] }; prev?: number | null; prevLabel?: string }) => (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-xl font-bold"><Val v={s.value} /></div>
      <div className="mt-1 text-[11px] text-muted">
        {s.periods === 0 ? "この範囲の入力なし" : `${s.periods}期間分${s.missing ? `（うち未入力${s.missing}）` : ""}`}
        {s.sources.map((x) => { const [src, m] = x.split(":"); return <span key={x} className="ml-1"><SourceBadge source={src} measurement={m} /></span>; })}
      </div>
      {prev !== undefined && <div className="mt-1 text-[11px]">{prevLabel}からの割合: <Val v={safeRate(s.value, prev)} unit="ratio" missing="算出不可" /></div>}
    </div>
  );

  return (
    <>
      <PageHeader title={`集客・売上導線｜${acc.display_name}`} sub="投稿 → プロフィール → リンク → LINE・サイト → 問い合わせ・購入・申込。取得できない段階は推定で埋めません。" />
      <Flash sp={sp} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="開始日"><input type="date" name="start" defaultValue={start} className="field" /></Field>
        <Field label="終了日"><input type="date" name="end" defaultValue={end} className="field" /></Field>
        <button className="btn-ghost">表示</button>
      </form>

      <Card title={`${fmtDate(start)}〜${fmtDate(end)} の導線`}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-md border border-line bg-white p-3"><div className="text-[11px] text-muted">投稿数</div><div className="text-xl font-bold num">{postCount}</div><div className="mt-1 text-[11px] text-muted">登録済みの投稿</div></div>
          {renderStage({ label: "プロフィール訪問", s: pv })}
          {renderStage({ label: "リンクタップ", s: lt, prev: pv.value, prevLabel: "プロフィール訪問" })}
          {renderStage({ label: "LINE登録", s: line, prev: lt.value, prevLabel: "リンクタップ" })}
          {renderStage({ label: "サイト訪問（IG経由）", s: site, prev: lt.value, prevLabel: "リンクタップ" })}
          <div className="rounded-md border border-line bg-white p-3">
            <div className="text-[11px] text-muted">問い合わせ・購入・申込</div>
            <div className="mt-1 space-y-0.5 text-sm">
              <div>計測できた成果 <b className="num">{outcomes("measured")}</b></div>
              <div>顧客の自己申告 <b className="num">{outcomes("self_reported")}</b></div>
              <div>経路不明 <b className="num">{outcomes("unknown_path")}</b></div>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-muted">各段階は範囲内に完全に含まれる期間の入力値を合計しています。段階の値は別々に記録したもので、同じ人の流れを追跡したものではありません。</p>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title={`成果の記録（${conv.length}件）`}>
          {conv.length === 0 ? <p className="text-sm text-muted">この範囲の記録はありません。右のフォームか<Link href="/import" className="underline">CSV取り込み</Link>で登録してください。</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">日時</th><th>種類</th><th>経路</th><th>売上</th><th>粗利益</th><th>施策</th><th></th></tr></thead>
                <tbody>
                  {conv.map((c) => (
                    <tr key={c.id} className="border-b border-line/60">
                      <td className="py-1.5 text-xs">{fmtDateTime(c.occurred_at)}</td>
                      <td>{CONVERSION_KINDS[c.kind as keyof typeof CONVERSION_KINDS]}{c.quantity !== null && ` ×${c.quantity}`}</td>
                      <td><Badge t={c.attribution === "measured" ? "green" : c.attribution === "self_reported" ? "gold" : "gray"}>{ATTRIBUTIONS[c.attribution as keyof typeof ATTRIBUTIONS]}</Badge>{c.source === "demo" && <Badge t="demo">デモ</Badge>}</td>
                      <td><Val v={c.revenue} unit="yen" missing="未入力" /></td>
                      <td><Val v={c.gross_profit} unit="yen" missing="未入力" /></td>
                      <td className="max-w-[160px] truncate text-xs">{c.initiative_id ? <Link className="underline" href={`/initiatives/${c.initiative_id}`}>{c.title}</Link> : c.utm_campaign ?? "—"}</td>
                      <td><form action={deleteConversion}><input type="hidden" name="id" value={c.id} /><Submit className="text-xs text-warn underline" confirm="削除しますか？" pendingText="…">削除</Submit></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="成果を記録">
          <form action={saveConversion} className="space-y-2">
            <input type="hidden" name="account_id" value={acc.id} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="日時"><input type="datetime-local" name="occurred_at" defaultValue={toJstLocalInput(new Date())} className="field" required /></Field>
              <Field label="種類"><select name="kind" className="field"><Options map={CONVERSION_KINDS} /></select></Field>
            </div>
            <Field label="経路の確からしさ" hint="UTMやLINEの流入経路で確認できた→計測できた成果／お客さまが「インスタで見た」と言った→自己申告">
              <select name="attribution" className="field"><Options map={ATTRIBUTIONS} /></select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="数量"><input name="quantity" inputMode="numeric" className="field num" /></Field>
              <Field label="売上(円)"><input name="revenue" inputMode="numeric" className="field num" /></Field>
              <Field label="粗利益(円)"><input name="gross_profit" inputMode="numeric" className="field num" /></Field>
            </div>
            <Field label="関連する施策">
              <select name="initiative_id" className="field"><option value="">なし・不明</option>{initiatives.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="utm_campaign"><input name="utm_campaign" className="field" /></Field>
              <Field label="注文番号など"><input name="external_ref" className="field" /></Field>
            </div>
            <Field label="メモ"><input name="note" className="field" /></Field>
            <Submit>記録する</Submit>
          </form>
        </Card>
      </div>

      <Card title="施策ごとのコストと成果" className="mt-4">
        <Note>粗利益の算定条件: {rule?.value ? rule.value : <>未設定です。<Link href="/settings" className="underline">設定</Link>で「何を原価に含めるか（米の原価・袋・送料・決済手数料など）」を明記してください。</>}</Note>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2">施策</th>{Object.values(COST_CATEGORIES).map((c) => <th key={c}>{c}</th>)}<th>費用計</th><th>計測できた成果</th><th>売上（計測分）</th><th>粗利益（計測分）</th><th>計測成果1件あたり費用</th>
              </tr>
            </thead>
            <tbody>
              {initiatives.map((i) => {
                const cs = costRows.filter((r) => r.initiative_id === i.id);
                const byCat = (k: string) => (k === "production" ? (cs.find((r) => r.category === k)?.total ?? 0) + (i.production_cost ?? 0) : cs.find((r) => r.category === k)?.total ?? 0);
                const total = Object.keys(COST_CATEGORIES).reduce((a, k) => a + byCat(k), 0);
                const m = allConv.find((r) => r.initiative_id === i.id && r.attribution === "measured");
                const others = allConv.filter((r) => r.initiative_id === i.id && r.attribution !== "measured").reduce((a, r) => a + r.n, 0);
                if (!total && !m && !others) return null;
                return (
                  <tr key={i.id} className="border-b border-line/60">
                    <td className="max-w-[220px] truncate py-1.5"><Link href={`/initiatives/${i.id}`} className="underline">{i.title}</Link></td>
                    {Object.keys(COST_CATEGORIES).map((k) => <td key={k}><Val v={byCat(k) || null} unit="yen" missing="—" /></td>)}
                    <td className="font-semibold"><Val v={total} unit="yen" /></td>
                    <td className="num">{m?.n ?? 0}{others ? <span className="text-xs text-muted">（自己申告・経路不明 {others}）</span> : null}</td>
                    <td><Val v={m?.revenue ?? null} unit="yen" missing="—" /></td>
                    <td><Val v={m?.gp ?? null} unit="yen" missing="—" />{m?.gp_missing ? <span className="text-xs text-muted">（粗利未入力{m.gp_missing}件）</span> : null}</td>
                    <td><Val v={m?.n ? total / m.n : null} unit="yen" missing="算出不可" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted">「1件あたり費用」は計測できた成果のみで計算。自己申告・経路不明の成果は件数だけを表示し、費用対効果には含めません。</p>
        </div>
        <div className="mt-3">
          <Disclosure summary="施策に紐づかない費用を記録">
            <form action={saveCost} className="grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="account_id" value={acc.id} />
              <select name="category" className="field"><Options map={COST_CATEGORIES} /></select>
              <input name="amount" inputMode="numeric" placeholder="金額" className="field num" required />
              <input type="date" name="occurred_on" defaultValue={jstDay()} className="field" />
              <input name="note" placeholder="メモ" className="field" />
              <Submit className="btn-ghost">追加</Submit>
            </form>
          </Disclosure>
        </div>
      </Card>

      <Card title="UTM付きURLを作る" className="mt-4">
        <form action={saveUtm} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="account_id" value={acc.id} />
          <Field label="リンク先URL*" className="sm:col-span-2 lg:col-span-3"><input name="base_url" type="url" required className="field" placeholder="https://..." /></Field>
          <Field label="utm_source"><input name="utm_source" defaultValue="instagram" className="field" /></Field>
          <Field label="utm_medium"><input name="utm_medium" defaultValue="social" className="field" /></Field>
          <Field label="utm_campaign*"><input name="utm_campaign" required className="field" placeholder="例: shinmai2026" /></Field>
          <Field label="utm_content"><input name="utm_content" className="field" placeholder="例: profile-link / story-0412" /></Field>
          <Field label="メモ"><input name="label" className="field" /></Field>
          <div className="flex items-end"><Submit className="btn w-full">作成</Submit></div>
        </form>
        {utms.length > 0 && (
          <ul className="mt-3 space-y-2 text-xs">
            {utms.map((u) => <li key={u.id} className="flex items-center gap-2"><span className="w-24 shrink-0 text-muted">{u.label ?? fmtDate(u.created_at)}</span><code className="min-w-0 flex-1 break-all rounded bg-paper p-1">{u.full_url}</code><CopyButton text={u.full_url} /></li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
