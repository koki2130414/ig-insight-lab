import Link from "next/link";
import { getContext } from "@/lib/context";
import { buildReview, type ReviewSummary } from "@/lib/review";
import { saveReview } from "@/app/actions";
import { Card, Field, Flash, Note, PageHeader, Badge } from "@/components/ui";
import { Submit } from "@/components/client";
import { DECISIONS } from "@/lib/catalog";
import { addDays, fmtDate, fmtDateTime, isDay, jstDay, weekStart } from "@/lib/time";

type SP = { week?: string; minutes?: string; ok?: string; err?: string };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const acc = ctx.current;
  const week = isDay(sp.week) ? weekStart(sp.week) : addDays(weekStart(jstDay()), -7);
  const [saved] = await ctx.db.query<{ summary: ReviewSummary; notes: string | null; available_minutes: number | null; updated_at: Date }>(
    `SELECT summary, notes, available_minutes, updated_at FROM weekly_reviews WHERE account_id=$1 AND week_start=$2`, [acc.id, week]);
  const minutes = sp.minutes ? Number(sp.minutes) || null : saved?.available_minutes ?? acc.weekly_minutes;
  const r = await buildReview(ctx, acc, week, minutes);
  const past = await ctx.db.query<{ week_start: string; updated_at: Date }>(`SELECT week_start, updated_at FROM weekly_reviews WHERE account_id=$1 ORDER BY week_start DESC LIMIT 8`, [acc.id]);

  const sec = (title: string, items: React.ReactNode[], empty: string) => (
    <Card title={title}>
      {items.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-muted">{empty}</p>}
    </Card>
  );

  return (
    <>
      <PageHeader title={`週次レビュー｜${acc.display_name}`} sub="毎週のデータから、確認できたこと・未確認のこと・次週の施策をまとめます。" />
      <Flash sp={sp} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="対象週（その週の月曜〜日曜）"><input type="date" name="week" defaultValue={week} className="field" /></Field>
        <Field label="次週の制作可能時間（分）"><input name="minutes" inputMode="numeric" defaultValue={minutes ?? ""} className="field num w-32" /></Field>
        <button className="btn-ghost">集計する</button>
        <span className="pb-2 text-xs text-muted">{fmtDate(week)}〜{fmtDate(addDays(week, 6))}{saved && `・保存済み（${fmtDateTime(saved.updated_at)}）`}</span>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="伸びた投稿と理由の仮説">
          {r.grown.length === 0 ? <p className="text-sm text-muted">同形式の中央値を1.2倍以上上回った投稿はありません（比較対象3件未満の形式は判定しません）。</p> : (
            <ul className="space-y-3 text-sm">
              {r.grown.map((g) => (
                <li key={g.postId}>
                  <Link href={`/posts/${g.postId}`} className="font-semibold underline">{g.label}</Link>
                  <div className="text-xs text-muted">{g.checkpoint}時点: {g.vs}</div>
                  <div className="mt-1 text-[13px]"><Badge t="gold">仮説</Badge> {g.hypotheses.join("／")}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-muted">理由は仮説です。1回の結果で勝ちパターンと判断せず、同じ変更点で再検証してください。</p>
        </Card>
        {sec("届いた層について確認できたこと", r.confirmed, "確認できたデータはありません。")}
        {sec("未確認のこと", r.unconfirmed, "大きな未確認事項はありません。")}
        {sec("購入・問い合わせにつながった施策", r.converted, "この週の成果の記録はありません。")}
        <Card title={`次週に試す施策（実行可能 ${r.capacity.count}件）`}>
          <p className="mb-2 text-xs text-muted">制作可能時間 {r.capacity.minutes ?? "未設定"}分。{r.capacity.note}</p>
          {r.next.length === 0 ? (
            <p className="text-sm text-muted">候補がありません。<Link href="/initiatives/new" className="underline">施策をつくる</Link>から追加してください。</p>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {r.next.map((n) => (
                <li key={n.id}><Link href={`/initiatives/${n.id}`} className="underline">{n.title}</Link><div className="text-xs text-muted">{n.reason}・約{n.minutes ?? "?"}分{n.materials && `・素材: ${n.materials}`}</div></li>
              ))}
            </ol>
          )}
          {r.capacity.count < 3 && <p className="mt-2 text-xs text-muted">3件に満たない場合は、時間内でできる件数を優先します。大量投稿を前提にしません。</p>}
        </Card>
        <Card title="やめる／修正する施策">
          {r.stopOrModify.length === 0 ? <p className="text-sm text-muted">ありません。</p> : (
            <ul className="space-y-1 text-sm">{r.stopOrModify.map((s) => <li key={s.id}><Badge t={s.decision === "stop" ? "red" : "gold"}>{DECISIONS[s.decision as keyof typeof DECISIONS]}</Badge> <Link href={`/initiatives/${s.id}`} className="underline">{s.title}</Link></li>)}</ul>
          )}
        </Card>
        <Card title="必要な素材と作業時間">
          {r.next.length ? (
            <>
              <ul className="list-disc space-y-1 pl-5 text-sm">{r.next.map((n) => <li key={n.id}>{n.materials ?? "素材未設定"}（約{n.minutes ?? "?"}分）</li>)}</ul>
              <p className="mt-2 text-sm font-semibold">合計 約{r.next.reduce((a, n) => a + (n.minutes ?? 0), 0)}分{r.next.some((n) => n.minutes === null) && "（時間未設定あり）"}</p>
            </>
          ) : <p className="text-sm text-muted">—</p>}
        </Card>
      </div>

      <Card title="レビューを保存" className="mt-4">
        <form action={saveReview} className="space-y-3">
          <input type="hidden" name="account_id" value={acc.id} />
          <input type="hidden" name="week" value={week} />
          <input type="hidden" name="available_minutes" value={minutes ?? ""} />
          <input type="hidden" name="summary" value={JSON.stringify(r)} />
          <input type="hidden" name="plan_ids" value={r.next.filter((n) => !n.reason.startsWith("再検証") && !n.reason.startsWith("修正")).map((n) => n.id).join(",")} />
          <Field label="メモ（気づき・来週の方針）"><textarea name="notes" rows={3} defaultValue={saved?.notes ?? ""} className="field" /></Field>
          <Note>保存すると、上の「次週に試す施策」の予定週を次週に設定します（ダッシュボードの「今週実行する施策」に表示）。</Note>
          <Submit>保存する</Submit>
        </form>
      </Card>

      {past.length > 0 && (
        <p className="mt-4 text-xs text-muted">過去のレビュー: {past.map((p) => <Link key={p.week_start} href={`/review?week=${p.week_start}`} className="mr-2 underline">{fmtDate(p.week_start)}</Link>)}</p>
      )}
    </>
  );
}
