import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, requireOwned, type Ctx } from "@/lib/context";
import { comparisonFor, postsFor, targetsFor, type Initiative, type PostRow } from "@/lib/queries";
import { deleteInitiative, saveCost, saveInitiative, saveUtm } from "@/app/actions";
import { Badge, Card, Field, Flash, Note, Options, PageHeader, Val } from "@/components/ui";
import { CopyButton, Submit } from "@/components/client";
import { ATTRIBUTIONS, CHECKPOINTS, CONVERSION_KINDS, COST_CATEGORIES, DECISIONS, FORMATS, POST_RATES, PURPOSES, STATUSES, TEST_VARIABLES } from "@/lib/catalog";
import { suggestDecision } from "@/lib/analytics";
import { rateLabel } from "@/lib/generator";
import { fmtDate, fmtDateTime, jstDay } from "@/lib/time";

const RATE_OPTIONS = Object.fromEntries(POST_RATES.map((r) => [r.key, r.label]));

async function resultFor(ctx: Ctx, post: PostRow, metric: string) {
  const out: { cp: string; value: number | null; median: number | null; n: number; vsMedian: number | null }[] = [];
  for (const cp of ["24h", "72h", "7d"] as const) {
    const c = await comparisonFor(ctx, post, { checkpoint: cp, samePurpose: false, excludeAds: true, excludeDrift: true });
    const s = c.stats.find((x) => x.key === metric);
    out.push({ cp, value: c.target ? s?.value ?? null : null, median: s?.median ?? null, n: s?.n ?? 0, vsMedian: c.target ? s?.vsMedian ?? null : null });
  }
  return out;
}

export default async function InitiativePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  let acc;
  try {
    acc = await requireOwned(ctx, "initiatives", id);
  } catch {
    notFound();
  }
  const [ini] = await ctx.db.query<Initiative>(`SELECT * FROM initiatives WHERE id=$1`, [id]);
  const [posts, targets] = await Promise.all([postsFor(ctx, acc.id), targetsFor(ctx, acc.id)]);
  const post = posts.find((p) => p.id === ini.post_id) ?? null;
  const metric = ini.primary_metric && RATE_OPTIONS[ini.primary_metric] ? ini.primary_metric : "save_rate";
  const result = post ? await resultFor(ctx, post, metric) : [];

  // 同じ変更点・同じアカウントの過去の施策の結果（72h時点・主指標の中央値比）
  const siblings = ini.test_variable
    ? await ctx.db.query<Initiative>(`SELECT * FROM initiatives WHERE account_id=$1 AND test_variable=$2 AND post_id IS NOT NULL ORDER BY created_at`, [acc.id, ini.test_variable])
    : [];
  const history: { ini: Initiative; vsMedian: number | null }[] = [];
  for (const s of siblings) {
    const p = posts.find((x) => x.id === s.post_id);
    if (!p) continue;
    const r = await comparisonFor(ctx, p, { checkpoint: "72h", samePurpose: false, excludeAds: true, excludeDrift: true });
    history.push({ ini: s, vsMedian: r.target ? r.stats.find((x) => x.key === (s.primary_metric ?? metric))?.vsMedian ?? null : null });
  }
  const suggestion = suggestDecision(history);

  const costs = await ctx.db.query<{ id: string; category: string; amount: number; occurred_on: string; note: string | null }>(`SELECT * FROM costs WHERE initiative_id=$1 ORDER BY occurred_on`, [id]);
  const convs = await ctx.db.query<{ id: string; kind: string; attribution: string; quantity: number | null; revenue: number | null; gross_profit: number | null; occurred_at: Date }>(`SELECT * FROM conversions WHERE initiative_id=$1 OR (post_id IS NOT NULL AND post_id=$2) ORDER BY occurred_at`, [id, ini.post_id]);
  const utms = await ctx.db.query<{ id: string; label: string | null; full_url: string; utm_campaign: string }>(`SELECT * FROM utm_links WHERE initiative_id=$1 ORDER BY created_at DESC`, [id]);
  const c = ini.confounders ?? {};
  const totalCost = costs.reduce((a, x) => a + x.amount, 0) + (post?.production_cost ?? 0);

  return (
    <>
      <PageHeader
        title={ini.title}
        sub={<>{acc.display_name}・{STATUSES[ini.status as keyof typeof STATUSES]}・{ini.generated_by === "ai" ? "AIが作成した案" : ini.generated_by === "rule" ? "ルールベースで作成した案（AI生成ではありません）" : "手動作成"}</>}
        actions={<Link href="/board" className="btn-ghost">ボードへ</Link>}
      />
      <Flash sp={sp} />

      {(ini.facts?.length > 0 || ini.data_gaps) && (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {ini.facts?.length > 0 && <Note t="green"><b>作成時に参照した事実:</b> {ini.facts.join(" ／ ")}</Note>}
          {ini.data_gaps && <Note t="gold"><b>不足していたデータ:</b> {ini.data_gaps}</Note>}
        </div>
      )}

      <form action={saveInitiative} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Card title="計画">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="タイトル" className="sm:col-span-2"><input name="title" defaultValue={ini.title} className="field" /></Field>
            <Field label="状態"><select name="status" defaultValue={ini.status} className="field"><Options map={STATUSES} /></select></Field>
            <Field label="対象層">
              <select name="target_id" defaultValue={ini.target_id ?? ""} className="field">
                <option value="">未選択</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="目的"><input disabled value={ini.goal ? PURPOSES[ini.goal as keyof typeof PURPOSES] : "—"} className="field bg-paper" /></Field>
            <Field label="投稿形式"><select name="format" defaultValue={ini.format ?? ""} className="field"><Options map={FORMATS} empty="未定" /></select></Field>
            <Field label="仮説" className="sm:col-span-2 lg:col-span-3"><textarea name="hypothesis" rows={2} defaultValue={ini.hypothesis ?? ""} className="field" /></Field>
            {[0, 1, 2].map((i) => (
              <Field key={i} label={`冒頭のフック 案${i + 1}`}><input name={`hook${i + 1}`} defaultValue={ini.hooks?.[i] ?? ""} className="field" /></Field>
            ))}
            <Field label="台本・構成" className="sm:col-span-2 lg:col-span-3"><textarea name="script" rows={4} defaultValue={ini.script ?? ""} className="field" /></Field>
            <Field label="撮影素材"><textarea name="materials" rows={2} defaultValue={ini.materials ?? ""} className="field" /></Field>
            <Field label="投稿文"><textarea name="caption" rows={2} defaultValue={ini.caption ?? ""} className="field" /></Field>
            <Field label="CTA"><textarea name="cta" rows={2} defaultValue={ini.cta ?? ""} className="field" /></Field>
            <Field label="期待する行動"><input name="expected_action" defaultValue={ini.expected_action ?? ""} className="field" /></Field>
            <Field label="主指標"><select name="primary_metric" defaultValue={metric} className="field"><Options map={RATE_OPTIONS} /></select></Field>
            <Field label="予定週（月曜）"><input type="date" name="planned_week" defaultValue={ini.planned_week ?? ""} className="field" /></Field>
            <Field label="成功条件"><textarea name="success_criteria" rows={2} defaultValue={ini.success_criteria ?? ""} className="field" /></Field>
            <Field label="中止条件"><textarea name="stop_criteria" rows={2} defaultValue={ini.stop_criteria ?? ""} className="field" /></Field>
            <Field label="リスク"><textarea name="risks" rows={2} defaultValue={ini.risks ?? ""} className="field" /></Field>
            <Field label="制作時間（分）"><input name="est_minutes" inputMode="numeric" defaultValue={ini.est_minutes ?? ""} className="field num" /></Field>
            <Field label="費用見積（円）"><input name="est_cost" inputMode="numeric" defaultValue={ini.est_cost ?? ""} className="field num" /></Field>
            <Field label="次の検証案"><input name="next_test" defaultValue={ini.next_test ?? ""} className="field" /></Field>
          </div>
        </Card>

        <Card title="検証の設計">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="主な変更点（1つ）"><select name="test_variable" defaultValue={ini.test_variable ?? ""} className="field"><Options map={TEST_VARIABLES} empty="未設定" /></select></Field>
            <Field label="変更内容の詳細"><input name="test_detail" defaultValue={ini.test_detail ?? ""} className="field" /></Field>
            <Field label="比較の種類" hint="自然投稿の比較は通常「比較検証」">
              <select name="comparison_kind" defaultValue={ini.comparison_kind} className="field"><option value="observational">比較検証（ランダム化なし）</option><option value="randomized">ランダム化比較（広告のA/Bテスト等）</option></select>
            </Field>
            <Field label="紐づける投稿" className="sm:col-span-2" hint="投稿済み以降の状態にするには必須">
              <select name="post_id" defaultValue={ini.post_id ?? ""} className="field">
                <option value="">未投稿</option>
                {posts.map((p) => <option key={p.id} value={p.id}>{fmtDateTime(p.posted_at)} {FORMATS[p.format as keyof typeof FORMATS]} {(p.hook || p.theme || "").slice(0, 24)}</option>)}
              </select>
            </Field>
            <div className="flex items-end"><Link href={`/posts/new?initiative=${id}`} className="btn-ghost w-full">投稿を登録して紐づける</Link></div>
          </div>
          <fieldset className="mt-3">
            <legend className="label">結果に影響しうる要因（記録）</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {([["c_ad", "ad", "広告を併用"], ["c_collab", "collab", "コラボ"], ["c_season", "season", "季節要因（新米・田植え等）"], ["c_trend", "trend", "話題性・トレンド"], ["c_giveaway", "giveaway", "プレゼント企画"]] as const).map(([n, k, l]) => (
                <label key={n} className="flex items-center gap-1.5"><input type="checkbox" name={n} value="1" defaultChecked={Boolean(c[k])} />{l}</label>
              ))}
            </div>
            <input name="c_note" defaultValue={String(c.note ?? "")} placeholder="その他のメモ" className="field mt-2" />
          </fieldset>
        </Card>

        <Card title="結果と振り返り" id="review">
          {post ? (
            <>
              <p className="mb-2 text-sm">主指標: <b>{rateLabel(metric)}</b>（同じ形式の投稿の中央値と比較・広告/プレゼント企画と時点ずれは除外）</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">時点</th><th>この投稿</th><th>中央値</th><th>比較件数</th><th>中央値比</th></tr></thead>
                  <tbody>
                    {result.map((r) => (
                      <tr key={r.cp} className="border-b border-line/60">
                        <td className="py-1.5">{CHECKPOINTS[r.cp as keyof typeof CHECKPOINTS].label}</td>
                        <td><Val v={r.value} unit="ratio" missing="未記録" /></td>
                        <td><Val v={r.median} unit="ratio" missing="—" /></td>
                        <td className="num">{r.n}</td>
                        <td>{r.vsMedian === null ? "—" : `${r.vsMedian.toFixed(2)}倍`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs"><Link href={`/posts/${post.id}#snapshot`} className="underline">投稿の実績を入力・確認する</Link></p>
            </>
          ) : <p className="text-sm text-muted">投稿を紐づけると結果が表示されます。</p>}

          <div className="mt-4">
            <Note t="gold">
              <b>判定の提案: {DECISIONS[suggestion.decision]}</b>　{suggestion.reason}
              {history.length > 0 && <span className="mt-1 block text-xs">同じ変更点（{TEST_VARIABLES[ini.test_variable as keyof typeof TEST_VARIABLES]}）の過去の結果（72時間時点）: {history.map((h) => `${h.ini.title.slice(0, 14)}…=${h.vsMedian === null ? "未記録" : h.vsMedian.toFixed(2) + "倍"}`).join("、")}</span>}
            </Note>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="結果のまとめ（確認できたこと／未確認のこと）"><textarea name="result_summary" rows={3} defaultValue={ini.result_summary ?? ""} className="field" /></Field>
            <Field label="振り返りメモ"><textarea name="review_notes" rows={3} defaultValue={ini.review_notes ?? ""} className="field" /></Field>
            <Field label="判定"><select name="decision" defaultValue={ini.decision ?? ""} className="field"><Options map={DECISIONS} empty="未判定" /></select></Field>
          </div>
        </Card>
        <div className="sticky bottom-3 z-10 flex justify-end"><Submit>施策を保存</Submit></div>
      </form>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="費用">
          <ul className="mb-3 space-y-1 text-sm">
            {post?.production_cost ? <li className="flex justify-between"><span>投稿の制作費</span><Val v={post.production_cost} unit="yen" /></li> : null}
            {costs.map((x) => <li key={x.id} className="flex justify-between"><span>{COST_CATEGORIES[x.category as keyof typeof COST_CATEGORIES]}・{fmtDate(x.occurred_on)}{x.note && `（${x.note}）`}</span><Val v={x.amount} unit="yen" /></li>)}
            <li className="flex justify-between border-t border-line pt-1 font-bold"><span>合計（記録分）</span><Val v={totalCost} unit="yen" /></li>
          </ul>
          <form action={saveCost} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="account_id" value={acc.id} />
            <input type="hidden" name="initiative_id" value={id} />
            <input type="hidden" name="back" value={`/initiatives/${id}`} />
            <select name="category" className="field"><Options map={COST_CATEGORIES} /></select>
            <input name="amount" inputMode="numeric" placeholder="金額" className="field num" required />
            <input type="date" name="occurred_on" defaultValue={jstDay()} className="field" />
            <input name="note" placeholder="メモ" className="field" />
            <Submit className="btn-ghost col-span-2">費用を追加</Submit>
          </form>
        </Card>
        <Card title="この施策の成果">
          {convs.length === 0 ? <p className="text-sm text-muted">紐づく成果はまだありません。<Link href="/funnel" className="underline">導線・売上</Link>から記録できます。</p> : (
            <ul className="space-y-1 text-sm">
              {convs.map((x) => (
                <li key={x.id} className="flex flex-wrap justify-between gap-1">
                  <span>{fmtDate(x.occurred_at)} {CONVERSION_KINDS[x.kind as keyof typeof CONVERSION_KINDS]} <Badge t={x.attribution === "measured" ? "green" : "gold"}>{ATTRIBUTIONS[x.attribution as keyof typeof ATTRIBUTIONS]}</Badge></span>
                  <Val v={x.revenue} unit="yen" missing="売上未入力" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="UTM付きURL">
          <ul className="mb-3 space-y-2 text-xs">
            {utms.map((u) => <li key={u.id} className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-paper p-1">{u.full_url}</code><CopyButton text={u.full_url} /></li>)}
          </ul>
          <form action={saveUtm} className="space-y-2">
            <input type="hidden" name="account_id" value={acc.id} />
            <input type="hidden" name="initiative_id" value={id} />
            <input type="hidden" name="back" value={`/initiatives/${id}`} />
            <input name="base_url" type="url" placeholder="リンク先URL（LINE・購入ページなど）" className="field" required />
            <div className="grid grid-cols-2 gap-2">
              <input name="utm_campaign" placeholder="campaign（例: shinmai2026）" defaultValue={`ini-${id.slice(0, 8)}`} className="field" required />
              <input name="utm_content" placeholder="content（例: reel-hookA）" className="field" />
            </div>
            <Submit className="btn-ghost w-full">作成</Submit>
          </form>
        </Card>
      </div>
      <form action={deleteInitiative} className="mt-6 text-right">
        <input type="hidden" name="id" value={id} />
        <Submit className="text-xs text-warn underline" confirm="この施策を削除しますか？" pendingText="削除中">この施策を削除</Submit>
      </form>
    </>
  );
}
