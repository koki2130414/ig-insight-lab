import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, requireOwned } from "@/lib/context";
import { comparisonFor, targetsFor, type PostRow } from "@/lib/queries";
import { Badge, Card, Field, Flash, Note, PageHeader, SourceBadge, Val } from "@/components/ui";
import { Disclosure, Submit } from "@/components/client";
import { PostForm } from "@/components/post-form";
import { deletePost, deleteSnapshot, saveSnapshot } from "@/app/actions";
import { CHECKPOINTS, FORMATS, POST_METRICS, POST_RATES, PURPOSES, type Checkpoint } from "@/lib/catalog";
import { checkpointDrift, ratesFor } from "@/lib/analytics";
import { fmtDateTime, nowMs, toJstLocalInput } from "@/lib/time";

type SP = { cp?: string; purpose?: string; ads?: string; drift?: string; ok?: string; err?: string };

export default async function PostDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  let acc;
  try {
    acc = await requireOwned(ctx, "posts", id);
  } catch {
    notFound();
  }
  const [post] = await ctx.db.query<PostRow>(`SELECT * FROM posts WHERE id=$1`, [id]);
  const cp: Exclude<Checkpoint, "other"> = sp.cp === "24h" || sp.cp === "7d" ? sp.cp : "72h";
  const opt = { checkpoint: cp, samePurpose: sp.purpose === "1", excludeAds: sp.ads !== "0", excludeDrift: sp.drift !== "0" };
  const { peers, stats, target, metrics } = await comparisonFor(ctx, post, opt);
  const targets = await targetsFor(ctx, acc.id);
  const linked = await ctx.db.query<{ id: string; title: string }>(`SELECT id,title FROM initiatives WHERE post_id=$1`, [id]);
  const label = (k: string) => POST_METRICS.find((m) => m.key === k)?.label ?? POST_RATES.find((r) => r.key === k)?.label ?? k;
  const isRate = (k: string) => POST_RATES.some((r) => r.key === k);
  const ageH = (nowMs() - new Date(post.posted_at).getTime()) / 3600000;
  const suggestedCp: Checkpoint = ageH < 48 ? "24h" : ageH < 120 ? "72h" : ageH < 240 ? "7d" : "other";

  return (
    <>
      <PageHeader
        title={post.hook || post.theme || "投稿の詳細"}
        sub={<>{acc.display_name}・{fmtDateTime(post.posted_at)}・{FORMATS[post.format as keyof typeof FORMATS]}{post.purpose && `・${PURPOSES[post.purpose as keyof typeof PURPOSES]}`}</>}
        actions={
          <>
            {post.url && <a href={post.url} target="_blank" rel="noopener noreferrer" className="btn-ghost">Instagramで開く</a>}
            <Link href={`/initiatives/new?account=${acc.id}&base=${post.id}&cp=${cp}`} className="btn">この比較から施策を作る</Link>
          </>
        }
      />
      <Flash sp={sp} />
      {linked.length > 0 && <div className="mb-3 flex flex-wrap gap-2 text-sm">紐づく施策: {linked.map((l) => <Link key={l.id} href={`/initiatives/${l.id}`} className="underline">{l.title}</Link>)}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="記録した実績" id="snapshot">
          {metrics.length === 0 ? <p className="text-sm text-muted">まだ実績がありません。下のフォームから入力してください。</p> : (
            <div className="overflow-x-auto">
              <table className={`w-full text-sm ${metrics.length > 2 ? "min-w-[520px]" : ""}`}>
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">指標</th>{metrics.map((m) => (
                    <th key={m.id} className="pr-2">
                      {CHECKPOINTS[m.checkpoint].label}
                      <div className="font-normal">{m.hours_since_post !== null ? `${m.hours_since_post.toFixed(0)}時間後` : ""} {checkpointDrift(m.checkpoint, m.hours_since_post) === "drift" && <Badge t="gold">時点ずれ</Badge>}</div>
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {POST_METRICS.map((d) => (
                    <tr key={d.key} className="border-b border-line/60">
                      <td className="py-1.5" title={d.definition}>{d.label}</td>
                      {metrics.map((m) => <td key={m.id}><Val v={(m as unknown as Record<string, number | null>)[d.key]} unit={d.unit === "seconds" ? "seconds" : "count"} /></td>)}
                    </tr>
                  ))}
                  {POST_RATES.map((r) => (
                    <tr key={r.key} className="border-b border-line/60 bg-paper/50">
                      <td className="py-1.5" title={r.definition}>{r.label}</td>
                      {metrics.map((m) => <td key={m.id}><Val v={ratesFor(m)[r.key]} unit="ratio" missing="算出不可" /></td>)}
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 text-xs text-muted">区分・取得</td>
                    {metrics.map((m) => (
                      <td key={m.id} className="space-y-1 py-1.5 text-xs">
                        <SourceBadge source={m.source} measurement={m.measurement} />
                        <div className="text-muted">{fmtDateTime(m.captured_at)}</div>
                        {m.note && <div className="text-muted">{m.note}</div>}
                        <form action={deleteSnapshot}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="post_id" value={id} /><Submit className="text-xs text-warn underline" confirm="この時点の記録を削除しますか？" pendingText="削除中">削除</Submit></form>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[12px] text-muted">率は分母（リーチ）が無い・0のとき「算出不可」。投稿由来フォローが無いときは期間の純増で代用しません。</p>
        </Card>

        <Card title={`同条件の投稿との比較（比較検証）`}>
          <form className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <label><span className="label">時点</span><select name="cp" defaultValue={cp} className="field">{(["24h", "72h", "7d"] as const).map((c) => <option key={c} value={c}>{CHECKPOINTS[c].label}</option>)}</select></label>
            <label><span className="label">目的</span><select name="purpose" defaultValue={opt.samePurpose ? "1" : "0"} className="field"><option value="0">問わない</option><option value="1">同じ目的のみ</option></select></label>
            <label><span className="label">広告・プレゼント</span><select name="ads" defaultValue={opt.excludeAds ? "1" : "0"} className="field"><option value="1">除外</option><option value="0">含める</option></select></label>
            <label><span className="label">時点ずれ</span><select name="drift" defaultValue={opt.excludeDrift ? "1" : "0"} className="field"><option value="1">除外</option><option value="0">含める</option></select></label>
            <button className="btn-ghost col-span-2 sm:col-span-4">条件を変えて比較</button>
          </form>
          <Note>同じアカウント・同じ形式（{FORMATS[post.format as keyof typeof FORMATS]}）・{CHECKPOINTS[cp].label}の投稿 {peers.length}件と比較。自然投稿どうしの比較で、ランダム化したA/Bテストではありません。{peers.length < 3 && " 比較対象が3件未満のため参考程度です。"}</Note>
          {!target && <div className="mt-2"><Note t="gold">この投稿には{CHECKPOINTS[cp].label}の記録がありません。</Note></div>}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">指標</th><th>この投稿</th><th>中央値</th><th>平均</th><th>件数</th><th>中央値比</th></tr></thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.key} className="border-b border-line/60">
                    <td className="py-1.5">{label(s.key)}</td>
                    <td className="font-semibold"><Val v={s.value} unit={isRate(s.key) ? "ratio" : "count"} /></td>
                    <td><Val v={s.median} unit={isRate(s.key) ? "ratio" : "count"} missing="—" /></td>
                    <td><Val v={s.mean} unit={isRate(s.key) ? "ratio" : "count"} missing="—" /></td>
                    <td className="num text-xs">{s.n}{s.missing > 0 && <span className="text-muted">（欠損{s.missing}）</span>}</td>
                    <td>{s.vsMedian === null ? <span className="text-xs text-muted">—</span> : <Badge t={s.vsMedian >= 1.1 ? "green" : s.vsMedian < 0.6 ? "red" : "gray"}>{s.vsMedian.toFixed(2)}倍</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {peers.length > 0 && (
            <div className="mt-2 text-xs text-muted">
              比較対象: {peers.slice(0, 12).map((p) => <Link key={p.id} href={`/posts/${p.id}`} className="mr-2 underline">{fmtDateTime(p.posted_at).slice(0, 10)}</Link>)}
            </div>
          )}
        </Card>
      </div>

      <Card title="実績を入力（インサイト画面を見ながら）" className="mt-4">
        <form action={saveSnapshot} className="space-y-3">
          <input type="hidden" name="post_id" value={id} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="時点*">
              <select name="checkpoint" defaultValue={suggestedCp} className="field">{Object.entries(CHECKPOINTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            </Field>
            <Field label="取得日時*" hint="画面を見た日時"><input type="datetime-local" name="captured_at" defaultValue={toJstLocalInput(new Date())} className="field" required /></Field>
            <Field label="計測区分"><select name="measurement" className="field"><option value="manual">手入力</option><option value="estimated">推定</option></select></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="overwrite" value="1" /> 既存の時点を上書き</label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {POST_METRICS.map((m) => (
              <Field key={m.key} label={m.label} hint={m.api?.formats && !m.api.formats.includes(post.format as never) ? "この形式はAPI非対応" : undefined}>
                <input name={m.key} inputMode="decimal" className="field num" placeholder="未取得" />
              </Field>
            ))}
          </div>
          <Field label="メモ"><input name="note" className="field" placeholder="例: ストーリーズでシェアした" /></Field>
          <p className="text-[12px] text-muted">空欄は「未取得」として保存します（0とは区別）。0のときは0と入力してください。</p>
          <Submit>実績を保存</Submit>
        </form>
      </Card>

      <div className="mt-4 space-y-3">
        <Disclosure summary="投稿情報を編集">
          <PostForm acc={acc} targets={targets} post={post} />
        </Disclosure>
        <form action={deletePost} className="text-right">
          <input type="hidden" name="id" value={id} />
          <Submit className="text-xs text-warn underline" confirm="この投稿と実績を削除しますか？" pendingText="削除中">この投稿を削除</Submit>
        </form>
      </div>
    </>
  );
}
